namespace SurvivalGarden.Domain.Contracts;

public sealed record CropType(
    string Id,
    string Name,
    string SpeciesId,
    Species? Species,
    bool? IsUserDefined,
    string? Category,
    IReadOnlyList<string>? CompanionsGood,
    IReadOnlyList<string>? CompanionsAvoid,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt
);
