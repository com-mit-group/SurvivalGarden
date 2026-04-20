namespace SurvivalGarden.Api.Contracts;

internal sealed class BatchAssignmentRequest
{
    public string? Operation { get; init; }

    public string? At { get; init; }

    public string? BedId { get; init; }
}
