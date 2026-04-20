namespace SurvivalGarden.Api.Contracts;

internal sealed class BedUpsertRequest
{
    public string? BedId { get; set; }

    public string? SegmentId { get; init; }

    public string? GardenId { get; init; }

    public string? Type { get; init; }

    public string? Name { get; init; }

    public double? WidthM { get; init; }

    public double? LengthM { get; init; }

    public double? X { get; init; }

    public double? Y { get; init; }

    public double? RotationDeg { get; init; }

    public string? Notes { get; init; }

    public string? CreatedAt { get; init; }

    public string? UpdatedAt { get; init; }
}
