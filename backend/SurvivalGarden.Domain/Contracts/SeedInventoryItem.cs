namespace SurvivalGarden.Domain.Contracts;

public sealed record SeedInventoryItem(
    string Id,
    string CultivarId,
    double Quantity,
    string Unit,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    string? Supplier,
    string? LotNumber,
    DateTimeOffset? PurchaseDate,
    DateTimeOffset? ExpiryDate,
    string? StorageLocation,
    string? Notes
);
