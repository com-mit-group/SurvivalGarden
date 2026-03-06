# LLM implementation workflow (contract-first)

Use this workflow for any Codex/LLM-assisted change to keep logic out of UI and avoid schema drift.

## 1) Contract-first sequence (required)

Always make changes in this order:

1. **Schema**: update JSON schemas in `frontend/src/contracts/*.schema.json`.
2. **Generated contracts**: regenerate `frontend/src/generated/contracts.ts`.
3. **Validators/parsers**: update schema tests and runtime validation wiring that depends on the changed shape.
4. **Repositories/storage**: update data/repo adapters and persistence mapping.
5. **UI wiring last**: only display/capture the new fields in UI.

If a change starts in UI first, stop and move it back to step 1.

## 2) Logic placement guardrails

- **Domain/application owns behavior**: defaults, derivations, merge/upsert rules, ordering, key generation, migrations, and import/export semantics.
- **UI owns presentation/input only**: labels, control state, formatting, and event capture.
- **Do not add business decisions in components** (`App.tsx`, view components, hooks tied to rendering).

### Quick decision table

| If you are changing... | Put logic in... | UI responsibility |
| --- | --- | --- |
| Derived values, status transitions, deterministic IDs/keys | domain/data modules | render computed result |
| Import/export normalization, validation, migration | contracts + validation + repos | trigger action and show outcome |
| Form field capture/editing | UI state handlers | collect input and pass through |

## 3) Add-field pipeline (copy/paste checklist)

When adding a field, do all of these:

1. Update schema(s) in `frontend/src/contracts`.
2. Regenerate `frontend/src/generated/contracts.ts`.
3. Update contract/validation tests for required/optional behavior.
4. Update repository/storage mapping so import/export and persistence include the field.
5. Wire UI to show/edit the field only after data-path updates are complete.
6. Update fixtures if shape changes (including golden fixture data when relevant).

## 4) Required test updates

At minimum, update or confirm these test classes for schema/data-shape changes:

- **Golden fixture validation** (fixtures still pass schema and remain key-sorted/stable).
- **Import/export roundtrip** (field survives export → import → export where applicable).
- **Task generation stability** when tasks are touched:
  - deterministic keys stay deterministic,
  - `sourceKey` remains stable across regeneration,
  - upsert remains idempotent by `sourceKey`.

## 5) Common failure modes to check before PR

- Updated UI/types but forgot schema update.
- Updated schema but forgot generated contracts.
- Added field in one direction only (export but not import, or vice versa).
- Broke deterministic task keys by changing key inputs/order/normalization.
- Broke `sourceKey` stability, causing duplicate generated tasks after repeated runs.
