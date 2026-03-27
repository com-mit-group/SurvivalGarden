using System.Text.Json.Nodes;

namespace SurvivalGarden.Application;

public sealed record ValidationIssue(string Path, string Message);

public sealed record ValidationResult(bool Ok, IReadOnlyList<ValidationIssue> Issues)
{
    public static ValidationResult Success() => new(true, []);
    public static ValidationResult Failure(params ValidationIssue[] issues) => new(false, issues);
}

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

public interface IGardenStateStore
{
    Task<JsonObject?> LoadAsync(CancellationToken cancellationToken = default);
    Task SaveAsync(JsonObject appState, CancellationToken cancellationToken = default);
}

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
        return CloneArray(GetCollection(state, collectionName));
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
            CanonicalizeBatchAliases(entity);
        }

        var state = await EnsureStateAsync(cancellationToken);
        var records = GetCollection(state, collectionName);
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
        var records = GetCollection(state, collectionName);

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
        var fromDate = ParseIso(startedAtFrom);
        var toDate = ParseIso(startedAtTo);

        var filtered = records
            .OfType<JsonObject>()
            .Where(batch => string.IsNullOrWhiteSpace(stage) || string.Equals(batch["stage"]?.GetValue<string>(), stage, StringComparison.OrdinalIgnoreCase))
            .Where(batch => string.IsNullOrWhiteSpace(cropId) || string.Equals(batch["cropId"]?.GetValue<string>(), cropId, StringComparison.Ordinal))
            .Where(batch => string.IsNullOrWhiteSpace(bedId) || HasBedAssignment(batch, bedId))
            .Where(batch =>
            {
                var startedAt = ParseIso(batch["startedAt"]?.GetValue<string>());
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

    private static void CanonicalizeBatchAliases(JsonObject batch)
    {
        if (batch["currentStage"] is null && batch["stage"] is not null)
        {
            batch["currentStage"] = batch["stage"]?.DeepClone();
        }

        if (batch["stage"] is null && batch["currentStage"] is not null)
        {
            batch["stage"] = batch["currentStage"]?.DeepClone();
        }

        if (batch["assignments"] is null && batch["bedAssignments"] is not null)
        {
            batch["assignments"] = batch["bedAssignments"]?.DeepClone();
        }

        if (batch["bedAssignments"] is null && batch["assignments"] is not null)
        {
            batch["bedAssignments"] = batch["assignments"]?.DeepClone();
        }

        if (batch["stageEvents"] is null)
        {
            batch["stageEvents"] = new JsonArray();
        }

        if (batch["assignments"] is null)
        {
            batch["assignments"] = new JsonArray();
        }

        if (batch["bedAssignments"] is null)
        {
            batch["bedAssignments"] = batch["assignments"]?.DeepClone();
        }
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
            _ = GetCollection(state, name);
        }
    }

    private static JsonArray GetCollection(JsonObject state, string name)
    {
        if (state[name] is JsonArray existing)
        {
            return existing;
        }

        var created = new JsonArray();
        state[name] = created;
        return created;
    }

    private static JsonArray CloneArray(JsonArray source)
    {
        return new JsonArray(source.Select(item => item?.DeepClone()).ToArray());
    }

    private static bool HasBedAssignment(JsonObject batch, string bedId)
    {
        var assignments = batch["assignments"] as JsonArray ?? batch["bedAssignments"] as JsonArray;
        if (assignments is null)
        {
            return false;
        }

        return assignments
            .OfType<JsonObject>()
            .Any(assignment => string.Equals(assignment["bedId"]?.GetValue<string>(), bedId, StringComparison.Ordinal));
    }

    private static DateTimeOffset? ParseIso(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return DateTimeOffset.TryParse(value, out var parsed) ? parsed : null;
    }
}
