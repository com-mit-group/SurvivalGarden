using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using SurvivalGarden.Application;

namespace SurvivalGarden.Maui;

public sealed class LocalGardenBackend(IServiceScopeFactory scopeFactory) : ILocalGardenBackend
{
    private static readonly string[] RootCollections =
    [
        "segments",
        "batches",
        "tasks",
        "species",
        "crops",
        "cultivars",
        "seedInventoryItems",
        "cropPlans"
    ];

    public async Task<LocalGardenSnapshot> LoadSnapshotAsync(CancellationToken cancellationToken = default)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var applicationService = scope.ServiceProvider.GetRequiredService<IGardenApplicationService>();
        var state = await applicationService.LoadAppStateAsync(cancellationToken);

        if (state is null)
        {
            return new LocalGardenSnapshot(
                false,
                0,
                DateTimeOffset.Now,
                new Dictionary<string, IReadOnlyList<GardenRecordSummary>>(StringComparer.Ordinal));
        }

        var collections = new Dictionary<string, IReadOnlyList<GardenRecordSummary>>(StringComparer.Ordinal);

        foreach (var collectionName in RootCollections)
        {
            collections[collectionName] = ReadCollection(state, collectionName);
        }

        collections["beds"] = ReadBeds(state);
        var entityCount = collections.Values.Sum(records => records.Count);

        return new LocalGardenSnapshot(true, entityCount, DateTimeOffset.Now, collections);
    }

    private static IReadOnlyList<GardenRecordSummary> ReadCollection(JsonObject state, string collectionName)
    {
        if (state[collectionName] is not JsonArray collection)
        {
            return [];
        }

        return collection
            .OfType<JsonObject>()
            .Select((record, index) => Summarize(collectionName, record, index))
            .ToArray();
    }

    private static IReadOnlyList<GardenRecordSummary> ReadBeds(JsonObject state)
    {
        var beds = new List<GardenRecordSummary>();

        if (state["beds"] is JsonArray rootBeds)
        {
            beds.AddRange(rootBeds
                .OfType<JsonObject>()
                .Select((record, index) => Summarize("beds", record, index)));
        }

        if (state["segments"] is JsonArray segments)
        {
            foreach (var segment in segments.OfType<JsonObject>())
            {
                var segmentName = ReadText(segment, "name", "segmentId", "id") ?? "Garden segment";
                if (segment["beds"] is not JsonArray segmentBeds)
                {
                    continue;
                }

                beds.AddRange(segmentBeds
                    .OfType<JsonObject>()
                    .Select((record, index) => Summarize("beds", record, index, segmentName)));
            }
        }

        return beds
            .GroupBy(record => record.Id, StringComparer.Ordinal)
            .Select(group => group.First())
            .ToArray();
    }

    private static GardenRecordSummary Summarize(string collectionName, JsonObject record, int index, string? context = null)
    {
        var id = ReadText(
            record,
            "id",
            "bedId",
            "batchId",
            "taskId",
            "cropId",
            "cultivarId",
            "speciesId",
            "seedInventoryItemId",
            "planId",
            "segmentId") ?? $"{collectionName}-{index + 1}";

        var title = collectionName switch
        {
            "beds" => ReadText(record, "name", "bedId"),
            "batches" => ReadText(record, "name", "batchName", "cultivarName", "batchId"),
            "tasks" => ReadText(record, "title", "name", "taskId"),
            "species" => ReadText(record, "commonName", "name", "scientificName", "id"),
            "crops" => ReadText(record, "name", "displayName", "cropId", "id"),
            "cultivars" => ReadText(record, "name", "cultivarName", "cultivarId", "id"),
            "seedInventoryItems" => ReadText(record, "name", "cultivarName", "variety", "seedInventoryItemId"),
            "cropPlans" => ReadText(record, "name", "title", "planId"),
            "segments" => ReadText(record, "name", "segmentId"),
            _ => ReadText(record, "name", "title", "id")
        } ?? id;

        var subtitle = collectionName switch
        {
            "beds" => JoinParts(context, ReadText(record, "type", "kind")),
            "batches" => JoinParts(Label("Stage", ReadText(record, "currentStage", "stage")), Label("Started", ReadText(record, "startedAt"))),
            "tasks" => JoinParts(Label("Due", ReadText(record, "dueAt", "dueDate", "scheduledFor")), ReadText(record, "status")),
            "species" => ReadText(record, "scientificName", "family") ?? "Taxonomy record",
            "crops" => ReadText(record, "scientificName", "category") ?? "Crop type",
            "cultivars" => JoinParts(ReadText(record, "supplier", "source"), ReadText(record, "year")),
            "seedInventoryItems" => JoinParts(Label("Quantity", ReadText(record, "quantity", "count")), ReadText(record, "unit")),
            "cropPlans" => JoinParts(ReadText(record, "status"), Label("Season", ReadText(record, "season", "year"))),
            "segments" => JoinParts(ReadText(record, "kind", "type"), Size(record)),
            _ => string.Empty
        };

        var detail = collectionName switch
        {
            "beds" => Size(record),
            "batches" => ReadText(record, "notes", "cropId", "cultivarId") ?? string.Empty,
            "tasks" => ReadText(record, "description", "notes") ?? string.Empty,
            "seedInventoryItems" => ReadText(record, "storageLocation", "location", "notes") ?? string.Empty,
            _ => ReadText(record, "notes", "description") ?? string.Empty
        };

        return new GardenRecordSummary(id, title, subtitle, detail);
    }

    private static string Size(JsonObject record)
    {
        var width = ReadText(record, "width", "widthM");
        var height = ReadText(record, "height", "lengthM");
        return width is not null && height is not null ? $"{width} x {height} m" : string.Empty;
    }

    private static string Label(string label, string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? string.Empty : $"{label}: {value}";
    }

    private static string JoinParts(params string?[] parts)
    {
        return string.Join(" | ", parts.Where(part => !string.IsNullOrWhiteSpace(part)));
    }

    private static string? ReadText(JsonObject record, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            if (record[propertyName] is not JsonValue value)
            {
                continue;
            }

            if (value.TryGetValue<string>(out var text) && !string.IsNullOrWhiteSpace(text))
            {
                return text;
            }

            if (value.TryGetValue<int>(out var integer))
            {
                return integer.ToString();
            }

            if (value.TryGetValue<double>(out var number))
            {
                return number.ToString("0.##");
            }
        }

        return null;
    }
}
