# Entity-by-Entity Migration Checklist

This checklist tracks command/query migration progress for write workflows across the targeted entities.

## Beds
- [x] `frontend/src/data/index.ts` has write commands: `upsertBed`, `removeBed`.
- [x] `frontend/src/data/workflowAdapter.ts` has backend requests: `bedsSegments.upsertBed`, `bedsSegments.removeBed`.
- [x] `frontend/src/App.tsx` uses command functions for writes (no direct bed persistence via `saveAppStateToIndexedDb`).
- [x] Post-write UI refreshes from query results (`listBeds`, `loadAppStateFromIndexedDb` mirror for batches).
- [x] Removed direct canonical `saveAppStateToIndexedDb` usage for bed-focused UI flows.

## Batches
- [x] `frontend/src/data/index.ts` has write commands: `upsertBatch`, `removeBatch`, `mutateBatchAssignment`, `transitionBatchStage`.
- [x] `frontend/src/data/workflowAdapter.ts` has backend requests under `batches`.
- [x] `frontend/src/App.tsx` uses batch command functions.
- [x] Post-write UI reloads state from backend-derived mirror (`loadAppStateFromIndexedDb` after commands).
- [x] Removed remaining direct `saveAppStateToIndexedDb` call in batch create/edit flow and switched batch import confirm to command writes.

## Tasks
- [x] `frontend/src/data/index.ts` has write commands: `upsertTask`, `regenerateCalendarTasks`.
- [x] `frontend/src/data/workflowAdapter.ts` has backend requests under `tasks`.
- [x] `frontend/src/App.tsx` uses task command functions.
- [x] Post-write UI refreshes task list from backend-derived state.
- [x] Removed direct canonical `saveAppStateToIndexedDb` in task regeneration UI flow.

## Crops
- [x] `frontend/src/data/index.ts` has write commands: `upsertCrop`, `removeCrop`, `importCrops`.
- [x] `frontend/src/data/workflowAdapter.ts` has backend requests under `taxonomy` for crop writes/import.
- [x] `frontend/src/App.tsx` uses crop command/import functions.
- [x] Post-write UI refreshes from query or mirrored backend state.
- [x] No direct canonical crop persistence in `App.tsx`.

## Species
- [x] `frontend/src/data/index.ts` has write commands: `upsertSpecies`, `removeSpecies`, `importSpecies`.
- [x] `frontend/src/data/workflowAdapter.ts` has backend requests under `taxonomy` for species writes/import.
- [x] `frontend/src/App.tsx` uses species command/import functions.
- [x] Post-write UI refreshes from `listSpecies`/`listCrops` queries.
- [x] No direct canonical species persistence in `App.tsx`.

## Crop Plans
- [x] `frontend/src/data/index.ts` has write commands: `upsertCropPlan`, `removeCropPlan`, `importCropPlans`.
- [x] `frontend/src/data/workflowAdapter.ts` has backend requests under `taxonomy` for crop plan writes/import.
- [x] `frontend/src/App.tsx` uses crop plan import command functions.
- [x] Post-write UI refreshes from `listCropPlans` query.
- [x] No direct canonical crop plan persistence in `App.tsx`.

## Seed Inventory
- [x] `frontend/src/data/index.ts` has write commands: `upsertSeedInventoryItem`, `removeSeedInventoryItem`.
- [x] `frontend/src/data/workflowAdapter.ts` has backend requests under `inventory`.
- [x] `frontend/src/App.tsx` uses inventory command functions.
- [x] Post-write UI reloads via inventory query helper (`loadInventory`).
- [x] No direct canonical seed inventory persistence in `App.tsx`.

## Segments / Import Flows
- [x] Added segment write commands in `frontend/src/data/index.ts`: `upsertSegment`, `removeSegment`, plus existing `importSegments`.
- [x] `frontend/src/data/workflowAdapter.ts` has backend requests: `bedsSegments.upsertSegment`, `bedsSegments.removeSegment`, `bedsSegments.importSegments`.
- [x] `frontend/src/App.tsx` segment and path save/delete routes now use segment commands instead of direct state persistence.
- [x] Post-write layout refresh uses query/read path (`listSegments`, `listBeds`, plus mirrored state read for batches).
- [x] Segment and batch import confirmation paths now route through command APIs instead of direct canonical merge persistence.

