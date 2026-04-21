# Live contract verification

This runbook verifies that the frontend-generated API contract still matches a live backend instance and that backend-mode routing works end-to-end.

## Prerequisites

- `dotnet` (for backend)
- `pnpm` + Node.js (for frontend)
- `python3` (to host fetched OpenAPI artifact at `openapi-v1.json`)
- `curl`

## 1) Start backend

From repository root:

```bash
dotnet run --project backend/SurvivalGarden.Api/SurvivalGarden.Api.csproj --urls http://127.0.0.1:5142
```

Keep this terminal running for the next steps.

## 2) Fetch backend OpenAPI as `openapi-v1.json`

In a separate terminal:

```bash
mkdir -p .artifacts/openapi
curl -fsSL http://127.0.0.1:5142/openapi/v1.json -o .artifacts/openapi/openapi-v1.json
```

Optionally validate that the file is available over HTTP (same shape CI uses):

```bash
python3 -m http.server 5178 --directory .artifacts/openapi
# then open: http://127.0.0.1:5178/openapi-v1.json
```

## 3) Regenerate frontend types with `BACKEND_OPENAPI_URL`

```bash
BACKEND_OPENAPI_URL=http://127.0.0.1:5178/openapi-v1.json \
REQUIRE_BACKEND_OPENAPI=1 \
pnpm --dir frontend gen:types
```

## 4) Diff check generated files (drift detection)

```bash
git diff --exit-code -- \
  frontend/src/generated/contracts.ts \
  frontend/src/generated/openapi-paths.ts \
  frontend/src/generated/api-client.ts
```

## 5) Run typecheck + tests

```bash
pnpm --dir frontend typecheck
pnpm --dir frontend test
```

For quick backend-routing verification only:

```bash
pnpm --dir frontend exec vitest run \
  src/data/index.cutoverRouting.test.ts \
  src/data/repos/workflowRouting.test.ts
```

## 6) Run frontend in backend mode

```bash
VITE_FRONTEND_MODE=backend \
VITE_BACKEND_API_BASE_URL=http://127.0.0.1:5142 \
pnpm --dir frontend dev
```

## 7) Manual smoke test checklist (backend mode)

Use the running frontend (`pnpm --dir frontend dev`) with DevTools Network tab open.

### Beds

1. Create one Bed.
2. Update that Bed (for example name/notes).
3. Delete that Bed.

Verify expected network activity:

- `POST /api/beds` includes created Bed payload.
- `PUT /api/beds/{id}` includes updated fields.
- `DELETE /api/beds/{id}` returns success and the UI list updates.

### Crops

1. Create one Crop.
2. Update that Crop.
3. Delete that Crop.

Verify expected network activity:

- `POST /api/crops`
- `PUT /api/crops/{id}`
- `DELETE /api/crops/{id}`

### Seed inventory

1. Create one SeedInventoryItem (if needed for delete path).
2. Delete one SeedInventoryItem.

Verify expected network activity:

- `DELETE /api/seed-inventory/{id}`

### DevTools payload checks

For each create/update/delete request above:

- Confirm request `Content-Type` is JSON when a body is present.
- Confirm request/response payload fields match generated contract expectations (required fields present, no unexpected shape changes).
- Confirm HTTP status is success (`2xx`) and no contract mismatch errors appear in UI/console.

## Pass/fail criteria

### Pass

- `gen:types` succeeds against `BACKEND_OPENAPI_URL`.
- Generated files have no git diff after regeneration.
- Selected backend-routing tests pass.
- Full `typecheck` + `test` pass.
- Manual Bed/Crop/SeedInventoryItem smoke actions succeed with expected backend requests.

### Fail: contract drift

Any of these indicates drift between checked-in generated frontend artifacts and live backend contract:

- `gen:types` modifies one or more generated files.
- `git diff --exit-code` fails on generated files.

### Fail: runtime schema mismatch

Any of these indicates payload/runtime mismatch despite compile-time generation:

- Backend-mode operations fail with contract validation errors (for example, "Backend contract mismatch ...").
- Browser Network responses show missing required fields or incompatible types for entities used by the UI.
- Manual smoke CRUD operations fail (`4xx/5xx`) due to schema/shape incompatibility.
