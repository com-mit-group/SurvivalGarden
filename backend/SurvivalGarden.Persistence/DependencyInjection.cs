using Microsoft.Extensions.DependencyInjection;
using SurvivalGarden.Application;

namespace SurvivalGarden.Persistence;

public static class DependencyInjection
{
    public static IServiceCollection AddPersistence(this IServiceCollection services, string? appStatePath = null)
    {
        var resolvedPath = appStatePath ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "data", "app-state.json"));

        // Current default adapter is file-backed JSON persistence.
        // The IGardenStateStore abstraction remains the seam for swapping to a database-backed adapter later.
        services.AddSingleton<IGardenStateStore>(_ => new JsonFileGardenStateStore(resolvedPath));

        return services;
    }
}
