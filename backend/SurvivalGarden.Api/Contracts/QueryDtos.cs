namespace SurvivalGarden.Api.Contracts;

internal sealed class TaxonomyPickerQueryResponseDto
{
    public required TaxonomyPickerCropDto[] Crops { get; init; }
    public required TaxonomyPickerCultivarDto[] Cultivars { get; init; }
}

internal sealed class TaxonomyPickerCropDto
{
    public required string CropId { get; init; }
    public required string CropName { get; init; }
    public required string SpeciesId { get; init; }
    public required string SpeciesDisplay { get; init; }
}

internal sealed class TaxonomyPickerCultivarDto
{
    public required string CultivarId { get; init; }
    public required string CultivarName { get; init; }
    public required string CropTypeId { get; init; }
    public required string CropTypeName { get; init; }
    public required string SpeciesDisplay { get; init; }
    public required bool Archived { get; init; }
}

internal sealed class SeedInventoryQueryRowDto
{
    public required string SeedInventoryItemId { get; init; }
    public required string CultivarId { get; init; }
    public required string DisplayName { get; init; }
    public required string CropTypeName { get; init; }
    public required string SpeciesDisplay { get; init; }
}

internal sealed class BatchListQueryRowDto
{
    public required string BatchId { get; init; }
    public required string IdentityId { get; init; }
    public required string CapabilityCropId { get; init; }
    public required string DisplayName { get; init; }
    public required string CropTypeId { get; init; }
    public required string CropTypeName { get; init; }
    public required string SpeciesDisplay { get; init; }
}
