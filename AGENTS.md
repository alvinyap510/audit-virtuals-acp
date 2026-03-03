# AGENTS.md

## Purpose
This repository is a forensic workspace for reconciling Virtuals Butler/ACP job transactions against Virtuals' retroactive aGDP Epoch 1 calculations.

## Working Rules
- Treat onchain data and signed/official exports as source-of-truth; treat screenshots/chats as supporting evidence only.
- Normalize all timestamps to UTC and always preserve the original timestamp + timezone/source.
- Never overwrite raw data. Store originals under `data/raw/` and write cleaned outputs to `data/normalized/`.
- Track assumptions and unresolved items in `docs/open-questions.md`.
- For every disputed item, map at minimum: `job_id`, `agent`, `payer`, `payee`, `amount`, `currency`, `tx_hash`, `status`, `created_at`, `paid_at`, and epoch inclusion decision.
- Record whether a transaction failure/loss happened at wallet, relayer, infra, or indexing layer (or remains unknown).

## Repo Conventions
- `docs/` contains research notes, methodology, and reconciliation reports.
- `templates/` contains CSV schemas/templates for data intake.
- `data/raw/` is immutable input.
- `data/normalized/` is derived and reproducible.

## Safety
- Do not commit private keys, seed phrases, auth tokens, or wallet session secrets.
- Redact personal data unless required for reconciliation.

