namespace SurvivalGarden.Domain.Contracts;

public sealed record Path(
    string Id,
    string SegmentId,
    string Name,
    double X,
    double Y,
    double? WidthM,
    double? LengthM,
    double? RotationDeg,
    string? Notes,
    double? Width,
    double? Height,
    string? Surface
);
