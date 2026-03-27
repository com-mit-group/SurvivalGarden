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

    internal static void CanonicalizeBatchAliases(JsonObject batch)
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

    internal static bool HasBedAssignment(JsonObject batch, string bedId)
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

    internal static DateTimeOffset? ParseIso(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return DateTimeOffset.TryParse(value, out var parsed) ? parsed : null;
    }
}
