# ADR-00Y: Event History and Canonical State Policy

## Status
Accepted

## Date
2026-05-18

## Context
SurvivalGarden emits domain/application events for auditability and integration workflows while also persisting current canonical state for reads and writes. Review feedback has shown ambiguity about whether event streams can be treated as canonical data stores or replay sources.

This ADR clarifies event-history boundaries to keep storage, query, and integration behavior consistent across backend, frontend, and documentation.

## Decision

1. **Canonical source for reads/writes is current-state persistence.**
   - The current-state store is the single canonical query and write source.
   - All API query and command behavior must rely on canonical current-state persistence, not event log replay.

2. **Events are append-only history and integration artifacts.**
   - Emitted events are append-only historical records.
   - Event streams are used for integration, notification, analytics, and auditing use cases.
   - Event consumers must not treat event logs as the authoritative source for entity current state.

3. **Rebuild-from-replay is out of scope for the current architecture.**
   - Reconstructing canonical application state by replaying historical events is explicitly out of scope.
   - No service or endpoint should require full event replay to answer canonical state queries or process canonical writes.

4. **Event schema versioning and compatibility policy.**
   - Every event contract must carry an explicit version identifier (for example, semantic event type versioning or explicit schema-version field).
   - Event changes must default to additive, backward-compatible evolution for existing subscribers.
   - Breaking event schema changes require introducing a new event version and a documented migration/deprecation path for subscribers.
   - Existing event versions must remain consumable for a defined overlap period during rollout.

## Allowed patterns (examples)

- Persisting updated batch `currentStage` and `stageEvents` in canonical storage, then emitting a `StageAdvanced` event for downstream subscribers.
- Reading current batch status from canonical persistence for API responses, while separately using events for audit timelines.
- Adding an optional field (for example `meta.correlationId`) to an existing event version without breaking existing subscribers.
- Publishing `StageAdvanced.v2` while continuing to support `StageAdvanced.v1` during migration.

## Disallowed patterns (examples)

- Serving canonical `GET /api/batches/{id}` by replaying all historical stage events instead of reading canonical persisted state.
- Applying canonical write logic by appending events only, without updating canonical current-state persistence.
- Replacing canonical database migrations with one-time global event replay as the primary state rebuild mechanism.
- Introducing incompatible event payload changes under the same event version without a version bump and migration plan.

## Consequences

- PR reviews should reject code/designs that imply event logs are canonical state stores.
- Integration/eventing evolution remains possible without destabilizing canonical reads/writes.
- Subscriber compatibility risk is reduced through explicit versioning and overlap policy.

## References

- `docs/adr/ADR-00X-backend-authority-and-boundaries.md`
- `docs/workflow-endpoint-ownership.md`
- `docs/llm-workflow.md`
- `docs/stage-event-bus-rollout.md`
