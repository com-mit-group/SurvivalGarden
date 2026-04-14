namespace SurvivalGarden.Domain.Contracts;

public sealed record TaskItem(
    string Id,
    string SourceKey,
    DateOnly Date,
    string Type,
    string CropId,
    string BedId,
    string BatchId,
    IReadOnlyList<IReadOnlyDictionary<string, object?>> Checklist,
    string Status
);

public sealed record Settings(
    string Id,
    string Locale,
    string Timezone,
    string WeekStartsOn,
    string TemperatureUnit,
    string YieldUnit,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt
);

public sealed record AppState(
    int SchemaVersion,
    IReadOnlyList<Segment> Segments,
    IReadOnlyList<Bed> Beds,
    IReadOnlyList<Species> Species,
    IReadOnlyList<CropType> Crops,
    IReadOnlyList<CropPlan> CropPlans,
    IReadOnlyList<Batch> Batches,
    IReadOnlyList<TaskItem> Tasks,
    IReadOnlyList<SeedInventoryItem> SeedInventoryItems,
    Settings Settings
);

public sealed record ContractCatalog(
    IReadOnlyList<Segment> Segments,
    IReadOnlyList<Bed> Beds,
    IReadOnlyList<Path> Paths,
    IReadOnlyList<Species> Species,
    IReadOnlyList<CropType> Crops,
    IReadOnlyList<Cultivar> Cultivars,
    IReadOnlyList<CropPlan> CropPlans,
    IReadOnlyList<Batch> Batches,
    IReadOnlyList<TaskItem> Tasks,
    IReadOnlyList<SeedInventoryItem> SeedInventoryItems,
    IReadOnlyList<Settings> Settings,
    IReadOnlyList<AppState> AppStates
);
