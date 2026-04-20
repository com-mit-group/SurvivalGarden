using System.Text.Json.Nodes;

namespace SurvivalGarden.Api.Contracts;

internal sealed class CropUpsertRequest
{
    public string? CropId { get; set; }

    public string? Id { get; init; }

    public string? Name { get; init; }

    public string? CommonName { get; init; }

    public string? Cultivar { get; init; }

    public string? CultivarGroup { get; init; }

    public string? SpeciesId { get; init; }

    public JsonObject? Species { get; init; }

    public string? ScientificName { get; init; }

    public JsonObject? Taxonomy { get; init; }

    public JsonArray? Aliases { get; init; }

    public bool? IsUserDefined { get; init; }

    public string? Category { get; init; }

    public JsonArray? CompanionsGood { get; init; }

    public JsonArray? CompanionsAvoid { get; init; }

    public JsonObject? Rules { get; init; }

    public JsonArray? TaskRules { get; init; }

    public JsonArray? NutritionProfile { get; init; }

    public string? CreatedAt { get; init; }

    public string? UpdatedAt { get; init; }

    public JsonObject? Defaults { get; init; }

    public JsonObject? Meta { get; init; }
}
