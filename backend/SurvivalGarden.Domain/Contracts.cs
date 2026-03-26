namespace SurvivalGarden.Domain;

public sealed record Species(
    string Id,
    string? CommonName,
    string? ScientificName,
    IReadOnlyList<string>? Aliases,
    string? Notes,
    SpeciesTaxonomy? Taxonomy
);

public sealed record SpeciesTaxonomy(
    string? Family,
    string? Genus,
    string? Species
);

public sealed record CropType(
    string? CropId,
    string? Name,
    string? Cultivar,
    string? CultivarGroup,
    string? SpeciesId,
    SpeciesRef? Species,
    string? ScientificName,
    SpeciesTaxonomy? Taxonomy,
    IReadOnlyList<string>? Aliases,
    bool? IsUserDefined,
    string? Category,
    IReadOnlyList<string>? CompanionsGood,
    IReadOnlyList<string>? CompanionsAvoid,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    string? Id,
    string? CommonName
);

public sealed record SpeciesRef(
    string? Id,
    string CommonName,
    string ScientificName,
    SpeciesTaxonomy? Taxonomy
);

public sealed record Cultivar(
    string CultivarId,
    string CropTypeId,
    string Name,
    string? Supplier,
    string? Source,
    int? Year,
    string? Notes,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt
);

public sealed record Batch(
    string BatchId,
    string? CultivarId,
    string? CropId,
    string? CropTypeId,
    string StartedAt,
    string Stage,
    IReadOnlyList<StageEvent> StageEvents,
    IReadOnlyList<BedAssignment> Assignments,
    string? CurrentStage,
    string? Notes
);

public sealed record StageEvent(
    string Stage,
    string OccurredAt,
    string? Method,
    string? Location,
    string? Notes
);

public sealed record BedAssignment(
    string BedId,
    double Area,
    string? AssignedAt
);

public sealed record Segment(
    string SegmentId,
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

public sealed record Bed(
    string BedId,
    string GardenId,
    string Type,
    string Name,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    string? SegmentId,
    double? WidthM,
    double? LengthM,
    double? X,
    double? Y,
    double? RotationDeg,
    string? Notes
);

public sealed record Path(
    string PathId,
    string Name,
    double X,
    double Y,
    string? SegmentId,
    double? WidthM,
    double? LengthM,
    double? RotationDeg,
    string? Notes,
    double? Width,
    double? Height,
    string? Surface
);

public sealed record CropPlan(
    string PlanId,
    string BedId,
    string CropId,
    int SeasonYear,
    PlannedWindows PlannedWindows,
    ExpectedYield ExpectedYield,
    string? SegmentId,
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

public sealed record SeedInventoryItem(
    string SeedInventoryItemId,
    double Quantity,
    string Unit,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    string? CultivarId,
    string? CropId,
    string? Variety,
    string? Supplier,
    string? LotNumber,
    DateTimeOffset? PurchaseDate,
    DateTimeOffset? ExpiryDate,
    string? StorageLocation,
    string? Notes
);
