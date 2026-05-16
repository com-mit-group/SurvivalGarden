using Microsoft.Extensions.DependencyInjection;

namespace SurvivalGarden.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddSingleton<IStageTransitionAuditSink, InMemoryStageTransitionAuditSink>();
        services.AddScoped<IApplicationEventSubscriber<StageAdvanced>, StageTransitionAuditSubscriber>();
        services.AddScoped<IApplicationEventSubscriber<StageRegressed>, StageTransitionAuditSubscriber>();
        services.AddScoped<IApplicationEventSubscriber<StageCompleted>, StageTransitionAuditSubscriber>();
        services.AddScoped<IGardenApplicationService, GardenApplicationService>();
        return services;
    }
}
