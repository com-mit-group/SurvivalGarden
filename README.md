# SurvivalGarden

## Contracts

`frontend/src/contracts/app-state.schema.json` defines the import/export `AppState` envelope and requires a numeric `schemaVersion` (integer, minimum `1`) for migration gating between persisted schema revisions.

## Identifier & key strategy

- Use UUID v4 IDs (`crypto.randomUUID`) for user-authored entities created at runtime.
- Use deterministic task `sourceKey` values for generated tasks via stable inputs: `batchId + date + cropId + bedId + type`.
- Never assign random IDs/keys to generated tasks; generated task identity must remain idempotent across regenerations.
- Golden fixture IDs like `task_001` remain deterministic test data and do not replace runtime UUID policy for user-authored entities.

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

## Import/export roundtrip boundaries

Import/export is treated as lossless for all schema-defined `AppState` fields after canonical JSON normalization (stable key ordering before deep comparison).

Photo/blob payload data is intentionally excluded from roundtrip guarantees. If photo metadata fields exist in schema, metadata must survive export → import → export, while blob payload paths (currently documented as `/photos/*/blob` and `/photos/*/blobBase64`) are excluded-by-design.
