# SurvivalGarden

## Contracts

`frontend/src/contracts/app-state.schema.json` defines the import/export `AppState` envelope and requires a numeric `schemaVersion` (integer, minimum `1`) for migration gating between persisted schema revisions.


## Import/export contract docs & canonical payload samples

For vNext contract details and migration mappings, see `docs/contracts/import-export-vnext.md`.

Canonical sample payloads live in `docs/contracts/samples/`:
- `crop.canonical.json`
- `batch.seed.canonical.json`
- `batch.regrow-runner.canonical.json`
- `batch.tuber.canonical.json`
- `task.canonical.json`
- `app-state.canonical.json`

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

## Schema vNext notes (Crop + Batch)

`AppState.schemaVersion` minimum is now `2` for the canonical vNext contract.

`Crop` additions:
- `scientificName?: string`
- `taxonomy?: { family?: string; genus?: string; species?: string }`
- `aliases?: string[]`
- `isUserDefined?: boolean`

`Batch` canonical shape (legacy nested `start`, `counts`, `status`, and `assignments` are no longer first-class):
- `propagationType: "seed" | "transplant" | "cutting" | "division" | "tuber" | "bulb" | "runner" | "graft" | "other"`
- `startQuantity: { count: number; unit: string }`
- `currentStage: string`
- `stageEvents: Array<{ stage; occurredAt; location?; method?; meta?: { confidence?: "exact" | "estimated" | "unknown"; ... } }>`
- `bedAssignments: Array<{ bedId; assignedAt; removedAt?; meta? }>`
- `photos: Array<{ id; storageRef; ...metadata }>`
- Optional seed-specific counts: `seedCountPlanned?`, `seedCountGerminated?`
- Optional universal count: `plantCountAlive?`
- Confidence metadata can be attached at `batch.meta.confidence` and `stageEvents[i].meta.confidence` to annotate certainty of recorded facts (`exact`, `estimated`, `unknown`) without replacing the underlying value.

Migration mapping guidance:
- `batch.stage` -> `batch.currentStage`
- `batch.assignments` -> `batch.bedAssignments`
- legacy `start.count` / `counts.*` -> `startQuantity` and optional seed-specific fields as appropriate
- legacy `status` timeline -> `stageEvents`

For non-seed propagation, use `propagationType` + `startQuantity` only; do not populate fake seed counts.

