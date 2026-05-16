using Microsoft.Extensions.DependencyInjection;
using SurvivalGarden.Application;
using Yaref92.Events;
using Yaref92.Events.Abstractions;

namespace SurvivalGarden.Persistence;

public static class DependencyInjection
{
    private const string ExternalAdapter = "External";

    public static IServiceCollection AddPersistence(this IServiceCollection services, string? appStatePath = null, string? stageEventBusAdapter = null)
    {
        var resolvedPath = appStatePath ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "data", "app-state.json"));
        var adapter = (stageEventBusAdapter ?? ExternalAdapter).Trim();
        var useExternalAdapter = string.Equals(adapter, ExternalAdapter, StringComparison.OrdinalIgnoreCase);

        // Current default adapter is file-backed JSON persistence.
        // The IGardenStateStore abstraction remains the seam for swapping to a database-backed adapter later.
        services.AddSingleton<IGardenStateStore>(_ => new JsonFileGardenStateStore(resolvedPath));
        if (useExternalAdapter)
        {
            services.AddScoped<IEventAggregator, EventAggregator>();
            services.AddScoped<IStageEventBus, StageEventBusAdapter>();
        }
        else
        {
            services.AddScoped<IApplicationEventPublisher, InProcessApplicationEventPublisher>();
            services.AddScoped<IStageEventBus, LocalStageEventBusAdapter>();
        }

        return services;
    }
}
