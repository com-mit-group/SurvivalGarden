using Microsoft.Extensions.DependencyInjection;

namespace SurvivalGarden.Application;

internal sealed class ApplicationEventPublisher(IServiceProvider serviceProvider) : IApplicationEventPublisher
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
