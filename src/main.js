import "./styles.css";
import "./validator.css";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const RPC_KEY = "tx-lens-rpc";
const HISTORY_KEY = "tx-lens-history";
const DEFAULT_RPC = "https://studio.genlayer.com/api";
const $ = (selector) => document.querySelector(selector);
let latestReport = null;
let requestId = 0;
let inspectionId = 0;
let toastTimer;

$("#rpc-url").value = localStorage.getItem(RPC_KEY) || DEFAULT_RPC;
$("#inspect-form").addEventListener("submit", inspect);
$("#save-rpc").addEventListener("click", saveRpc);
$("#copy-report").addEventListener("click", copyReport);
$("#download-report").addEventListener("click", downloadReport);
$("#clear-history").addEventListener("click", clearHistory);
renderHistory();

function saveRpc() {
  const value = $("#rpc-url").value.trim();
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") throw new Error("use an https rpc endpoint.");
    localStorage.setItem(RPC_KEY, value);
    notify("rpc endpoint saved in this browser.");
  } catch (error) { notify(error.message || "enter a valid https url."); }
}

async function inspect(event) {
  event.preventDefault();
  const hash = $("#tx-hash").value.trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) return showNotice("enter a 32-byte transaction hash beginning with 0x.", true);
  const endpoint = $("#rpc-url").value.trim();
  try {
    if (new URL(endpoint).protocol !== "https:") throw new Error("rpc endpoint must use https.");
  } catch { return showNotice("enter a valid https rpc endpoint.", true); }
  const currentInspection = ++inspectionId;
  setBusy(true);
  showNotice("loading transaction receipt…");
  $("#report").hidden = true;

  const client = createClient({ chain: studionet, endpoint });
  const optionalRequests = Promise.allSettled([
    rpc(endpoint, "gen_getTransactionLifecycle", { txId: hash }),
    client.debugTraceTransaction({ hash, round: 0 }),
  ]);
  let receipt;
  try {
    const transaction = await client.getTransaction({ hash });
    if (!transaction) throw new Error("transaction not found on this network.");
    receipt = normalizeTransaction(transaction, hash);
  } catch (error) {
    if (currentInspection === inspectionId) {
      setBusy(false);
      showNotice(`receipt request failed: ${readable(error)}`, true);
    }
    return;
  }
  if (currentInspection !== inspectionId) return;

  latestReport = {
    network: "GenLayer Studionet 61999",
    rpc_endpoint: endpoint,
    inspected_at: new Date().toISOString(),
    receipt,
    lifecycle: null,
    trace: null,
    optional_errors: { lifecycle: null, trace: null },
  };
  renderReport(latestReport);
  saveHistory(hash, receipt.statusName || "inspected");
  setBusy(false);
  showNotice("receipt loaded. fetching lifecycle and execution trace…");

  const [lifecycleResult, traceResult] = await optionalRequests;
  if (currentInspection !== inspectionId) return;
  latestReport.lifecycle = lifecycleResult.status === "fulfilled" ? lifecycleResult.value : null;
  latestReport.trace = traceResult.status === "fulfilled" ? traceResult.value : null;
  latestReport.optional_errors = {
    lifecycle: lifecycleResult.status === "rejected" ? readable(lifecycleResult.reason) : null,
    trace: traceResult.status === "rejected" ? readable(traceResult.reason) : null,
  };
  renderReport(latestReport);
  const missing = [latestReport.optional_errors.lifecycle && "lifecycle", latestReport.optional_errors.trace && "trace"].filter(Boolean);
  showNotice(missing.length ? `receipt loaded. unavailable: ${missing.join(" and ")}.` : "inspection complete.");
}

function normalizeTransaction(transaction, hash) {
  const createdAt = Number(transaction.createdTimestamp || transaction.created_timestamp || 0);
  const lastVote = Number(transaction.lastVoteTimestamp || transaction.last_vote_timestamp || 0);
  const lastRound = transaction.lastRound || transaction.last_round;
  const normalizedRound = lastRound && {
    ...lastRound,
    round: Number(lastRound.round || 0),
    votesCommitted: lastRound.votesCommitted ?? lastRound.votes_committed,
    votesRevealed: lastRound.votesRevealed ?? lastRound.votes_revealed,
    leaderIndex: lastRound.leaderIndex ?? lastRound.leader_index,
    rotationsLeft: lastRound.rotationsLeft ?? lastRound.rotations_left,
    roundValidators: lastRound.roundValidators ?? lastRound.round_validators,
    validatorVotesHash: lastRound.validatorVotesHash ?? lastRound.validator_votes_hash,
    validatorVotes: lastRound.validatorVotes ?? lastRound.validator_votes,
  };
  return {
    id: transaction.hash || transaction.txId || transaction.tx_id || hash,
    sender: transaction.sender || transaction.from_address,
    recipient: transaction.recipient || transaction.to_address || transaction.to,
    statusName: transaction.statusName || transaction.status,
    txExecutionResultName: transaction.txExecutionResultName || transaction.execution_result,
    consensusResult: transaction.resultName || transaction.result_name,
    numOfInitialValidators: transaction.numOfInitialValidators ?? transaction.num_of_initial_validators,
    roundData: normalizedRound ? [normalizedRound] : [],
    validators: transaction.consensus_data?.validators || transaction.validators || [],
    timestamps: { Created: createdAt, LastVote: lastVote },
    sdk_transaction: transaction,
  };
}

async function rpc(endpoint, method, params) {
  const id = ++requestId;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params: [params], id }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`rpc returned http ${response.status}.`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || `rpc method ${method} failed.`);
  if (payload.result === undefined || payload.result === null) throw new Error(`rpc method ${method} returned no result.`);
  return payload.result;
}

function renderReport(report) {
  const { receipt, lifecycle, trace } = report;
  $("#report").hidden = false;
  $("#report-title").textContent = `${shortHash(receipt.id || receipt.txId || "transaction")}`;
  $("#stored-status").textContent = lower(lifecycle?.storedStatus || receipt.statusName || "unknown");
  $("#projected-status").textContent = `projected: ${lower(lifecycle?.projectedStatus || "not available")}`;
  $("#execution-result").textContent = lower(receipt.consensusResult || receipt.txExecutionResultName || resultName(trace?.result_code));
  $("#execution-hint").textContent = `${receipt.numOfInitialValidators ?? "?"} initial validators · ${receipt.roundData?.length || 0} round(s)`;
  $("#resolution-action").textContent = lower(lifecycle?.resolutionAction || "not available");
  $("#resolution-source").textContent = lower(lifecycle?.resolutionSource || "lifecycle endpoint unavailable");
  $("#tx-contract").textContent = `contract ${shortAddress(receipt.recipient)}`;
  renderDiagnosis(receipt, lifecycle, trace);
  renderRounds(receipt.roundData || []);
  renderValidatorExecutions(receipt.validators || []);
  renderTrace(trace, report.optional_errors.trace);
  renderTimeline(receipt.timestamps || {});
  $("#raw-output").textContent = JSON.stringify({ receipt, lifecycle, trace, optional_errors: report.optional_errors }, null, 2);
}

function renderDiagnosis(receipt, lifecycle, trace) {
  const execution = receipt.txExecutionResultName || "";
  let title = "review the execution output";
  let body = "The receipt was found. Read the return data and finalized contract state to confirm the application stored the expected value.";
  let kind = "check result";

  if (receipt.consensusResult === "MAJORITY_AGREE" && String(receipt.statusName).toUpperCase() === "FINALIZED") {
    title = "validators reached majority agreement";
    body = "The transaction is finalized on Studionet. Per-validator execution results are shown below; the full GenVM trace is unavailable from this RPC endpoint.";
    kind = "finalized";
  } else if (execution === "FinishedWithError" || trace?.result_code === 1) {
    title = "the contract returned an error";
    body = "Open the GenVM trace and read stderr and the last error log. This usually contains the contract's validation message or the failing operation.";
    kind = "contract error";
  } else if (execution === "NondetDisagree") {
    title = "validators did not reach an equivalent result";
    body = "Inspect the consensus rounds and equivalence outputs. Compare what each validator saw; unstable pages or outputs that are too specific can lead to disagreement.";
    kind = "consensus";
  } else if (execution === "Timeout" || lifecycle?.storedStatus?.includes("Timeout")) {
    title = "the transaction timed out";
    body = "Check the last completed round and trace duration. Long page loads, many sources, or expensive prompts can exhaust the execution window.";
    kind = "timeout";
  } else if (execution === "DeterministicViolation") {
    title = "the execution hit a deterministic rule";
    body = "Inspect the trace around the failing call. A nondeterministic web or model operation may have run outside the supported consensus wrapper.";
    kind = "vm rule";
  } else if (trace?.result_code === 2) {
    title = "the GenVM trace reports a runtime error";
    body = "Read stderr and the final GenVM log entry for the concrete exception. The result code alone does not identify the source line.";
    kind = "vm error";
  } else if (["SUCCESS", "FinishedWithReturn"].includes(execution) && String(receipt.statusName).toUpperCase() === "FINALIZED") {
    title = "execution returned successfully";
    body = "Finalized with a return does not by itself prove your app stored the expected report. Read the contract's finalized state and compare it with return_data.";
    kind = "returned";
  } else if (!trace) {
    title = "receipt available; debug trace unavailable";
    body = "This node may not expose gen_dbg_traceTransaction. Receipt and consensus rounds are still shown; try an RPC endpoint with the GenLayer debug group enabled.";
    kind = "partial data";
  }

  $("#diagnosis-title").textContent = title;
  $("#diagnosis-body").textContent = body;
  $("#diagnosis-kind").textContent = kind;
}

function renderRounds(rounds) {
  $("#round-count").textContent = `${rounds.length} round${rounds.length === 1 ? "" : "s"}`;
  const list = $("#rounds-list");
  list.replaceChildren();
  if (!rounds.length) {
    list.innerHTML = '<p class="empty">receipt contains no round details.</p>';
    return;
  }
  rounds.forEach((round, index) => {
    const card = document.createElement("article");
    card.className = "round-card";
    const heading = document.createElement("div");
    heading.className = "round-head";
    const title = document.createElement("strong");
    title.textContent = `round ${Number(round.round ?? index) + 1}`;
    const votes = document.createElement("span");
    votes.textContent = `${round.votesRevealed ?? 0}/${round.votesCommitted ?? 0} revealed`;
    heading.append(title, votes);
    const facts = document.createElement("div");
    facts.className = "round-facts";
    facts.append(fact("leader index", round.leaderIndex), fact("result code", round.result), fact("rotations left", round.rotationsLeft));
    const validators = document.createElement("div");
    validators.className = "validator-list";
    (round.roundValidators || []).forEach((address, validatorIndex) => {
      const row = document.createElement("div");
      row.className = "validator-row";
      row.append(textNode(shortAddress(address)), textNode(`vote ${hashOrData(round.validatorVotesHash?.[validatorIndex])}`));
      validators.append(row);
    });
    const encoded = document.createElement("details");
    encoded.className = "encoded-votes";
    const summary = document.createElement("summary");
    summary.textContent = "encoded validator votes";
    const pre = document.createElement("pre");
    pre.textContent = round.validatorVotes || "not included";
    encoded.append(summary, pre);
    card.append(heading, facts, validators, encoded);
    list.append(card);
  });
}

function renderValidatorExecutions(validators) {
  const list = $("#validator-executions");
  $("#validator-count").textContent = `${validators.length} validator${validators.length === 1 ? "" : "s"}`;
  list.replaceChildren();
  if (!validators.length) {
    list.innerHTML = '<p class="empty">no per-validator execution data in this receipt.</p>';
    return;
  }

  validators.forEach((validator, index) => {
    const card = document.createElement("article");
    card.className = "validator-execution";
    const heading = document.createElement("div");
    heading.className = "validator-execution-head";
    const address = document.createElement("strong");
    address.textContent = shortAddress(validator.node_config?.address || validator.address || "");
    const badges = document.createElement("div");
    badges.className = "validator-badges";
    badges.append(executionBadge("vote", validator.vote), executionBadge("execution", validator.execution_result || validator.genvm_result?.execution_result || "not reported"));
    heading.append(address, badges);
    card.append(heading);

    const result = validator.genvm_result || {};
    const logs = { stdout: result.stdout || "", stderr: result.stderr || "", error: result.raw_error || result.error_description || null };
    if (logs.stdout || logs.stderr || logs.error) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `validator ${index + 1} output`;
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(logs, null, 2);
      details.append(summary, pre);
      card.append(details);
    }
    list.append(card);
  });
}

function executionBadge(label, value) {
  const badge = document.createElement("span");
  badge.className = "validator-badge";
  badge.textContent = `${label}: ${lower(value)}`;
  return badge;
}

function renderTrace(trace, error) {
  if (!trace) {
    $("#trace-state").textContent = "unavailable";
    $("#trace-summary").textContent = error || "debug endpoint returned no trace.";
    $("#trace-output").textContent = "{}";
    return;
  }
  $("#trace-state").textContent = resultName(trace.result_code);
  $("#trace-summary").textContent = `trace result ${trace.result_code} · runtime ${trace.run_time || "unknown"} · ${(trace.eq_outputs || []).length} equivalence output(s)`;
  $("#trace-output").textContent = JSON.stringify({ stderr: trace.stderr, stdout: trace.stdout, genvm_log: trace.genvm_log, return_data: trace.return_data, eq_outputs: trace.eq_outputs }, null, 2);
}

function renderTimeline(timestamps) {
  const events = ["Created", "Pending", "Activated", "Proposed", "Committed", "LastVote", "LeaderRevealed", "AppealSubmitted"];
  const list = $("#timeline");
  list.replaceChildren();
  events.forEach((name) => {
    const raw = Number(timestamps[name] || 0);
    if (!raw) return;
    const event = document.createElement("div");
    event.className = "timeline-event";
    const dot = document.createElement("i");
    const label = document.createElement("span");
    label.textContent = lower(name);
    const time = document.createElement("small");
    time.textContent = new Date(raw * 1000).toLocaleString();
    event.append(dot, label, time);
    list.append(event);
  });
  if (!list.children.length) list.innerHTML = '<p class="empty">no lifecycle timestamps included in this receipt.</p>';
}

function fact(label, value) {
  const span = document.createElement("span");
  span.innerHTML = `<small>${escapeHtml(label)}</small><b>${escapeHtml(value ?? "—")}</b>`;
  return span;
}

function textNode(value) { const span = document.createElement("span"); span.textContent = value; return span; }
function hashOrData(value) { return value ? `${String(value).slice(0, 10)}…` : "not revealed"; }
function shortHash(value) { return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value; }
function shortAddress(value) { return value ? `${value.slice(0, 8)}…${value.slice(-5)}` : "—"; }
function lower(value) { return String(value || "unknown").replaceAll("_", " ").toLowerCase(); }
function resultName(code) { return ({ 0: "success", 1: "user error", 2: "vm error" })[Number(code)] || "not available"; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function setBusy(value) { $("#inspect-button").disabled = value; $("#inspect-button").textContent = value ? "inspecting…" : "inspect transaction"; }
function showNotice(message, error = false) { const notice = $("#notice"); notice.hidden = false; notice.textContent = message; notice.dataset.error = String(error); }
function readable(error) { return String(error?.message || error || "request failed.").toLowerCase(); }

function saveHistory(hash, status) {
  const prior = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]").filter((entry) => entry.hash.toLowerCase() !== hash.toLowerCase());
  prior.unshift({ hash, status, checkedAt: new Date().toISOString() });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(prior.slice(0, 6)));
  renderHistory();
}

function renderHistory() {
  const list = $("#history");
  list.replaceChildren();
  const items = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  if (!items.length) { list.innerHTML = '<span class="empty">no recent hashes.</span>'; return; }
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.innerHTML = `<code>${escapeHtml(shortHash(item.hash))}</code><span>${escapeHtml(lower(item.status))}</span>`;
    button.addEventListener("click", () => { $("#tx-hash").value = item.hash; $("#inspect-form").requestSubmit(); });
    list.append(button);
  });
}

function clearHistory() { localStorage.removeItem(HISTORY_KEY); renderHistory(); }
async function copyReport() { if (!latestReport) return; await navigator.clipboard.writeText(JSON.stringify(latestReport, null, 2)); notify("report copied."); }
function downloadReport() {
  if (!latestReport) return;
  const blob = new Blob([JSON.stringify(latestReport, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `genlayer-tx-${shortHash(latestReport.receipt.id || "report").replaceAll("…", "-")}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
function notify(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("visible"), 2500); }
