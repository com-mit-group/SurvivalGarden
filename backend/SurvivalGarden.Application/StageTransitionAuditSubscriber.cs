using System.Collections.Concurrent;

namespace SurvivalGarden.Application;

public interface IStageTransitionAuditSink
{
    // Lightweight best-effort sink for side-effects only; not durable across process restarts.
    void Record(IApplicationEvent applicationEvent);
}

internal sealed class InMemoryStageTransitionAuditSink : IStageTransitionAuditSink
{
    private readonly ConcurrentQueue<IApplicationEvent> _events = new();

    public void Record(IApplicationEvent applicationEvent) => _events.Enqueue(applicationEvent);
}

internal sealed class StageTransitionAuditSubscriber(IStageTransitionAuditSink sink) :
    IApplicationEventSubscriber<StageAdvanced>,
    IApplicationEventSubscriber<StageRegressed>,
    IApplicationEventSubscriber<StageCompleted>
{
    public Task HandleAsync(StageAdvanced applicationEvent, CancellationToken cancellationToken = default)
    {
        sink.Record(applicationEvent);
        return Task.CompletedTask;
    }

    public Task HandleAsync(StageRegressed applicationEvent, CancellationToken cancellationToken = default)
    {
        sink.Record(applicationEvent);
        return Task.CompletedTask;
    }

    public Task HandleAsync(StageCompleted applicationEvent, CancellationToken cancellationToken = default)
    {
        sink.Record(applicationEvent);
        return Task.CompletedTask;
    }
}
