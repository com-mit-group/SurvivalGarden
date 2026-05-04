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
                return new
                {
                    cropId,
                    cropName = crop["name"]?.GetValue<string>() ?? cropId,
                    speciesId,
                    speciesDisplay = ResolveSpeciesDisplay(speciesById, speciesId)
                };
            });

            var cultivarRows = cultivars.Select(cultivar =>
            {
                var cropTypeId = cultivar["cropTypeId"]?.GetValue<string>() ?? string.Empty;
                var crop = crops.FirstOrDefault(candidate => string.Equals(candidate["cropId"]?.GetValue<string>(), cropTypeId, StringComparison.Ordinal));
                var speciesId = crop?["speciesId"]?.GetValue<string>() ?? string.Empty;
                return new
                {
                    cultivarId = cultivar["cultivarId"]?.GetValue<string>() ?? string.Empty,
                    cultivarName = cultivar["name"]?.GetValue<string>() ?? string.Empty,
                    cropTypeId,
                    cropTypeName = crop?["name"]?.GetValue<string>() ?? cropTypeId,
                    speciesDisplay = ResolveSpeciesDisplay(speciesById, speciesId),
                    archived = cultivar["isArchived"]?.GetValue<bool>() ?? false
                };
            });

            return Results.Ok(new { crops = cropRows, cultivars = cultivarRows });
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
                return new
                {
                    seedInventoryItemId = item["seedInventoryItemId"]?.GetValue<string>() ?? string.Empty,
                    cultivarId,
                    displayName = cultivar?["name"]?.GetValue<string>() ?? item["variety"]?.GetValue<string>() ?? cultivarId,
                    cropTypeName = crop?["name"]?.GetValue<string>() ?? cropTypeId,
                    speciesDisplay = ResolveSpeciesDisplay(speciesById, speciesId)
                };
            });

            return Results.Ok(rows);
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
