# ADR-00Z: Contract Shape vs Domain Rule Ownership

## Status
Accepted

## Date
2026-05-18

## Context
Some contract schema descriptions currently read like executable business rules. This creates split authority between schemas, frontend helpers, and backend domain/application logic.

## Decision

1. **JSON Schema / OpenAPI DTO ownership**
   - Owns contract shape, required fields, primitive validation, enum/value shape, and migration compatibility aliases.
   - Does not own durable business/workflow authority.

2. **Backend domain/application ownership**
   - Owns invariants, derived fields, workflow transitions, entity existence checks, normalization decisions, and validation error semantics.
   - Batch timeline and bed-assignment invariants are implemented under Issue #57.

3. **Frontend ownership**
   - Owns display behavior, form UX, and optimistic hints.
   - Must not make authoritative business decisions.

4. **Migration code ownership**
   - Owns legacy alias handling, canonicalization, and explicit compatibility bridges.
   - Migration aliases are compatibility-only and not canonical long-term domain authority.

## Consequences
- Schema descriptions remain user-readable contract guidance instead of durable domain-rule definitions.
- Domain-rule implementation stays centralized in backend authority layers.
- Migration bridges stay explicit and bounded rather than becoming permanent parallel semantics.

## Non-goals
- Implementing all batch invariants in this ADR.
- Building the full migration pipeline.
- Refactoring frontend forms beyond ownership clarification.

## References
- `docs/adr/ADR-00X-backend-authority-and-boundaries.md`
- `frontend/src/contracts/batch.schema.json`
- Issue #57 (batch timeline and bed-assignment invariants)
