using Microsoft.Extensions.DependencyInjection;
using SurvivalGarden.Application;
using Yaref92.Events;

namespace SurvivalGarden.Persistence;

public static class DependencyInjection
{
    public static IServiceCollection AddPersistence(this IServiceCollection services, string? appStatePath = null, string? stageEventBusAdapter = null)
    {
        var resolvedPath = appStatePath ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "data", "app-state.json"));
        var adapter = (stageEventBusAdapter ?? "External").Trim();

        // Current default adapter is file-backed JSON persistence.
        // The IGardenStateStore abstraction remains the seam for swapping to a database-backed adapter later.
        services.AddSingleton<IGardenStateStore>(_ => new JsonFileGardenStateStore(resolvedPath));
        if (!string.Equals(adapter, "External", StringComparison.OrdinalIgnoreCase))
        {
            services.AddScoped<IApplicationEventPublisher, InProcessApplicationEventPublisher>();
        }

        services.AddScoped<IStageEventBus>(serviceProvider =>
            string.Equals(adapter, "External", StringComparison.OrdinalIgnoreCase)
                ? new StageEventBusAdapter(serviceProvider.GetRequiredService<IEventPublisher>())
                : new LocalStageEventBusAdapter(serviceProvider.GetRequiredService<IApplicationEventPublisher>()));

        return services;
    }
}
