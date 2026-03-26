# .NET Readiness Plan (Domain/Application/Persistence + MAUI)

## Decision statement

**JSON Schema is the canonical contract for now.**

Until backend boundaries and transport shape stabilize, we keep `frontend/src/contracts/*.schema.json` as the single source of truth for shared models and validation, and continue generating language bindings (TypeScript today, C# next) from the same schema set.

OpenAPI is a **later optimization**, not the current source of truth. We should only consider generating/maintaining OpenAPI after backend endpoints settle and we can prove it does not create duplicate contract ownership.

## Why JSON Schema first (current phase)

- Contracts already exist and are actively used for generated TS types (`frontend/src/generated/contracts.ts`).
- Core entities (`AppState`, `Bed`, `Crop`, `CropPlan`, `Batch`, `Task`, `SeedInventoryItem`, `Settings`) are represented consistently in the schema set.
- The golden fixture (`fixtures/golden/trier-v1.json`) already exercises realistic data shape and edge-case notes.
- Moving too early to OpenAPI risks contract drift across TS and .NET while backend is still forming.

## Review criteria for when to consider OpenAPI generation

Revisit OpenAPI only when all are true:

1. Backend endpoint surface is stable across at least one release cycle.
2. Repository operations are consistently mapped to HTTP semantics (CRUD + list filters) and no major renames are expected.
3. Contract ownership is explicit: either JSON Schema remains source-of-truth and OpenAPI is generated from it, or OpenAPI replaces it with a migration plan that preserves existing generated consumers.
4. Cross-language parity checks (golden vectors + contract tests) are already green and enforced in CI.

If any criterion is unmet, stay JSON Schema-first.

---

## Proposed .NET layering mapped to current TypeScript contracts

### Domain layer (pure rules + invariants)

- Domain entities/value objects mirror schema-generated records:
  - `Bed`, `Crop`, `CropPlan`, `Batch`, `Task`, `SeedInventoryItem`, `Settings`, plus aggregate `AppState`.
- Crop ingest must accept minimal/partial crop payloads (identity + timestamps) so user-defined crops can exist before full rule/nutrition metadata is available.
- Domain services host business rules currently used by TS logic (task derivation windows, stage transitions, status changes, etc.).
- Domain layer has no HTTP, storage, or UI dependencies.

### Application layer (use cases)

- Use-case handlers orchestrate repositories and domain services:
  - `GetBed`, `UpsertBed`, `ListBeds`
  - `ListCropPlansByCropAndSeason`
  - `ListTasksByDateAndStatus`
  - `SaveSettings`, etc.
- DTOs stay schema-aligned to avoid adapter bloat.
- Avoid backend-side over-validation for optional crop metadata (`rules`, `taskRules`, `nutritionProfile`, `scientificName`, `aliases`, `taxonomy`).

### Persistence layer (HTTP + storage adapters)

- .NET repository interfaces should mirror existing TS repo contracts in `frontend/src/data/repos/interfaces.ts`.
- HTTP repository implementations call backend endpoints and map payloads to schema-generated C# records.
- Optional local cache/offline store can be added behind the same interfaces without changing Application/Domain code.

---

## Repository interface parity (TS -> C#)

Current TS contracts establish:

- Generic operations: `getById`, `upsert`, `remove`, `list`
- Filtered list queries (e.g., crop plan by `cropId + seasonYear`, task by `date + status`, batch by stage/crop/bed/date-range)
- AppState load/save + watch semantics
- Settings get/save

Equivalent C# interface sketch:

```csharp
public interface ICrudRepository<TEntity, TId>
{
    Task<TEntity?> GetByIdAsync(TId id, CancellationToken ct = default);
    Task<TEntity> UpsertAsync(TEntity entity, CancellationToken ct = default);
    Task RemoveAsync(TId id, CancellationToken ct = default);
}

public interface IListRepository<TEntity, TFilter>
{
    Task<IReadOnlyList<TEntity>> ListAsync(TFilter? filter = default, CancellationToken ct = default);
}

public interface IBedRepository : ICrudRepository<Bed, string>, IListRepository<Bed, BedListFilter> { }
public interface ICropPlanRepository : ICrudRepository<CropPlan, string>, IListRepository<CropPlan, CropPlanListFilter> { }
public interface ITaskRepository : ICrudRepository<TaskItem, string>, IListRepository<TaskItem, TaskListFilter> { }
```

> Note: naming can follow .NET conventions (`TaskItem` vs `Task`) to avoid conflict with `System.Threading.Tasks.Task`, while preserving wire format.

---

## HTTP endpoint sketches aligned to current repository operations

These are proposed backend endpoint shapes to preserve current client semantics.

### Beds

- `GET /api/beds/{bedId}` -> `Bed`
- `GET /api/beds?gardenId={gardenId}` -> `Bed[]`
- `PUT /api/beds/{bedId}` body `Bed` -> `Bed`
- `DELETE /api/beds/{bedId}` -> `204 No Content`

Example `PUT /api/beds/bed_001` payload:

```json
{
  "bedId": "bed_001",
  "gardenId": "garden_trier_001",
  "name": "Bed 1",
  "notes": "Approx area 18 m²",
  "createdAt": "2026-01-05T00:00:00Z",
  "updatedAt": "2026-01-05T00:00:00Z"
}
```

### Crop plans

- `GET /api/crop-plans/{planId}` -> `CropPlan`
- `GET /api/crop-plans?cropId={cropId}&seasonYear={seasonYear}` -> `CropPlan[]`
- `PUT /api/crop-plans/{planId}` body `CropPlan` -> `CropPlan`
- `DELETE /api/crop-plans/{planId}` -> `204 No Content`

Example `GET /api/crop-plans?cropId=crop_potato_bintje&seasonYear=2026` response item:

```json
{
  "planId": "plan_001",
  "cropId": "crop_potato_bintje",
  "bedId": "bed_001",
  "seasonYear": 2026,
  "plannedWindows": {
    "sowing": [{ "startMonth": 3, "startWeek": 2, "endMonth": 4, "endWeek": 4 }],
    "harvest": [{ "startMonth": 7, "startWeek": 1, "endMonth": 9, "endWeek": 4 }]
  },
  "expectedYield": { "amount": 22, "unit": "kg" },
  "notes": "Placeholder estimate"
}
```

### Tasks

- `GET /api/tasks/{id}` -> `Task`
- `GET /api/tasks?date={yyyy-mm-dd}&status={status}` -> `Task[]`
- `PUT /api/tasks/{id}` body `Task` -> `Task`
- `DELETE /api/tasks/{id}` -> `204 No Content`

### Batches

- `GET /api/batches/{batchId}` -> `Batch`
- `GET /api/batches?stage={stage}&cropId={cropId}&bedId={bedId}&startedAtFrom={iso}&startedAtTo={iso}` -> `Batch[]`
- `PUT /api/batches/{batchId}` body `Batch` -> `Batch`
- `DELETE /api/batches/{batchId}` -> `204 No Content`

Batch timeline canonicalization (vNext):

- Canonical export does not include a separate required `start` object; start semantics are represented by `startedAt` + `stageEvents[0]`.
- Current schema still requires legacy `stage` + `assignments`; backend should continue dual-field writes (`currentStage` + `stage`, `bedAssignments` + `assignments`) until alias removal is finalized.
- Mapping from legacy `start.*`:
  - `start.date` -> `startedAt` and `stageEvents[0].occurredAt`
  - `start.stage` -> `stageEvents[0].stage` and `currentStage` when no later stage events exist
  - `start.location` -> `stageEvents[0].location` (or `stageEvents[0].meta.location` if needed for source fidelity)
  - `start.method` -> `stageEvents[0].method` (or `stageEvents[0].meta.method` if needed for source fidelity)
- `currentStage` should resolve to the latest stage event stage after mapping/import.
- Confidence metadata may annotate uncertainty without removing values: use `batch.meta.confidence` and/or `stageEvents[i].meta.confidence` with `exact`, `estimated`, or `unknown`.
- When propagation classification or first-stage mapping is inferred during migration, tag the inferred fact as `estimated` in the corresponding `meta.confidence` field.
- First-event guidance by propagation type:
  - `seed`: prefer `sowing`/`seeding` when known; otherwise use a neutral initiation stage and preserve source stage text in `stageEvents[0].meta`.
  - non-seed (`transplant`, `cutting`, `division`, `tuber`, `bulb`, `runner`, `graft`, `other`): prefer a propagation-appropriate first stage when known; otherwise use a neutral initiation stage and preserve source detail in `meta`.

Minimal migration example (legacy start-only history -> valid timeline):

```json
{
  "batchId": "batch_001",
  "cropId": "crop_tomato_san_marzano",
  "startedAt": "2026-03-01T00:00:00Z",
  "currentStage": "sowing",
  "stage": "sowing",
  "stageEvents": [
    {
      "stage": "sowing",
      "occurredAt": "2026-03-01T00:00:00Z",
      "location": "greenhouse-bench-a",
      "method": "direct-seed"
    }
  ],
  "assignments": []
}
```

### App state + settings

- `GET /api/app-state` -> `AppState | 404`
- `PUT /api/app-state` body `AppState` -> `204/200`
- `GET /api/settings` -> `Settings | 404`
- `PUT /api/settings` body `Settings` -> `Settings`

---

## Cross-language parity strategy (TypeScript and C#)

### Rule parity

Mirror critical business rules in C# domain services while preserving behavior from TS:

- batch stage transitions and stage event timeline integrity
- crop planning window interpretation
- task status transitions and scheduling interpretation
- inventory status thresholds (`available` / `low` / `depleted`)

### Golden vectors as the shared truth

- Treat `fixtures/golden/trier-v1.json` as a versioned shared dataset consumed by both TS and .NET tests.
- Add expected outputs for deterministic rule evaluations (e.g., derived task sets, filtered results, validation outcomes).
- Both runtimes must pass against the same fixture version before release.

### Contract tests as release gate

Minimum gate for TS/.NET divergence prevention:

1. Schema conformance tests for all serialized payloads.
2. Golden vector evaluation tests in both languages.
3. Endpoint contract tests validating query/filter semantics map exactly to repository interface expectations.

If either language fails parity, block release.

---

## Migration plan (incremental, low-risk)

### Phase 1: Contract generation pipeline

- Keep JSON Schema authoritative.
- Generate C# records from schema in CI and fail on diff.
- Continue TS generation unchanged.

### Phase 2: Repository parity

- Define .NET repository interfaces matching current TS interfaces.
- Implement HTTP adapters behind interfaces.
- Keep behavior equivalent to TS data access semantics.

### Phase 3: Domain rule mirror + parity tests

- Port critical domain rules into C# domain services.
- Introduce golden-vector tests using shared fixture.
- Add cross-language parity checks in CI.

### Phase 4: MAUI adoption patterns

- MAUI client consumes schema-generated C# contracts.
- Reuse same HTTP repositories used by backend-facing app layer.
- Use MVVM viewmodels that depend on application use cases/interfaces only.
- Keep UI-only concerns in MAUI layer; no domain rule branching in views.

### Phase 5: OpenAPI reconsideration checkpoint

- Re-evaluate only if review criteria are satisfied.
- If adopted, document one-way generation path and ownership to avoid dual-source drift.

---

## MAUI client guidance (practical)

- **Contracts**: use schema-generated records directly for transport DTOs.
- **Repositories**: share HTTP repository patterns and filter models from the .NET application stack.
- **ViewModels**:
  - one viewmodel per screen/use-case cluster
  - call application services/use cases, not raw HTTP
  - map to presentation-specific properties (formatting, grouping), without changing domain semantics
- **Offline evolution path**: add local persistence adapters under repository interfaces later; do not fork contracts.

## Non-goals for this phase

- No contract source split (JSON Schema + hand-authored OpenAPI in parallel).
- No large domain redesign during migration.
- No MAUI-specific business rule forks.

## Exit criteria for “ready to start .NET implementation”

- Team alignment on JSON Schema-first governance.
- Agreed endpoint naming and filter semantics for repository parity.
- Golden vector ownership/versioning documented and enforced.
- Initial CI gate draft covers schema conformance + parity checks.


## C# mapping examples for finalized vNext contracts

### Crop mapping (aliases + optional metadata)

```csharp
public sealed record CropDto(
    string? cropId,
    string? id,
    string? name,
    string? commonName,
    string? scientificName,
    IReadOnlyList<string>? aliases,
    bool? isUserDefined,
    object? rules,
    IReadOnlyList<object>? taskRules,
    IReadOnlyList<object>? nutritionProfile,
    DateTimeOffset createdAt,
    DateTimeOffset updatedAt
);

var canonicalCropId = dto.cropId ?? dto.id
    ?? throw new ValidationException("cropId/id required");
var canonicalName = dto.name ?? dto.commonName
    ?? throw new ValidationException("name/commonName required");

// Optional metadata stays nullable/empty to support partial user-defined crops.
var scientificName = dto.scientificName;
var aliases = dto.aliases ?? Array.Empty<string>();
```

### Batch mapping (canonical timeline + legacy parity fields)

```csharp
public sealed record BatchDto(
    string batchId,
    string cropId,
    DateTimeOffset startedAt,
    string stage,
    string? currentStage,
    IReadOnlyList<StageEventDto> stageEvents,
    IReadOnlyList<BedAssignmentDto> assignments,
    IReadOnlyList<BedAssignmentDto>? bedAssignments
);

var canonicalAssignments = dto.bedAssignments ?? dto.assignments;
var canonicalCurrentStage = dto.currentStage
    ?? dto.stageEvents[^1].stage;

// While aliases remain required in schema, write both canonical + alias fields.
```

### Optional rules behavior in processing pipelines

- Calendar/task processors should short-circuit rule-derived task generation when crop `rules`/`taskRules` are absent.
- Nutrition processors should skip crop-level nutrition contribution when `nutritionProfile` is absent.
- Missing optional metadata is a valid contract state, not a backend validation error.
