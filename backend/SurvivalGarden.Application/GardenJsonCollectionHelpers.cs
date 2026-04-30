using System.Text.Json.Nodes;

namespace SurvivalGarden.Application;

internal static class GardenJsonCollectionHelpers
{
    internal static JsonArray GetCollection(JsonObject state, string name)
    {
        if (state[name] is JsonArray existing)
        {
            return existing;
        }

        var created = new JsonArray();
        state[name] = created;
        return created;
    }

    internal static JsonArray CloneArray(JsonArray source)
    {
        return new JsonArray(source.Select(item => item?.DeepClone()).ToArray());
    }

    internal static void NormalizeBatchForPersistence(JsonObject batch)
    {
        if (batch["batchId"] is null && batch["id"] is not null)
        {
            batch["batchId"] = batch["id"]?.DeepClone();
        }

        if (batch["cultivarId"] is null && batch["cropId"] is not null)
        {
            batch["cultivarId"] = batch["cropId"]?.DeepClone();
        }

        if (batch["currentStage"] is null && batch["stage"] is not null)
        {
            batch["currentStage"] = batch["stage"]?.DeepClone();
        }

        if (batch["bedAssignments"] is null && batch["assignments"] is not null)
        {
            batch["bedAssignments"] = batch["assignments"]?.DeepClone();
        }

        if (batch["bedAssignments"] is null)
        {
            batch["bedAssignments"] = new JsonArray();
        }

        if (batch["bedAssignments"] is JsonArray assignments)
        {
            foreach (var assignment in assignments.OfType<JsonObject>())
            {
                if (assignment["assignedAt"] is null && assignment["fromDate"] is not null)
                {
                    assignment["assignedAt"] = assignment["fromDate"]?.DeepClone();
                }

                if (assignment["removedAt"] is null && assignment["toDate"] is not null)
                {
                    assignment["removedAt"] = assignment["toDate"]?.DeepClone();
                }

                assignment.Remove("fromDate");
                assignment.Remove("toDate");
            }
        }

        if (batch["stageEvents"] is null)
        {
            batch["stageEvents"] = new JsonArray();
        }

        if (batch["currentStage"] is null && batch["stageEvents"] is JsonArray stageEvents)
        {
            var lastEvent = stageEvents.OfType<JsonObject>().LastOrDefault();
            if (lastEvent is not null && lastEvent["stage"] is not null)
            {
                batch["currentStage"] = lastEvent["stage"]?.DeepClone();
            }
        }

        foreach (var eventNode in (batch["stageEvents"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            if (eventNode["stage"] is null && eventNode["type"] is not null)
            {
                eventNode["stage"] = eventNode["type"]?.DeepClone();
            }

            if (eventNode["occurredAt"] is null && eventNode["date"] is not null)
            {
                eventNode["occurredAt"] = eventNode["date"]?.DeepClone();
            }

            eventNode.Remove("type");
            eventNode.Remove("date");
        }

        batch.Remove("id");
        batch.Remove("cropId");
        batch.Remove("stage");
        batch.Remove("assignments");
    }

    internal static bool HasBedAssignment(JsonObject batch, string bedId)
    {
        var assignments = batch["bedAssignments"] as JsonArray ?? batch["assignments"] as JsonArray;
        if (assignments is null)
        {
            return false;
        }

        return assignments
            .OfType<JsonObject>()
            .Any(assignment => string.Equals(assignment["bedId"]?.GetValue<string>(), bedId, StringComparison.Ordinal));
    }

    internal static DateTimeOffset? ParseIso(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return DateTimeOffset.TryParse(value, out var parsed) ? parsed : null;
    }
}
