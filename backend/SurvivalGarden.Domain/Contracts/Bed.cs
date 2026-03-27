namespace SurvivalGarden.Domain.Contracts;

public sealed record Bed(
    string Id,
    string SegmentId,
    string Type,
    string Name,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    double? WidthM,
    double? LengthM,
    double? X,
    double? Y,
    double? RotationDeg,
    string? Notes
);
