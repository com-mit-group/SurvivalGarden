namespace SurvivalGarden.Domain.Contracts;

public sealed record Species(
    string Id,
    string ScientificName,
    string? CommonName,
    IReadOnlyList<string>? Aliases,
    string? Notes,
    SpeciesTaxonomy? Taxonomy
);

public sealed record SpeciesTaxonomy(
    string? Family,
    string? Genus,
    string? Species
);
