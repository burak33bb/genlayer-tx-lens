# GenLayer Tx Lens

GenLayer Tx Lens is a read-only transaction inspector for Studionet. It uses the GenLayer JavaScript SDK to read a transaction, then shows lifecycle details and the GenVM execution trace when the RPC node exposes those methods.

## What it shows

- Stored and projected transaction status, plus the protocol's next resolution action
- Validator rounds, validator addresses, vote hashes, and timestamps included in the receipt
- GenVM result, stdout, stderr, logs, return data, and equivalence outputs when a debug trace is available
- A short diagnostic hint for common execution and consensus outcomes
- Copyable or downloadable JSON reports and recent hashes stored only in the current browser

The tool does not connect a wallet, submit transactions, or write to a contract. The transaction receipt is shown before optional lifecycle and trace requests finish. Debug traces are optional because the RPC endpoint must enable GenLayer's debug API group. Diagnostic hints are guidance, not a verified root-cause analysis.

## Run locally

Requirements: Node.js 20 or newer.

```sh
npm install
npm run check
npm run build
npm run dev
```

Open the local URL printed by Vite. The default RPC is `https://studio.genlayer.com/api` (Studionet, chain ID 61999). An alternate endpoint can be saved in the browser and must use HTTPS.

## Data and privacy

Transaction data is requested directly from the selected GenLayer RPC endpoint. Recent transaction hashes are stored in browser local storage and can be cleared from the page. No application server or wallet is used.
