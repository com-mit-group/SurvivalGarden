namespace SurvivalGarden.Domain.Contracts;

public sealed record CropPlan(
    string Id,
    string BedId,
    string CropId,
    int SeasonYear,
    PlannedWindows PlannedWindows,
    ExpectedYield ExpectedYield,
    string? Notes,
    IReadOnlyList<Placement>? Placements
);

public sealed record PlannedWindows(
    IReadOnlyList<WindowRange> Sowing,
    IReadOnlyList<WindowRange>? Transplant,
    IReadOnlyList<WindowRange> Harvest
);

public sealed record WindowRange(
    string Start,
    string End
);

public sealed record ExpectedYield(
    double Amount,
    string Unit
);

public sealed record Placement(
    string Type,
    IReadOnlyList<Point>? Points,
    PlacementFormula? Formula
);

public sealed record Point(double X, double Y);

public sealed record PlacementFormula(
    string Kind,
    Point? Origin,
    Point? Start,
    Point? End,
    double? Dx,
    double? Dy,
    int? Rows,
    int? Cols,
    int? Count,
    double? StaggerX
);
