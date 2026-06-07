using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using SurvivalGarden.Application;

namespace SurvivalGarden.Maui;

public sealed class LocalGardenBackend(IServiceScopeFactory scopeFactory) : ILocalGardenBackend
{
    public async Task<LocalGardenStateSummary> LoadStateSummaryAsync(CancellationToken cancellationToken = default)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var applicationService = scope.ServiceProvider.GetRequiredService<IGardenApplicationService>();
        var state = await applicationService.LoadAppStateAsync(cancellationToken);

        if (state is null)
        {
            return new LocalGardenStateSummary(false, 0);
        }

        var entityCount = state
            .Select(entry => entry.Value)
            .OfType<JsonArray>()
            .Sum(collection => collection.Count);

        return new LocalGardenStateSummary(true, entityCount);
    }
}
