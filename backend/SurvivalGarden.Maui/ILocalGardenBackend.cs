namespace SurvivalGarden.Maui;

public interface ILocalGardenBackend
{
    Task<LocalGardenSnapshot> LoadSnapshotAsync(CancellationToken cancellationToken = default);
}

public sealed record GardenRecordSummary(string Id, string Title, string Subtitle, string Detail);

public sealed record LocalGardenSnapshot(
    bool HasState,
    int EntityCount,
    DateTimeOffset LoadedAt,
    IReadOnlyDictionary<string, IReadOnlyList<GardenRecordSummary>> Collections)
{
    public IReadOnlyList<GardenRecordSummary> GetCollection(string name)
    {
        return Collections.TryGetValue(name, out var records) ? records : [];
    }
}
