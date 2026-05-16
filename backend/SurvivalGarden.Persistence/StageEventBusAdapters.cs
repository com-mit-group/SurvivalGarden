using Microsoft.Extensions.DependencyInjection;
using SurvivalGarden.Application;
using Yaref92.Events;
using Yaref92.Events.Abstractions;

namespace SurvivalGarden.Persistence;

internal sealed class LocalStageEventBusAdapter(IApplicationEventPublisher publisher) : IStageEventBus
{
    public Task PublishAsync(IApplicationEvent stageEvent, CancellationToken cancellationToken = default) =>
        publisher.PublishAsync(stageEvent, cancellationToken);
}

internal sealed class StageEventBusAdapter(IEventAggregator aggregator) : IStageEventBus
{
    public Task PublishAsync(IApplicationEvent stageEvent, CancellationToken cancellationToken = default)
    {
        aggregator.RegisterEventType<StageTransitionEnvelopeEvent>();
        return aggregator.PublishEventAsync(new StageTransitionEnvelopeEvent(stageEvent), cancellationToken);
    }
}

internal sealed class StageTransitionEnvelopeEvent(IApplicationEvent payload) : DomainEventBase
{
    public IApplicationEvent Payload { get; } = payload;
}

internal sealed class InProcessApplicationEventPublisher(IServiceProvider serviceProvider) : IApplicationEventPublisher
{
    public async Task PublishAsync(IApplicationEvent applicationEvent, CancellationToken cancellationToken = default)
    {
        var subscriberType = typeof(IApplicationEventSubscriber<>).MakeGenericType(applicationEvent.GetType());
        var subscribers = serviceProvider.GetServices(subscriberType);
        foreach (var subscriber in subscribers)
        {
            var method = subscriberType.GetMethod(nameof(IApplicationEventSubscriber<IApplicationEvent>.HandleAsync));
            if (method is null)
            {
                continue;
            }

            var task = (Task?)method.Invoke(subscriber, [applicationEvent, cancellationToken]);
            if (task is not null)
            {
                await task;
            }
        }
    }
}
