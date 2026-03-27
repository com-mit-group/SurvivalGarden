using System.Text.Json.Nodes;

namespace SurvivalGarden.Application;

public interface IGardenApplicationService
{
    Task<JsonObject?> LoadAppStateAsync(CancellationToken cancellationToken = default);
    Task SaveAppStateAsync(JsonObject appState, CancellationToken cancellationToken = default);

    Task<JsonArray> ListAsync(string collectionName, CancellationToken cancellationToken = default);
    Task<JsonObject?> GetByIdAsync(string collectionName, string idProperty, string id, CancellationToken cancellationToken = default);
    Task<JsonObject> UpsertAsync(string collectionName, string idProperty, JsonObject entity, CancellationToken cancellationToken = default);
    Task<bool> RemoveAsync(string collectionName, string idProperty, string id, CancellationToken cancellationToken = default);

    Task<JsonArray> ListBatchesAsync(string? stage, string? cropId, string? bedId, string? startedAtFrom, string? startedAtTo, CancellationToken cancellationToken = default);

    ValidationResult Validate(string collectionName, JsonObject entity);
}
