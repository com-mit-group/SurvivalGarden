using System.Text.Json;
using System.Text.Json.Nodes;

namespace SurvivalGarden.Api.Contracts;

internal static class DtoJsonMapper
{
    internal static JsonObject ToJsonObject<T>(T payload)
    {
        return JsonSerializer.SerializeToNode(payload) as JsonObject ?? new JsonObject();
    }
}
