# Contributing

## Import boundaries

To keep business rules portable and testable, `frontend/src/domain/**` must stay framework- and platform-agnostic.

### Domain layer rules

- Allowed: domain-internal modules and shared contracts/utilities.
- Forbidden in domain: `react`, `react-router`, `react-router-dom`, `idb`, and browser globals/APIs (`window`, `document`, `localStorage`, etc.).
- UI/framework/browser integrations belong in app/data layers and should adapt domain abstractions rather than leaking inward.

These boundaries are enforced by ESLint and are expected to fail CI when violated.
