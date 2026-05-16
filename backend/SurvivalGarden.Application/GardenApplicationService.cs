using System.Text.Json.Nodes;
using System.Globalization;

namespace SurvivalGarden.Application;

public sealed class GardenApplicationService(IGardenStateStore store, IApplicationEventPublisher eventPublisher) : IGardenApplicationService
{
    private const string BatchNotFoundError = "batch_not_found";
    private const string InvalidStageTransitionError = "invalid_stage_transition";

    private static readonly string[] RootCollections =
    [
        "species",
        "crops",
        "cultivars",
        "batches",
        "segments",
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
        var rows = GardenJsonCollectionHelpers.CloneArray(GardenJsonCollectionHelpers.GetCollection(state, collectionName));
        if (collectionName != "batches")
        {
            return rows;
        }

        foreach (var batch in rows.OfType<JsonObject>())
        {
            GardenJsonCollectionHelpers.NormalizeBatchForPersistence(batch);
        }

        return rows;
    }

    public async Task<JsonObject?> GetByIdAsync(string collectionName, string idProperty, string id, CancellationToken cancellationToken = default)
    {
        var records = await ListAsync(collectionName, cancellationToken);
        var row = records
            .OfType<JsonObject>()
            .FirstOrDefault(x => string.Equals(x[idProperty]?.GetValue<string>(), id, StringComparison.Ordinal));

        if (row is null || collectionName != "batches")
        {
            return row;
        }

        GardenJsonCollectionHelpers.NormalizeBatchForPersistence(row);
        return row;
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
            GardenJsonCollectionHelpers.NormalizeBatchForPersistence(entity);
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
            .Where(batch => string.IsNullOrWhiteSpace(stage) || string.Equals(batch["currentStage"]?.GetValue<string>(), stage, StringComparison.OrdinalIgnoreCase))
            .Where(batch => string.IsNullOrWhiteSpace(cropId) || string.Equals(batch["cultivarId"]?.GetValue<string>(), cropId, StringComparison.Ordinal))
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

    public async Task<(bool Ok, string? Error, JsonObject? Batch)> ApplyBatchStageTransitionAsync(string batchId, string nextStage, string occurredAt, CancellationToken cancellationToken = default)
    {
        var state = await EnsureStateAsync(cancellationToken);
        var batch = GardenJsonCollectionHelpers.GetCollection(state, "batches")
            .OfType<JsonObject>()
            .FirstOrDefault(candidate => string.Equals(candidate["batchId"]?.GetValue<string>(), batchId, StringComparison.Ordinal));
        if (batch is null)
        {
            return (false, BatchNotFoundError, null);
        }

        var currentStage = NormalizeStage(batch["currentStage"]?.GetValue<string>() ?? batch["stage"]?.GetValue<string>() ?? "unknown");
        var normalizedNextStage = NormalizeStage(nextStage);
        if (normalizedNextStage != currentStage && !CanTransition(currentStage, normalizedNextStage))
        {
            return (false, InvalidStageTransitionError, batch);
        }

        var stageEvents = batch["stageEvents"] as JsonArray ?? new JsonArray();
        var transitionChanged = normalizedNextStage != currentStage;
        batch["currentStage"] = normalizedNextStage;
        stageEvents.Add(new JsonObject
        {
            ["stage"] = normalizedNextStage,
            ["occurredAt"] = occurredAt
        });
        batch["stageEvents"] = stageEvents;

        await store.SaveAsync(state, cancellationToken);

        if (transitionChanged)
        {
            var emittedEvent = BuildStageTransitionEvent(batchId, currentStage, normalizedNextStage, occurredAt, stageEvents.Count);
            if (emittedEvent is not null)
            {
                await eventPublisher.PublishAsync(emittedEvent, cancellationToken);
            }
        }

        return (true, null, (JsonObject)batch.DeepClone());
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

    public ValidationResult ValidateAppState(JsonObject appState)
    {
        var issues = new List<ValidationIssue>();

        if (appState["schemaVersion"] is not null && appState["schemaVersion"] is not JsonValue)
        {
            issues.Add(new ValidationIssue("/schemaVersion", "must be a scalar value"));
        }

        if (appState["settings"] is not null && appState["settings"] is not JsonObject)
        {
            issues.Add(new ValidationIssue("/settings", "must be an object"));
        }

        foreach (var collection in RootCollections)
        {
            if (appState[collection] is not null && appState[collection] is not JsonArray)
            {
                issues.Add(new ValidationIssue($"/{collection}", "must be an array"));
            }
        }

        return issues.Count == 0
            ? ValidationResult.Success()
            : new ValidationResult(false, issues);
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

        foreach (var batch in GardenJsonCollectionHelpers.GetCollection(state, "batches").OfType<JsonObject>())
        {
            GardenJsonCollectionHelpers.NormalizeBatchForPersistence(batch);
        }
    }


    private static string NormalizeStage(string stage) => stage switch
    {
        "pre_sown" => "sowing",
        _ => stage
    };

    private static bool CanTransition(string currentStage, string nextStage)
    {
        if (nextStage == "failed") return true;
        if (nextStage == "ended") return currentStage is "harvest" or "failed";

        return currentStage switch
        {
            "sowing" => nextStage is "transplant" or "harvest" or "failed",
            "started" => nextStage is "transplant" or "harvest" or "failed",
            "transplant" => nextStage is "transplant" or "harvest" or "failed",
            "harvest" => nextStage is "harvest" or "ended" or "failed",
            "failed" => nextStage is "ended",
            "ended" => nextStage is "failed",
            _ => false
        };
    }

    private static IApplicationEvent? BuildStageTransitionEvent(string batchId, string previousStage, string currentStage, string occurredAt, int stageEventCount)
    {
        if (currentStage == "ended") return new StageCompleted(batchId, previousStage, currentStage, occurredAt, stageEventCount);

        var rank = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["sowing"] = 1,
            ["started"] = 1,
            ["transplant"] = 2,
            ["harvest"] = 3,
            ["ended"] = 4,
            ["failed"] = 99
        };

        if (!rank.TryGetValue(previousStage, out var oldRank) || !rank.TryGetValue(currentStage, out var newRank))
        {
            return null;
        }

        return newRank >= oldRank
            ? new StageAdvanced(batchId, previousStage, currentStage, occurredAt, stageEventCount)
            : new StageRegressed(batchId, previousStage, currentStage, occurredAt, stageEventCount);
    }

    private static string UtcNowIso() =>
        DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
}
