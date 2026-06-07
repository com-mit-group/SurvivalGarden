namespace SurvivalGarden.Maui;

public interface ILocalGardenBackend
{
    Task<LocalGardenStateSummary> LoadStateSummaryAsync(CancellationToken cancellationToken = default);
}

public sealed record LocalGardenStateSummary(bool HasState, int EntityCount);
