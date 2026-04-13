using System.Text.Json.Nodes;
using System.Globalization;

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
        "cropPlans",
        "tasks"
    ];

    public async Task<JsonObject?> LoadAppStateAsync(CancellationToken cancellationToken = default)
    {
        var state = await store.LoadAsync(cancellationToken);
        if (state is null)
        {
            return null;
        }

        EnsureRootCollections(state);
        return state;
    }

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
        var entityId = entity[idProperty]?.GetValue<string>() ?? entity["id"]?.GetValue<string>() ?? string.Empty;

        var existingIndex = records
            .Select((node, index) => new { node, index })
            .FirstOrDefault(entry =>
                entry.node is JsonObject item &&
                (string.Equals(item[idProperty]?.GetValue<string>(), entityId, StringComparison.Ordinal) ||
                 string.Equals(item["id"]?.GetValue<string>(), entityId, StringComparison.Ordinal)))
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
                (string.Equals(item[idProperty]?.GetValue<string>(), id, StringComparison.Ordinal) ||
                 string.Equals(item["id"]?.GetValue<string>(), id, StringComparison.Ordinal)))
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
            "species" => RequireAnyId(entity, "id"),
            "crops" => RequireAnyId(entity, "cropId"),
            "cultivars" => RequireAnyId(entity, "id"),
            "batches" => RequireAnyId(entity, "batchId"),
            "segments" => RequireAnyId(entity, "segmentId"),
            "beds" => RequireAnyId(entity, "bedId"),
            "paths" => RequireAnyId(entity, "pathId"),
            "seedInventoryItems" => RequireAnyId(entity, "seedInventoryItemId"),
            "cropPlans" => RequireAnyId(entity, "planId"),
            _ => ValidationResult.Success()
        };
    }

    private static ValidationResult RequireAnyId(JsonObject entity, string preferredIdProperty)
    {
        var preferred = entity[preferredIdProperty]?.GetValue<string>();
        var generic = entity["id"]?.GetValue<string>();

        if (!string.IsNullOrWhiteSpace(preferred) || !string.IsNullOrWhiteSpace(generic))
        {
            return ValidationResult.Success();
        }

        return ValidationResult.Failure(
            new ValidationIssue($"/{preferredIdProperty}", "is required"),
            new ValidationIssue("/id", "is required")
        );
    }

    private async Task<JsonObject> EnsureStateAsync(CancellationToken cancellationToken)
    {
        var state = await store.LoadAsync(cancellationToken) ?? new JsonObject();
        EnsureRootCollections(state);
        return state;
    }

    private static void EnsureRootCollections(JsonObject state)
    {
        if (state["schemaVersion"] is null)
        {
            state["schemaVersion"] = 1;
        }

        if (state["settings"] is not JsonObject)
        {
            state["settings"] = new JsonObject
            {
                ["settingsId"] = "settings-default",
                ["locale"] = "de-DE",
                ["timezone"] = "Europe/Berlin",
                ["weekStartsOn"] = "monday",
                ["units"] = new JsonObject
                {
                    ["temperature"] = "celsius",
                    ["yield"] = "metric"
                },
                ["createdAt"] = UtcNowIso(),
                ["updatedAt"] = UtcNowIso()
            };
        }

        foreach (var name in RootCollections)
        {
            _ = GardenJsonCollectionHelpers.GetCollection(state, name);
        }
    }

    private static string UtcNowIso() =>
        DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
}
