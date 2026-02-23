# SurvivalGarden

## Contracts

`frontend/src/contracts/app-state.schema.json` defines the import/export `AppState` envelope and requires a numeric `schemaVersion` (integer, minimum `1`) for migration gating between persisted schema revisions.

## Golden dataset conventions

`fixtures/golden/trier-v1.json` is the stable AppState reference fixture for workflow/idempotence checks.

Deterministic IDs in golden fixtures use fixed prefixes with zero-padded sequence numbers:
- Beds: `bed_001`, `bed_002`, ...
- Crops: `crop_potato`, `crop_beans`, ... (stable semantic keys)
- Crop plans: `plan_001`, `plan_002`, ...
- Tasks: `task_001`, `task_002`, ...
- Seed inventory items: `seed_001`, `seed_002`, ...
- Settings: `settings_001`

The current Bed schema has no dedicated area field, so approximate m² allocations are documented in each bed's `notes` field.
