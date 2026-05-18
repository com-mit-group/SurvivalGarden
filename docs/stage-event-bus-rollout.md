# Stage Event Bus Rollout Plan

## Scope

- Introduce `IStageEventBus` as the application-level abstraction for stage-transition event publication.
- Keep non-stage event flows on the baseline in-process publisher.
- Roll out the external stage event bus (`Yaref92.Events`) for stage transition events via configuration switch.

## Adapter Modes

- `External` (default): stage transition events are routed through `Yaref92.Events` `IEventAggregator` using `PublishEventAsync`, with event type registration and subscription configured in DI.
- `InProcess`: wraps the existing in-process subscriber dispatch behavior.

## Pilot Rollout

1. Deploy with `Events:StageEventBusAdapter=External` as the default path.
2. Verify parity in environments where `Events:StageEventBusAdapter=InProcess`.
   - Ensure `Yaref92.Events` services (including `IEventAggregator`) are registered in DI for that environment.
3. Limit pilot verification to stage transitions (`StageAdvanced`, `StageRegressed`, `StageCompleted`).
4. Keep all other event flows on baseline `IApplicationEventPublisher` behavior.

## Acceptance Metrics

### 1) Handler latency

- **Metric:** p50/p95 elapsed time from stage transition save completion to subscriber completion.
- **Target:** no more than 10% p95 regression versus `External` baseline over a representative workload.

### 2) Error isolation

- **Metric:** failed stage-event dispatches do not corrupt persisted batch stage transition data.
- **Target:** 100% of transition writes remain durable even when adapter publish fails.

### 3) Developer ergonomics

- **Metric:** no call-site changes required outside DI/config to switch adapters.
- **Target:** adapter swap performed only through `Events:StageEventBusAdapter` configuration and DI wiring.

### 4) No behavioral drift in stage transition outcomes

- **Metric:** same transition validation and resulting batch `currentStage`/`stageEvents` content across adapters.
- **Target:** identical API-observable transition outcomes between `InProcess` and `External` modes.
