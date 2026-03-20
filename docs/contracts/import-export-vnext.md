# Import/Export Contract (vNext)

This document defines the canonical import/export contract for vNext and provides migration mappings from accepted legacy payload variants.

## Source of truth

- `frontend/src/contracts/app-state.schema.json`
- `frontend/src/contracts/crop.schema.json`
- `frontend/src/contracts/batch.schema.json`
- `frontend/src/contracts/species.schema.json`
- `frontend/src/contracts/task.schema.json`

Canonical samples:

- `docs/contracts/samples/crop.canonical.json`
- `docs/contracts/samples/batch.seed.canonical.json`
- `docs/contracts/samples/batch.regrow-runner.canonical.json`
- `docs/contracts/samples/batch.tuber.canonical.json`
- `docs/contracts/samples/task.canonical.json`
- `docs/contracts/samples/app-state.canonical.json`
- `docs/contracts/samples/import-events.request.canonical.json`
- `fixtures/golden/taxonomy-v1.json` (canonical taxonomy reference dataset for Species → Crop Type → Cultivar examples)

## Canonical vs accepted legacy input

- **Canonical export shape** is what contributors/backends should produce for new integrations.
- **Accepted legacy input** is tolerated for migration, mostly through schema aliases on Batch/Crop fields.
- Exporters should not emit legacy aliases when writing vNext payloads.

## vNext schema evolution notes

- Canonical vNext payloads use `AppState.schemaVersion = 2`.
- Species is now a top-level collection for normalized taxonomy and future enrichment.
- Crop is the current persisted identifier for the middle taxonomy layer, but semantically it represents a **crop type** (an agricultural/garden crop form under a species, such as broccoli or kohlrabi).
- Multiple crop records may reference the same `speciesId`; legacy taxonomy fields on Crop remain compatibility-only during migration to explicit crop-type wording.
- Use crop types for one-species-many-form relationships such as `Brassica oleracea` → Kohlrabi/Broccoli/Kale/Cabbage and `Beta vulgaris` → Beetroot/Chard.
- Crop also supports **partial records** for staged data entry/sync: only identity (`cropId` or `id`, `name` or `commonName`) plus timestamps are required.
- `rules`, `taskRules`, and `nutritionProfile` are optional and may be omitted for user-defined crops.
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
- `crop.scientificName` / `crop.taxonomy` / `crop.species` remain accepted as deprecated compatibility fields during migration

## Migration mapping examples (before/after)

### 1) Batch stage + assignment aliasing

Before (legacy accepted):

```json
{
  "id": "batch_tomato_2026",
  "cropId": "crop_tomato_san_marzano",
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
  "cropId": "crop_tomato_san_marzano",
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
  "id": "crop_beans_unknown_variety",
  "commonName": "Beans",
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z"
}
```

After (canonical export):

```json
{
  "cropId": "crop_beans_unknown_variety",
  "name": "Beans",
  "cultivar": "Unknown variety",
  "speciesId": "species_beans",
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z"
}
```

Taxonomy repair note:

- Legacy species-level or phantom-species crop payloads should be normalized into cultivar records that reference a real top-level `Species` via `speciesId`.
- When a cultivar is unknown but the species is deterministic, preserve the record as a placeholder cultivar such as `Unknown variety` rather than keeping a ghost canonical crop active.
- Ambiguous historical payloads should surface warnings for explicit cleanup instead of silently guessing a cultivar.

### 3) Partial user-defined crop (canonical)

```json
{
  "cropId": "crop_user_herb_mix",
  "name": "Herb Mix",
  "isUserDefined": true,
  "aliases": ["Kitchen Herb Mix", "Mixed Herbs"],
  "scientificName": "Mentha spp. blend",
  "createdAt": "2026-01-15T10:00:00Z",
  "updatedAt": "2026-01-15T10:00:00Z"
}
```

Behavior note:

- If `rules`/`taskRules` are omitted, calendar/task derivation should treat the crop as "no schedule metadata available" and skip rule-driven task generation for that crop.
- If `nutritionProfile` is omitted, nutrition rollups should ignore crop-level nutrient contribution rather than failing validation/import.
- Do not over-validate user-defined crops beyond schema requirements.

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

## Backend/C# mapping notes (contract-preserving)

- Keep JSON Schema canonical while backend stabilizes; C# DTOs should map 1:1 to schema fields.
- Preserve legacy alias read-support during import (`id`, `commonName`, `stage`, `assignments`), but emit canonical names on export.
- Recommended C# handling for crop identity/metadata:
  - `CropId = crop.cropId ?? crop.id`
  - `Name = crop.name ?? crop.commonName`
  - Map `ScientificName` and `Aliases` as optional values (nullable string + collection).
- Recommended C# handling for batch timeline/state:
  - Require persisted `StartedAt`, `StageEvents`, and legacy-required `Stage` + `Assignments` until schema requirement changes.
  - Compute/validate `CurrentStage` from latest `StageEvents[*].Stage` when absent.
  - Keep alias parity between `bedAssignments` and `assignments` in write paths until migration-only aliases are formally removed.

## Event import endpoint (incremental updates)

Use this endpoint for small event-based updates without posting full batch payloads.

### Endpoint

- `POST /api/import/events`

### Request payload

```json
{
  "events": [
    {
      "batchId": "batch-pea-2026-03-06-01",
      "type": "transplanted",
      "date": "2026-03-12",
      "location": "bed_N1"
    }
  ]
}
```

### Expected behavior

For each event record:

1. Locate the target batch by `batchId`.
2. Append a canonical `stageEvents[]` entry (`stage = type`, `occurredAt = date`, optional `location`).
3. Recompute `currentStage` from the newest event.

If any event references a missing batch, reject the request and report the failing event index.

## Minimal canonical payload set

See the sample JSON files in `docs/contracts/samples/` for implementation-ready payloads. Use `fixtures/golden/taxonomy-v1.json` as the canonical modeled taxonomy example when validating Species → Crop Type → Cultivar relationships for imports, demos, and documentation.
