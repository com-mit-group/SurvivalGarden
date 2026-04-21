namespace SurvivalGarden.Api.Contracts;

internal sealed class StageEventRequest
{
    public string? Stage { get; init; }

    public string? OccurredAt { get; init; }
}
