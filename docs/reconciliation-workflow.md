# Reconciliation Workflow (Virtuals Retro Calc vs Internal Records)

## Goal
Produce an auditable discrepancy report that explains, row by row, why your totals differ from Virtuals' retroactive aGDP Epoch 1 calculation.

## Data Inputs We Should Collect

From your side (preferred):
- Bot/job logs (job creation, payment initiation, retries, failures)
- Transaction hashes and timestamps
- Butler/API responses (if available)
- Internal payout/revenue spreadsheets

From Virtuals side (if available):
- Retroactive calculation export
- Eligibility criteria wording
- Any per-job inclusion/exclusion list
- Timestamp basis used for epoch classification

## Normalization Rules

- Normalize addresses to lowercase checksum-insensitive comparison key.
- Normalize timestamps to UTC (`*_at_utc`) and preserve original strings.
- Split monetary fields into:
  - `gross_amount`
  - `protocol_fee_amount`
  - `agent_owner_amount`
  - `gas_cost` (if available)
  - `reward_amount` (if available)
- Separate lifecycle events from job summary rows.

## Matching Strategy

Use deterministic keys in this order:
1. `job_id`
2. `tx_hash`
3. (`payer`, `payee`, `amount`, nearest timestamp window)

If multiple retries exist, preserve all attempts and mark one as canonical only with evidence.

## Epoch Eligibility Classification

Each row should get:
- `epoch1_eligible` (`yes` / `no` / `unknown`)
- `eligibility_basis` (e.g., `paid_at`, `created_at`, `internal_settlement_at`)
- `eligibility_reason_code` (e.g., `paid_outside_window`, `refunded`, `duplicate_retry`, `missing_chain_confirm`)

## Deliverables We Will Produce

- `docs/reports/epoch1-discrepancy-report.md` (narrative findings)
- `data/normalized/canonical-ledger.csv` (row-level truth table)
- `data/normalized/discrepancies.csv` (only mismatches with reason codes)

## Minimum First Batch (to start fast)

Send 10-30 disputed rows first (not everything), ideally including:
- a few rows you count but Virtuals excludes
- a few rows Virtuals counts but you exclude
- rows near the suspected epoch boundary
- rows with relayer/infra failure suspicion

