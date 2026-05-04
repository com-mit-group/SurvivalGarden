using System.Text.Json.Nodes;
using SurvivalGarden.Api.Contracts;
using SurvivalGarden.Application;

namespace SurvivalGarden.Api.Endpoints;

internal static class CoreEndpoints
{
    internal static void MapCoreEndpoints(this WebApplication app)
    {
        app.MapGet("/health", () => Results.Ok(new
        {
            status = "ok",
            service = "survival-garden-backend",
            utc = DateTimeOffset.UtcNow
        }));

        app.MapGet("/", () => Results.Ok(new
        {
            name = "SurvivalGarden.Api",
            mode = "parallel",
            contracts = "backend-canonical",
            frontendSchemas = "migration-only"
        }));


        app.MapGet("/api/app-state", async (IGardenApplicationService service, CancellationToken ct) =>
        {
            var state = await service.LoadAppStateAsync(ct);
            return state is null ? Results.NotFound() : Results.Ok(state);
        });

        app.MapPut("/api/app-state", async (IGardenApplicationService service, JsonObject payload, CancellationToken ct) =>
        {
            var validation = service.ValidateAppState(payload);
            if (!validation.Ok)
            {
                return Results.BadRequest(new { errors = validation.Issues });
            }

            await service.SaveAppStateAsync(payload, ct);
            return Results.Ok(payload);
        });

        app.MapGet("/api/settings", async (IGardenApplicationService service, CancellationToken ct) =>
        {
            var state = await service.LoadAppStateAsync(ct);
            return state?["settings"] is JsonObject settings ? Results.Ok(settings) : Results.NotFound();
        });

        app.MapPut("/api/settings", async (IGardenApplicationService service, JsonObject payload, CancellationToken ct) =>
        {
            var state = await service.LoadAppStateAsync(ct) ?? new JsonObject();
            state["settings"] = payload.DeepClone();
            await service.SaveAppStateAsync(state, ct);
            return Results.Ok(payload);
        });


        app.MapGet("/api/query/taxonomy-picker", async (IGardenApplicationService service, CancellationToken ct) =>
        {
            var state = await service.LoadAppStateAsync(ct);
            if (state is null)
            {
                return Results.NotFound();
            }

            var speciesById = BuildSpeciesLookup(state);

            var crops = (state["crops"] as JsonArray ?? []).OfType<JsonObject>().ToArray();
            var cultivars = (state["cultivars"] as JsonArray ?? []).OfType<JsonObject>().ToArray();

            var cropRows = crops.Select(crop =>
            {
                var cropId = crop["cropId"]?.GetValue<string>() ?? string.Empty;
                var speciesId = crop["speciesId"]?.GetValue<string>() ?? string.Empty;
                return new TaxonomyPickerCropDto
                {
                    CropId = cropId,
                    CropName = crop["name"]?.GetValue<string>() ?? cropId,
                    SpeciesId = speciesId,
                    SpeciesDisplay = ResolveSpeciesDisplay(speciesById, speciesId)
                };
            });

            var cultivarRows = cultivars.Select(cultivar =>
            {
                var cropTypeId = cultivar["cropTypeId"]?.GetValue<string>() ?? string.Empty;
                var crop = crops.FirstOrDefault(candidate => string.Equals(candidate["cropId"]?.GetValue<string>(), cropTypeId, StringComparison.Ordinal));
                var speciesId = crop?["speciesId"]?.GetValue<string>() ?? string.Empty;
                return new TaxonomyPickerCultivarDto
                {
                    CultivarId = cultivar["cultivarId"]?.GetValue<string>() ?? string.Empty,
                    CultivarName = cultivar["name"]?.GetValue<string>() ?? string.Empty,
                    CropTypeId = cropTypeId,
                    CropTypeName = crop?["name"]?.GetValue<string>() ?? cropTypeId,
                    SpeciesDisplay = ResolveSpeciesDisplay(speciesById, speciesId),
                    Archived = cultivar["isArchived"]?.GetValue<bool>() ?? false
                };
            });

            return Results.Ok(new TaxonomyPickerQueryResponseDto
            {
                Crops = cropRows.ToArray(),
                Cultivars = cultivarRows.ToArray()
            });
        });

        app.MapGet("/api/query/seed-inventory", async (IGardenApplicationService service, CancellationToken ct) =>
        {
            var state = await service.LoadAppStateAsync(ct);
            if (state is null)
            {
                return Results.NotFound();
            }

            var items = (state["seedInventoryItems"] as JsonArray ?? []).OfType<JsonObject>().ToArray();
            var crops = (state["crops"] as JsonArray ?? []).OfType<JsonObject>().ToArray();
            var cultivars = (state["cultivars"] as JsonArray ?? []).OfType<JsonObject>().ToArray();
            var speciesById = BuildSpeciesLookup(state);

            var rows = items.Select(item =>
            {
                var cultivarId = item["cultivarId"]?.GetValue<string>() ?? string.Empty;
                var cultivar = cultivars.FirstOrDefault(candidate => string.Equals(candidate["cultivarId"]?.GetValue<string>(), cultivarId, StringComparison.Ordinal));
                var cropTypeId = cultivar?["cropTypeId"]?.GetValue<string>() ?? item["cropId"]?.GetValue<string>() ?? string.Empty;
                var crop = crops.FirstOrDefault(candidate => string.Equals(candidate["cropId"]?.GetValue<string>(), cropTypeId, StringComparison.Ordinal));
                var speciesId = crop?["speciesId"]?.GetValue<string>() ?? string.Empty;
                return new SeedInventoryQueryRowDto
                {
                    SeedInventoryItemId = item["seedInventoryItemId"]?.GetValue<string>() ?? string.Empty,
                    CultivarId = cultivarId,
                    DisplayName = cultivar?["name"]?.GetValue<string>() ?? item["variety"]?.GetValue<string>() ?? cultivarId,
                    CropTypeName = crop?["name"]?.GetValue<string>() ?? cropTypeId,
                    SpeciesDisplay = ResolveSpeciesDisplay(speciesById, speciesId)
                };
            });

            return Results.Ok(rows.ToArray());
        });

        app.MapGet("/api/query/batch-list", async (IGardenApplicationService service, CancellationToken ct) =>
        {
            var state = await service.LoadAppStateAsync(ct);
            if (state is null)
            {
                return Results.NotFound();
            }

            var batches = (state["batches"] as JsonArray ?? []).OfType<JsonObject>().ToArray();
            var crops = (state["crops"] as JsonArray ?? []).OfType<JsonObject>().ToArray();
            var cultivars = (state["cultivars"] as JsonArray ?? []).OfType<JsonObject>().ToArray();
            var speciesById = BuildSpeciesLookup(state);

            var rows = batches.Select(batch =>
            {
                var batchId = batch["batchId"]?.GetValue<string>() ?? string.Empty;
                var lookupId = batch["cultivarId"]?.GetValue<string>() ?? batch["cropId"]?.GetValue<string>() ?? batchId;
                var cultivar = cultivars.FirstOrDefault(candidate => string.Equals(candidate["cultivarId"]?.GetValue<string>(), lookupId, StringComparison.Ordinal));
                var cropTypeId = batch["cropTypeId"]?.GetValue<string>() ?? cultivar?["cropTypeId"]?.GetValue<string>() ?? string.Empty;
                var crop = crops.FirstOrDefault(candidate => string.Equals(candidate["cropId"]?.GetValue<string>(), cropTypeId, StringComparison.Ordinal));
                var speciesId = crop?["speciesId"]?.GetValue<string>() ?? string.Empty;

                return new BatchListQueryRowDto
                {
                    BatchId = batchId,
                    IdentityId = cultivar?["cultivarId"]?.GetValue<string>() ?? lookupId,
                    CapabilityCropId = string.IsNullOrEmpty(cropTypeId) ? lookupId : cropTypeId,
                    DisplayName = cultivar?["name"]?.GetValue<string>() ?? crop?["name"]?.GetValue<string>() ?? lookupId,
                    CropTypeId = cropTypeId,
                    CropTypeName = crop?["name"]?.GetValue<string>() ?? cropTypeId,
                    SpeciesDisplay = ResolveSpeciesDisplay(speciesById, speciesId)
                };
            });

            return Results.Ok(rows.ToArray());
        });

        MapEntityCrud(app, "species", "id");
        MapTypedEntityCrud<CropUpsertRequest>(app, "crops", "cropId", (payload, id) =>
        {
            payload.CropId = id;
            return DtoJsonMapper.ToJsonObject(payload);
        });
        MapEntityCrud(app, "cultivars", "id");
        MapTypedEntityCrud<SeedInventoryItemUpsertRequest>(app, "seedInventoryItems", "seedInventoryItemId", (payload, id) =>
        {
            payload.SeedInventoryItemId = id;
            return DtoJsonMapper.ToJsonObject(payload);
        });
        MapEntityCrud(app, "cropPlans", "planId");

        app.MapPost("/api/validate/{collection}", (IGardenApplicationService service, string collection, JsonObject payload) =>
        {
            var validation = service.Validate(collection, payload);
            return Results.Ok(new
            {
                ok = validation.Ok,
                issues = validation.Issues
            });
        });
    }


    private static Dictionary<string, JsonObject> BuildSpeciesLookup(JsonObject state) =>
        (state["species"] as JsonArray ?? []).OfType<JsonObject>()
            .Where(species => !string.IsNullOrWhiteSpace(species["id"]?.GetValue<string>()))
            .ToDictionary(species => species["id"]!.GetValue<string>(), species => species);

    private static string ResolveSpeciesDisplay(IReadOnlyDictionary<string, JsonObject> speciesById, string speciesId)
    {
        if (!speciesById.TryGetValue(speciesId, out var species))
        {
            return string.Empty;
        }

        return species["commonName"]?.GetValue<string>() ?? species["scientificName"]?.GetValue<string>() ?? string.Empty;
    }

    private sealed class TaxonomyPickerQueryResponseDto
    {
        public required TaxonomyPickerCropDto[] Crops { get; init; }
        public required TaxonomyPickerCultivarDto[] Cultivars { get; init; }
    }

    private sealed class TaxonomyPickerCropDto
    {
        public required string CropId { get; init; }
        public required string CropName { get; init; }
        public required string SpeciesId { get; init; }
        public required string SpeciesDisplay { get; init; }
    }

    private sealed class TaxonomyPickerCultivarDto
    {
        public required string CultivarId { get; init; }
        public required string CultivarName { get; init; }
        public required string CropTypeId { get; init; }
        public required string CropTypeName { get; init; }
        public required string SpeciesDisplay { get; init; }
        public required bool Archived { get; init; }
    }

    private sealed class SeedInventoryQueryRowDto
    {
        public required string SeedInventoryItemId { get; init; }
        public required string CultivarId { get; init; }
        public required string DisplayName { get; init; }
        public required string CropTypeName { get; init; }
        public required string SpeciesDisplay { get; init; }
    }

    private sealed class BatchListQueryRowDto
    {
        public required string BatchId { get; init; }
        public required string IdentityId { get; init; }
        public required string CapabilityCropId { get; init; }
        public required string DisplayName { get; init; }
        public required string CropTypeId { get; init; }
        public required string CropTypeName { get; init; }
        public required string SpeciesDisplay { get; init; }
    }

    private static void MapEntityCrud(WebApplication app, string collectionName, string idProperty)
    {
        app.MapGet($"/api/{collectionName}", async (IGardenApplicationService service, CancellationToken ct) =>
        {
            var rows = await service.ListAsync(collectionName, ct);
            return Results.Ok(rows);
        });

        app.MapGet($"/api/{collectionName}/{{id}}", async (IGardenApplicationService service, string id, CancellationToken ct) =>
        {
            var row = await service.GetByIdAsync(collectionName, idProperty, id, ct);
            return row is null ? Results.NotFound() : Results.Ok(row);
        });

        app.MapPut($"/api/{collectionName}/{{id}}", async (IGardenApplicationService service, string id, JsonObject payload, CancellationToken ct) =>
        {
            payload[idProperty] = id;
            var validation = service.Validate(collectionName, payload);
            if (!validation.Ok)
            {
                return Results.BadRequest(new { errors = validation.Issues });
            }

            var saved = await service.UpsertAsync(collectionName, idProperty, payload, ct);
            return Results.Ok(saved);
        });

        app.MapDelete($"/api/{collectionName}/{{id}}", async (IGardenApplicationService service, string id, CancellationToken ct) =>
        {
            var removed = await service.RemoveAsync(collectionName, idProperty, id, ct);
            return removed ? Results.NoContent() : Results.NotFound();
        });
    }

    private static void MapTypedEntityCrud<TRequest>(
        WebApplication app,
        string collectionName,
        string idProperty,
        Func<TRequest, string, JsonObject> mapPayload)
    {
        app.MapGet($"/api/{collectionName}", async (IGardenApplicationService service, CancellationToken ct) =>
        {
            var rows = await service.ListAsync(collectionName, ct);
            return Results.Ok(rows);
        });

        app.MapGet($"/api/{collectionName}/{{id}}", async (IGardenApplicationService service, string id, CancellationToken ct) =>
        {
            var row = await service.GetByIdAsync(collectionName, idProperty, id, ct);
            return row is null ? Results.NotFound() : Results.Ok(row);
        });

        app.MapPut($"/api/{collectionName}/{{id}}", async (IGardenApplicationService service, string id, TRequest payload, CancellationToken ct) =>
        {
            var jsonPayload = mapPayload(payload, id);
            jsonPayload[idProperty] = id;

            var validation = service.Validate(collectionName, jsonPayload);
            if (!validation.Ok)
            {
                return Results.BadRequest(new { errors = validation.Issues });
            }

            var saved = await service.UpsertAsync(collectionName, idProperty, jsonPayload, ct);
            return Results.Ok(saved);
        });

        app.MapDelete($"/api/{collectionName}/{{id}}", async (IGardenApplicationService service, string id, CancellationToken ct) =>
        {
            var removed = await service.RemoveAsync(collectionName, idProperty, id, ct);
            return removed ? Results.NoContent() : Results.NotFound();
        });
    }
}
