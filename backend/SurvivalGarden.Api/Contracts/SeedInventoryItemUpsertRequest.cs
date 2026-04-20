namespace SurvivalGarden.Api.Contracts;

internal sealed class SeedInventoryItemUpsertRequest
{
    public string? SeedInventoryItemId { get; set; }

    public string? CultivarId { get; init; }

    public string? CropId { get; init; }

    public string? Variety { get; init; }

    public string? Supplier { get; init; }

    public string? LotNumber { get; init; }

    public double? Quantity { get; init; }

    public string? Unit { get; init; }

    public string? PurchaseDate { get; init; }

    public string? ExpiryDate { get; init; }

    public string? Status { get; init; }

    public string? StorageLocation { get; init; }

    public string? Notes { get; init; }

    public string? CreatedAt { get; init; }

    public string? UpdatedAt { get; init; }
}
