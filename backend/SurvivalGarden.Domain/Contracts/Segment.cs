namespace SurvivalGarden.Domain.Contracts;

public sealed record Segment(
    string Id,
    string Name,
    IReadOnlyList<Bed> Beds,
    IReadOnlyList<Path> Paths,
    string? Kind,
    string? Notes,
    double? WidthM,
    double? LengthM,
    double? Width,
    double? Height,
    string? OriginReference
);
