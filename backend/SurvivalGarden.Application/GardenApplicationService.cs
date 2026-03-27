using System.Text.Json.Nodes;

namespace SurvivalGarden.Application;

public sealed class GardenApplicationService(IGardenStateStore store) : IGardenApplicationService
{
    private static readonly string[] RootCollections =
    [
        "species",
        "crops",
        "cultivars",
        "batches",
        "segments",
        "beds",
        "paths",
        "seedInventoryItems",
        "cropPlans"
    ];

    public Task<JsonObject?> LoadAppStateAsync(CancellationToken cancellationToken = default) => store.LoadAsync(cancellationToken);

    public async Task SaveAppStateAsync(JsonObject appState, CancellationToken cancellationToken = default)
    {
        EnsureRootCollections(appState);
        await store.SaveAsync(appState, cancellationToken);
    }

    public async Task<JsonArray> ListAsync(string collectionName, CancellationToken cancellationToken = default)
    {
        var state = await EnsureStateAsync(cancellationToken);
        return GardenJsonCollectionHelpers.CloneArray(GardenJsonCollectionHelpers.GetCollection(state, collectionName));
    }

    public async Task<JsonObject?> GetByIdAsync(string collectionName, string idProperty, string id, CancellationToken cancellationToken = default)
    {
        var records = await ListAsync(collectionName, cancellationToken);
        return records
            .OfType<JsonObject>()
            .FirstOrDefault(x => string.Equals(x[idProperty]?.GetValue<string>(), id, StringComparison.Ordinal));
    }

    public async Task<JsonObject> UpsertAsync(string collectionName, string idProperty, JsonObject entity, CancellationToken cancellationToken = default)
    {
        var validation = Validate(collectionName, entity);
        if (!validation.Ok)
        {
            throw new InvalidOperationException(string.Join("; ", validation.Issues.Select(i => $"{i.Path}: {i.Message}")));
        }

        if (collectionName == "batches")
        {
            GardenJsonCollectionHelpers.CanonicalizeBatchAliases(entity);
        }

        var state = await EnsureStateAsync(cancellationToken);
        var records = GardenJsonCollectionHelpers.GetCollection(state, collectionName);
        var entityId = entity[idProperty]?.GetValue<string>() ?? string.Empty;

        var existingIndex = records
            .Select((node, index) => new { node, index })
            .FirstOrDefault(entry =>
                entry.node is JsonObject item &&
                string.Equals(item[idProperty]?.GetValue<string>(), entityId, StringComparison.Ordinal))
            ?.index;

        if (existingIndex.HasValue)
        {
            records[existingIndex.Value] = entity.DeepClone();
        }
        else
        {
            records.Add(entity.DeepClone());
        }

        await store.SaveAsync(state, cancellationToken);
        return (JsonObject)entity.DeepClone();
    }

    public async Task<bool> RemoveAsync(string collectionName, string idProperty, string id, CancellationToken cancellationToken = default)
    {
        var state = await EnsureStateAsync(cancellationToken);
        var records = GardenJsonCollectionHelpers.GetCollection(state, collectionName);

        var existingIndex = records
            .Select((node, index) => new { node, index })
            .FirstOrDefault(entry =>
                entry.node is JsonObject item &&
                string.Equals(item[idProperty]?.GetValue<string>(), id, StringComparison.Ordinal))
            ?.index;

        if (!existingIndex.HasValue)
        {
            return false;
        }

        records.RemoveAt(existingIndex.Value);
        await store.SaveAsync(state, cancellationToken);
        return true;
    }

    public async Task<JsonArray> ListBatchesAsync(string? stage, string? cropId, string? bedId, string? startedAtFrom, string? startedAtTo, CancellationToken cancellationToken = default)
    {
        var records = await ListAsync("batches", cancellationToken);
        var fromDate = GardenJsonCollectionHelpers.ParseIso(startedAtFrom);
        var toDate = GardenJsonCollectionHelpers.ParseIso(startedAtTo);

        var filtered = records
            .OfType<JsonObject>()
            .Where(batch => string.IsNullOrWhiteSpace(stage) || string.Equals(batch["stage"]?.GetValue<string>(), stage, StringComparison.OrdinalIgnoreCase))
            .Where(batch => string.IsNullOrWhiteSpace(cropId) || string.Equals(batch["cropId"]?.GetValue<string>(), cropId, StringComparison.Ordinal))
            .Where(batch => string.IsNullOrWhiteSpace(bedId) || GardenJsonCollectionHelpers.HasBedAssignment(batch, bedId))
            .Where(batch =>
            {
                var startedAt = GardenJsonCollectionHelpers.ParseIso(batch["startedAt"]?.GetValue<string>());
                if (fromDate.HasValue && (!startedAt.HasValue || startedAt.Value < fromDate.Value)) return false;
                if (toDate.HasValue && (!startedAt.HasValue || startedAt.Value > toDate.Value)) return false;
                return true;
            })
            .Select(batch => batch.DeepClone())
            .ToArray();

        return new JsonArray(filtered);
    }

    public ValidationResult Validate(string collectionName, JsonObject entity)
    {
        return collectionName switch
        {
            "species" => RequireId(entity, "id"),
            "crops" => RequireId(entity, "cropId"),
            "cultivars" => RequireId(entity, "id"),
            "batches" => RequireId(entity, "batchId"),
            "segments" => RequireId(entity, "segmentId"),
            "beds" => RequireId(entity, "bedId"),
            "paths" => RequireId(entity, "pathId"),
            "seedInventoryItems" => RequireId(entity, "seedInventoryItemId"),
            "cropPlans" => RequireId(entity, "planId"),
            _ => ValidationResult.Success()
        };
    }

    private static ValidationResult RequireId(JsonObject entity, string idProperty)
    {
        var idValue = entity[idProperty]?.GetValue<string>();
        if (!string.IsNullOrWhiteSpace(idValue))
        {
            return ValidationResult.Success();
        }

        return ValidationResult.Failure(new ValidationIssue($"/{idProperty}", "is required"));
    }

    private async Task<JsonObject> EnsureStateAsync(CancellationToken cancellationToken)
    {
        var state = await store.LoadAsync(cancellationToken) ?? new JsonObject();
        EnsureRootCollections(state);
        return state;
    }

    private static void EnsureRootCollections(JsonObject state)
    {
        foreach (var name in RootCollections)
        {
            _ = GardenJsonCollectionHelpers.GetCollection(state, name);
        }
    }
}
