namespace SurvivalGarden.Domain.Contracts;

public sealed record SeedInventoryItem(
    string Id,
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
