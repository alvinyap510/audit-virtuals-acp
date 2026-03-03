# Virtuals Butler / aGDP Epoch 1 Reconciliation

This repo is initialized as a working space to reconcile discrepancies between:
- your/your partner's internal transaction records, and
- Virtuals' retroactive aGDP Epoch 1 calculation.

## Current Setup
- `docs/virtuals-acp-agdp-epoch1-brief.md`: mechanism summary and research notes
- `docs/reconciliation-workflow.md`: how we will reconcile disputed transactions
- `docs/open-questions.md`: items to confirm before final conclusions
- `templates/tx-reconciliation-template.csv`: intake format for transaction/job rows

## Next Input Needed
When you're ready, send transaction data (or paste a sample) with as many of these fields as available:
- `job_id`
- `agent wallet / owner wallet`
- `counterparty wallet`
- `tx_hash`
- `job created timestamp`
- `job paid timestamp`
- `gross amount`
- `currency`
- `status / failure mode`
- any Virtuals retro-calculated value for the same row

## Tooling: PaymentManager USDC Scanner

This repo now includes a chunked `ethers` scanner script that:
- reads bot wallets from `BOT_WALLETS.md`
- scans ERC-20 `Transfer` logs to the Virtuals PaymentManager proxy
- filters to senders in your bot wallet list
- writes a CSV and prints per-wallet totals

### Setup

```bash
pnpm install
```

### Run

Edit `SCAN_CONFIG` in `scripts/scan-usdc-to-payment-manager.mjs` first:
- `rpcUrl`
- `usdcAddress`
- `startBlock`
- `chunkSize` (default `1000`)

Then run:

```bash
pnpm scan:payment-manager
```

Optional:
- You can still override via CLI (`--rpc`, `--usdc`, `--start-block`, `--chunk-size`, etc.) if needed.

The script is at `scripts/scan-usdc-to-payment-manager.mjs`.

## Tooling: Current USDC Balances (Bot Wallets)

This repo also includes a wallet-balance snapshot script that:
- reads all wallets from `BOT_WALLETS.md`
- queries current USDC `balanceOf` for each wallet
- writes a CSV
- prints the grand total balance across all listed wallets

### Run

Edit `BALANCE_CONFIG` in `scripts/query-usdc-balances.mjs` first:
- `rpcUrl`
- `usdcAddress`

Then run:

```bash
pnpm balances:usdc
```

Output:
- CSV in `data/normalized/` (auto-named unless `out` is set)
- console summary with total raw and total token amount

## Tooling: PaymentManager -> ACP Business Wallet Payouts

This script calculates cumulative USDC paid by Virtuals `PaymentManager` to your ACP business wallet across a block range.

Pre-filled values in `scripts/scan-usdc-pm-to-business-wallet.mjs`:
- `PaymentManager`: `0xEF4364Fe4487353dF46eb7c811D4FAc78b856c7F`
- `ACP Business Wallet`: `0xB74e20957654503D0a7F49Bcb01FA86950467657`
- `USDC (Base)`: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- `startBlock`: `42126570`

Run:

```bash
pnpm scan:pm-to-business
```

Output:
- CSV in `data/normalized/`
- console totals (`[result] total_USDC: ...`)
