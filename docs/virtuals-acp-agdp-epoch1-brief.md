# Virtuals ACP / Butler / aGDP Epoch 1 Brief (Working Notes)

_As of 2026-02-25 (UTC); this is a working model to guide reconciliation, not a final audit report._

## 1) Working mental model: Butler + ACP jobs

- Virtuals Butler acts as the ACP-compatible execution/service layer for agent-to-agent jobs.
- ACP job flow is stateful and phase-based (request -> transaction -> evaluation -> settlement/closure).
- A payable job typically involves an escrow/held payment during execution and either:
  - settlement/payment on success, or
  - refund on expiry/rejection/failure paths.

### Why this matters for reconciliation
Disputes often come from counting the wrong event:
- job created vs job accepted vs job paid
- escrowed amount vs settled amount
- gross transaction amount vs fee-adjusted amount
- chain-confirmed tx vs relayer/indexer-visible event

## 2) Fee mechanics relevant to aGDP math

Virtuals' ACP fee structure documentation indicates an 80/20 split:
- 80% service fee to the agent owner
- 20% protocol fee to Virtuals

Implication for your farming-profitability comment:
- reward calculations can remain net-profitable even after protocol fee deductions if campaign rewards exceed execution costs + losses.

## 3) aGDP metric semantics (important for counting)

Virtuals' aGDP glossary describes:
- `aGDP`: aggregated GDP from agent transactions (presented net of certain costs/rewards in their example)
- `Transactions`: count of jobs processed
- `Agent Revenue`: revenue to the agent from transactions

For reconciliation, we should not assume these dashboard metrics directly equal:
- raw onchain transfer sum
- gross escrow sum
- owner net payouts

## 4) Epoch 1 campaign context (current understanding)

### What appears confirmed
- `agdp.io` markets recurring/weekly incentives tied to agent economic activity.
- Official/community-visible messaging indicates Epoch 1 completed and exposed farming/spam behaviors.
- Virtuals introduced an `Agent Score` concept for Epoch 2 to reduce low-quality farming incentives.

### What still needs direct confirmation (important)
- Exact Epoch 1 start/end timestamps (UTC)
- Exact eligibility rule wording:
  - "job created during epoch"
  - "job paid during epoch"
  - or both conditions
- Whether inclusion is based on:
  - Butler index timestamps
  - onchain confirmation timestamp/block
  - internal settlement timestamp
- Treatment of failed/retried/replaced jobs and duplicate relays

## 5) Likely discrepancy sources between your calc and Virtuals' retro calc

1. Timestamp boundary mismatch (timezone or different event timestamp)
2. Counting gross vs net (80/20 split or other deductions)
3. Missing relayer/infrastructure events in one dataset
4. Duplicate retries collapsed by Virtuals but counted by bot logs (or vice versa)
5. Job lifecycle mismatch (created/paid/refunded/rejected states)
6. Indexing lag or retroactive reclassification

## 6) Reconciliation principle we should use

Build a canonical row per job/payment event and tag each with:
- source evidence quality
- lifecycle phase
- eligibility decision for Epoch 1
- reason code for inclusion/exclusion

This will make disagreements explainable line-by-line instead of only at total-sum level.

## Sources (research)

Primary / official:
- https://whitepaper.virtuals.io/
- https://whitepaper.virtuals.io/acp/acp-builders-guide
- https://whitepaper.virtuals.io/acp/job-optional-evaluation-and-review
- https://whitepaper.virtuals.io/acp/job.reject_payable
- https://whitepaper.virtuals.io/acp/initialize-and-whitelist-wallet-to-use-butler
- https://whitepaper.virtuals.io/virtuals-protocol-economics-and-data/virtuals-economics
- https://whitepaper.virtuals.io/virtuals-protocol-economics-and-data/acp-fee-structure
- https://whitepaper.virtuals.io/virtuals-protocol-economics-and-data/agdp-glossary
- https://agdp.io/

Secondary / context (used only for epoch messaging context; verify against official X posts/screenshots if needed):
- https://twstalker.com/virtuals_io
- https://twstalker.com/search/?q=%22Half%20a%20million%20dollars%20distributed%20to%20builders%20in%202%20weeks%22

