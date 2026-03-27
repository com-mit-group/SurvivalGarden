using Microsoft.Extensions.DependencyInjection;
using SurvivalGarden.Application;

namespace SurvivalGarden.Persistence;

public static class DependencyInjection
{
    public static IServiceCollection AddPersistence(this IServiceCollection services, string? appStatePath = null)
    {
        var resolvedPath = appStatePath ?? Path.Combine(AppContext.BaseDirectory, "data", "app-state.json");
        services.AddSingleton<IGardenStateStore>(_ => new JsonFileGardenStateStore(resolvedPath));
        return services;
    }
}
