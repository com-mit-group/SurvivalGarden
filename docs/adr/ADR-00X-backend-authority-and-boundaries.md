# ADR-00X: Backend Authority and Boundary Enforcement

## Status
Accepted

## Date
2026-05-15

## Context
SurvivalGarden currently has active backend and frontend code paths, plus generated contract artifacts and parity checks. Contributors need a clear authority model so business logic does not drift across layers and so canonical state remains consistent.

Relevant code locations:

- Backend authority and execution layers:
  - `backend/SurvivalGarden.Domain`
  - `backend/SurvivalGarden.Application`
  - `backend/SurvivalGarden.Api`
- Frontend contract and data/client surfaces:
  - `frontend/src/contracts`
  - `frontend/src/data`

## Decision

1. **Business rules + derived/computed logic authority**
   - `backend/SurvivalGarden.Domain` and `backend/SurvivalGarden.Application` are the only authoritative locations for business rules and derived/computed logic.
   - `backend/SurvivalGarden.Api` may orchestrate transport concerns and route handling, but must not become a second rules engine.

2. **Frontend boundary**
   - `frontend/src` is presentation and transport-client behavior only.
   - Frontend logic may shape UX, input flow, and request/response handling, but must not define canonical domain rules.

3. **Persistence policy**
   - Persist canonical source state.
   - Do not persist denormalized derived fields unless explicitly justified (for example, performance-critical caching with invalidation strategy and ownership documented).

4. **Canonical query source-of-truth**
   - Current-state persistence remains the canonical query source-of-truth.
   - Emitted events are history/integration signals and audit trail inputs, not canonical state.

5. **Exceptions policy**
   - Any exception to these boundaries requires an ADR update in `docs/adr` that documents scope, rationale, mitigation, and rollback path.

## Consequences

- Rule changes are implemented once in backend authority layers and consumed elsewhere via contracts.
- Frontend and API layers stay thinner and easier to evolve independently.
- Data model evolution remains safer because derived values are recomputed from canonical persisted state.
- Event consumers do not treat event logs as replacement canonical storage.

## Enforcement
The following checks are required in CI and must remain green:

1. **Contract drift checks**
   - Run frontend type generation from backend OpenAPI and fail on diff in generated artifacts.
   - Runs in `.github/workflows/ci.yml` (frontend job, `Verify generated contract types` step).

2. **Route ownership checks**
   - Enforce workflow endpoint ownership rules (no generic mutation endpoints for workflow-owned entities) through contract/tests and review gates.
   - Policy is documented in `docs/workflow-endpoint-ownership.md`; verification is covered by CI tests (`pnpm --dir frontend test`) in `.github/workflows/ci.yml`.

3. **Parity checks**
   - Ensure frontend and backend behavior remain aligned through parity-focused tests and utilities.
   - Core parity tests run under frontend test execution in `.github/workflows/ci.yml`; deeper live parity verification process is documented in `docs/live-contract-verification.md`.

## References
- `backend/SurvivalGarden.Domain`
- `backend/SurvivalGarden.Application`
- `backend/SurvivalGarden.Api`
- `frontend/src/contracts`
- `frontend/src/data`
- `.github/workflows/ci.yml`
- `docs/workflow-endpoint-ownership.md`
- `docs/live-contract-verification.md`
