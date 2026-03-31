# TypeScript vs .NET Equivalence Harness

This harness runs backend-agnostic semantic scenarios against both implementations and writes a diff-focused report.

## Inputs

- Scenario file: `fixtures/equivalence/equivalence-scenarios.v1.json`
- Reset fixture: `fixtures/golden/trier-v1.json`
- Runtime endpoints (must expose the same API contract):
  - TypeScript: `TS_BASE_URL` (or `--tsBaseUrl=...`)
  - .NET: `DOTNET_BASE_URL` (or `--dotnetBaseUrl=...`)

## Scenario schema

Each step is a semantic intent (instead of transport details):

- `op`: semantic operation (`createSpecies`, `assignBatchToBed`, `validateBatch`, `reloadState`, etc.)
- `input`: operation payload
- `expect` (optional): semantic assertions (`status`, `bodyIncludes`)

The scenario fixture remains backend-agnostic; runtime adapters are responsible for translating operations to concrete API calls.

## Adapters

- `scripts/equivalence/adapters/typescript.mjs`
- `scripts/equivalence/adapters/dotnet.mjs`

Each adapter maps semantic operations to runtime-specific endpoint flows.

## Run

```bash
node scripts/equivalence/run-equivalence.mjs \
  --tsBaseUrl=http://localhost:5174 \
  --dotnetBaseUrl=http://localhost:5050 \
  --allowlist=fixtures/equivalence/allowlist.v1.json \
  --out=artifacts/equivalence-report.json
```

## Gate behavior

- The harness classifies each mismatch as:
  - `blocked`: no active allowlist entry matched the mismatch signature (fails gate).
  - `allowed`: matched allowlist debt entry (does not fail gate until expiry).
- The harness exits non-zero when:
  - one or more `blocked` mismatches exist.
  - an allowlist entry is invalid, expired, or missing `owner`.
- It compares for each scenario:
  - normalized semantic step results (status + response body)
  - normalized final persisted app-state snapshot after scenario execution
- Report output contains mismatch paths, reasons, scenario IDs, and classification for triage.

This is intended as a required pre-cutover gate between the legacy TypeScript path and .NET backend.
