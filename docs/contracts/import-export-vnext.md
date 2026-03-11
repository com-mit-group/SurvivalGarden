# Import/Export Contract (vNext)

This document defines the canonical import/export contract for vNext and provides migration mappings from accepted legacy payload variants.

## Source of truth

- `frontend/src/contracts/app-state.schema.json`
- `frontend/src/contracts/crop.schema.json`
- `frontend/src/contracts/batch.schema.json`
- `frontend/src/contracts/task.schema.json`

Canonical samples:

- `docs/contracts/samples/crop.canonical.json`
- `docs/contracts/samples/batch.seed.canonical.json`
- `docs/contracts/samples/batch.regrow-runner.canonical.json`
- `docs/contracts/samples/batch.tuber.canonical.json`
- `docs/contracts/samples/task.canonical.json`
- `docs/contracts/samples/app-state.canonical.json`

## Canonical vs accepted legacy input

- **Canonical export shape** is what contributors/backends should produce for new integrations.
- **Accepted legacy input** is tolerated for migration, mostly through schema aliases on Batch/Crop fields.
- Exporters should not emit legacy aliases when writing vNext payloads.

## vNext schema evolution notes

- Canonical vNext payloads use `AppState.schemaVersion = 2`.
- Crop now supports richer metadata (`scientificName`, `taxonomy`, `aliases`, `isUserDefined`).
- Batch modeling shifts from implicit nested legacy structures to explicit event/quantity fields:
  - timeline in `stageEvents`
  - placement in `bedAssignments`
  - current state in `currentStage`
  - start amount in `startQuantity`
- Legacy aliases still exist in schema where needed for migration input:
  - `batch.stage` (legacy alias)
  - `batch.assignments` (legacy alias)
  - `batch.id` (alias of `batchId`)
  - `crop.id` (alias of `cropId`)
  - `crop.commonName` (alias of `name`)

## Migration mapping examples (before/after)

### 1) Batch stage + assignment aliasing

Before (legacy accepted):

```json
{
  "id": "batch_tomato_2026",
  "cropId": "crop_tomato",
  "startedAt": "2026-03-01T08:00:00Z",
  "stage": "seedling",
  "stageEvents": [
    {
      "type": "sown",
      "date": "2026-03-01T08:00:00Z"
    }
  ],
  "assignments": [
    {
      "bedId": "bed_001",
      "assignedAt": "2026-04-15T07:30:00Z"
    }
  ]
}
```

After (canonical export):

```json
{
  "batchId": "batch_tomato_2026",
  "cropId": "crop_tomato",
  "startedAt": "2026-03-01T08:00:00Z",
  "currentStage": "seedling",
  "stageEvents": [
    {
      "stage": "sown",
      "occurredAt": "2026-03-01T08:00:00Z"
    }
  ],
  "bedAssignments": [
    {
      "bedId": "bed_001",
      "assignedAt": "2026-04-15T07:30:00Z"
    }
  ],
  "stage": "seedling",
  "assignments": [
    {
      "bedId": "bed_001",
      "assignedAt": "2026-04-15T07:30:00Z"
    }
  ]
}
```

Note: current schema still requires `stage` + `assignments`; include both canonical and alias fields until Issue 64/66 finalize the stricter export-only contract.

### 2) Crop alias normalization

Before (legacy accepted):

```json
{
  "id": "crop_beans",
  "commonName": "Pole Bean",
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z"
}
```

After (canonical export):

```json
{
  "cropId": "crop_beans",
  "name": "Pole Bean",
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z"
}
```

## Propagation modeling rules

### When to use `startQuantity`

Always populate `startQuantity` for batches when the initial amount is known.

### When to use seed-specific counts

Use only for seed propagation batches:

- `seedCountPlanned`
- `seedCountGerminated`

### Universal count

Use `plantCountAlive` for currently living plants regardless of propagation type.

### Non-seed propagation

For `runner`, `tuber`, `division`, `cutting`, etc.:

- use `propagationType` + `startQuantity`
- do not invent seed counts

### Confidence metadata

Use `meta.confidence` / `stageEvents[].meta.confidence` when the value quality matters:

- `exact`
- `estimated`
- `unknown`

## Minimal canonical payload set

See the sample JSON files in `docs/contracts/samples/` for implementation-ready payloads.
