namespace SurvivalGarden.Domain.Contracts;

public sealed record Cultivar(
    string Id,
    string CropTypeId,
    string Name,
    string? Supplier,
    string? Source,
    int? Year,
    string? Notes,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt
);
