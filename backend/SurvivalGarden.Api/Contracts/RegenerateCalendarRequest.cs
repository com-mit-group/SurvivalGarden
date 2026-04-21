using System.Text.Json.Serialization;

namespace SurvivalGarden.Api.Contracts;

internal sealed class RegenerateCalendarRequest
{
    [JsonExtensionData]
    public Dictionary<string, object?> AdditionalData { get; init; } = new(StringComparer.Ordinal);
}
