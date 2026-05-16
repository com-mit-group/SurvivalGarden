namespace SurvivalGarden.Application;

// NOTE: thin local contracts to keep transition side-effects decoupled; can be swapped to shared events package later.
public interface IApplicationEvent;

public interface IApplicationEventPublisher
{
    Task PublishAsync(IApplicationEvent applicationEvent, CancellationToken cancellationToken = default);
}

public interface IApplicationEventSubscriber<in TEvent> where TEvent : IApplicationEvent
{
    Task HandleAsync(TEvent applicationEvent, CancellationToken cancellationToken = default);
}

public sealed record StageAdvanced(
    string BatchId,
    string PreviousStage,
    string CurrentStage,
    string OccurredAt,
    int StageEventCount) : IApplicationEvent;

public sealed record StageRegressed(
    string BatchId,
    string PreviousStage,
    string CurrentStage,
    string OccurredAt,
    int StageEventCount) : IApplicationEvent;

public sealed record StageCompleted(
    string BatchId,
    string PreviousStage,
    string CurrentStage,
    string OccurredAt,
    int StageEventCount) : IApplicationEvent;
