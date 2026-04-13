using System.Text.Json.Nodes;

namespace SurvivalGarden.Application;

public interface IGardenStateStore
{
    Task<JsonObject?> LoadAsync(CancellationToken cancellationToken = default);
    Task SaveAsync(JsonObject appState, CancellationToken cancellationToken = default);
}
