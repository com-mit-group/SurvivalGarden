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
        MapLayoutWorkflowEndpoints(app);

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

    private static void MapLayoutWorkflowEndpoints(WebApplication app)
    {
        app.MapGet("/api/beds", async (IGardenApplicationService service, CancellationToken ct) =>
        {
            var segments = (await service.ListAsync("segments", ct)).OfType<JsonObject>();
            var beds = segments
                .SelectMany(segment => (segment["beds"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
                .Select(bed => bed.DeepClone())
                .ToArray();
            return Results.Ok(beds);
        });

        app.MapGet("/api/beds/{id}", async (IGardenApplicationService service, string id, CancellationToken ct) =>
        {
            var segments = (await service.ListAsync("segments", ct)).OfType<JsonObject>();
            var bed = segments
                .SelectMany(segment => (segment["beds"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
                .FirstOrDefault(entry => entry["bedId"]?.GetValue<string>() == id);
            return bed is null ? Results.NotFound() : Results.Ok(bed);
        });

        app.MapPost("/api/segments", async (IGardenApplicationService service, JsonObject payload, CancellationToken ct) =>
        {
            var segment = payload.DeepClone() as JsonObject ?? new JsonObject();
            segment["segmentId"] ??= $"segment-{Guid.NewGuid():N}";
            segment["beds"] = segment["beds"] is JsonArray beds ? beds : new JsonArray();
            segment["paths"] = segment["paths"] is JsonArray paths ? paths : new JsonArray();

            var validation = service.Validate("segments", segment);
            if (!validation.Ok)
            {
                return Results.BadRequest(new { errors = validation.Issues });
            }

            var saved = await service.UpsertAsync("segments", "segmentId", segment, ct);
            return Results.Ok(saved);
        });

        app.MapPatch("/api/segments/{id}", async (IGardenApplicationService service, string id, JsonObject payload, CancellationToken ct) =>
        {
            var current = await service.GetByIdAsync("segments", "segmentId", id, ct);
            if (current is null)
            {
                return Results.NotFound();
            }

            var updated = MergeLayoutEntity(current, payload, "segmentId", id);
            updated["beds"] = updated["beds"] is JsonArray beds ? beds : new JsonArray();
            updated["paths"] = updated["paths"] is JsonArray paths ? paths : new JsonArray();

            var validation = service.Validate("segments", updated);
            if (!validation.Ok)
            {
                return Results.BadRequest(new { errors = validation.Issues });
            }

            var saved = await service.UpsertAsync("segments", "segmentId", updated, ct);
            return Results.Ok(saved);
        });

        app.MapDelete("/api/segments/{id}", async (IGardenApplicationService service, string id, CancellationToken ct) =>
        {
            var current = await service.GetByIdAsync("segments", "segmentId", id, ct);
            if (current is null)
            {
                return Results.NotFound();
            }

            await service.RemoveAsync("segments", "segmentId", id, ct);
            return Results.NoContent();
        });

        app.MapPost("/api/segments/{id}/beds", async (IGardenApplicationService service, string id, JsonObject payload, CancellationToken ct) =>
        {
            var segment = await service.GetByIdAsync("segments", "segmentId", id, ct);
            if (segment is null)
            {
                return Results.NotFound();
            }

            var bed = payload.DeepClone() as JsonObject ?? new JsonObject();
            bed["bedId"] ??= $"bed-{Guid.NewGuid():N}";
            bed["segmentId"] = id;
            var bedValidation = service.Validate("beds", bed);
            if (!bedValidation.Ok)
            {
                return Results.BadRequest(new { errors = bedValidation.Issues });
            }

            var beds = segment["beds"] as JsonArray ?? new JsonArray();
            var bedId = bed["bedId"]?.GetValue<string>();
            var replaced = false;
            for (var index = 0; index < beds.Count; index++)
            {
                if (beds[index] is JsonObject existing && existing["bedId"]?.GetValue<string>() == bedId)
                {
                    beds[index] = bed.DeepClone();
                    replaced = true;
                    break;
                }
            }

            if (!replaced)
            {
                beds.Add(bed.DeepClone());
            }

            segment["beds"] = beds;
            segment["paths"] = segment["paths"] is JsonArray paths ? paths : new JsonArray();

            var segmentValidation = service.Validate("segments", segment);
            if (!segmentValidation.Ok)
            {
                return Results.BadRequest(new { errors = segmentValidation.Issues });
            }

            await service.UpsertAsync("segments", "segmentId", segment, ct);
            return Results.Ok(bed);
        });

        app.MapPost("/api/segments/{id}/paths", async (IGardenApplicationService service, string id, JsonObject payload, CancellationToken ct) =>
        {
            var segment = await service.GetByIdAsync("segments", "segmentId", id, ct);
            if (segment is null)
            {
                return Results.NotFound();
            }

            var path = payload.DeepClone() as JsonObject ?? new JsonObject();
            path["pathId"] ??= $"path-{Guid.NewGuid():N}";
            path["segmentId"] = id;
            var pathValidation = service.Validate("paths", path);
            if (!pathValidation.Ok)
            {
                return Results.BadRequest(new { errors = pathValidation.Issues });
            }

            var paths = segment["paths"] as JsonArray ?? new JsonArray();
            var pathId = path["pathId"]?.GetValue<string>();
            var replaced = false;
            for (var index = 0; index < paths.Count; index++)
            {
                if (paths[index] is JsonObject existing && existing["pathId"]?.GetValue<string>() == pathId)
                {
                    paths[index] = path.DeepClone();
                    replaced = true;
                    break;
                }
            }

            if (!replaced)
            {
                paths.Add(path.DeepClone());
            }

            segment["beds"] = segment["beds"] is JsonArray beds ? beds : new JsonArray();
            segment["paths"] = paths;

            var segmentValidation = service.Validate("segments", segment);
            if (!segmentValidation.Ok)
            {
                return Results.BadRequest(new { errors = segmentValidation.Issues });
            }

            await service.UpsertAsync("segments", "segmentId", segment, ct);
            return Results.Ok(path);
        });

        app.MapPatch("/api/beds/{id}", async (IGardenApplicationService service, string id, JsonObject payload, CancellationToken ct) =>
        {
            var segments = (await service.ListAsync("segments", ct)).OfType<JsonObject>().ToList();
            var sourceSegment = segments.FirstOrDefault(segment =>
                (segment["beds"] as JsonArray)?.OfType<JsonObject>().Any(bed => bed["bedId"]?.GetValue<string>() == id) == true);

            JsonObject bed;
            if (sourceSegment is null)
            {
                var targetSegmentId = payload["segmentId"]?.GetValue<string>();
                if (string.IsNullOrWhiteSpace(targetSegmentId))
                {
                    return Results.BadRequest(new { errors = new[] { new { message = "segmentId is required when creating a bed." } } });
                }

                sourceSegment = await service.GetByIdAsync("segments", "segmentId", targetSegmentId, ct);
                if (sourceSegment is null)
                {
                    return Results.NotFound();
                }

                bed = payload.DeepClone() as JsonObject ?? new JsonObject();
                bed["bedId"] = id;
            }
            else
            {
                var currentBed = (sourceSegment["beds"] as JsonArray)!
                    .OfType<JsonObject>()
                    .First(existing => existing["bedId"]?.GetValue<string>() == id);
                bed = MergeLayoutEntity(currentBed, payload, "bedId", id);
            }

            var destinationSegmentId = bed["segmentId"]?.GetValue<string>() ?? sourceSegment["segmentId"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(destinationSegmentId))
            {
                return Results.BadRequest(new { errors = new[] { new { message = "segmentId is required for bed updates." } } });
            }

            bed["segmentId"] = destinationSegmentId;
            var bedValidation = service.Validate("beds", bed);
            if (!bedValidation.Ok)
            {
                return Results.BadRequest(new { errors = bedValidation.Issues });
            }

            var destinationSegment = destinationSegmentId == sourceSegment["segmentId"]?.GetValue<string>()
                ? sourceSegment
                : await service.GetByIdAsync("segments", "segmentId", destinationSegmentId, ct);
            if (destinationSegment is null)
            {
                return Results.NotFound();
            }

            RemoveNestedEntityById(sourceSegment, "beds", "bedId", id);
            UpsertNestedEntity(destinationSegment, "beds", "bedId", bed);

            sourceSegment["paths"] = sourceSegment["paths"] is JsonArray sourcePaths ? sourcePaths : new JsonArray();
            destinationSegment["paths"] = destinationSegment["paths"] is JsonArray destinationPaths ? destinationPaths : new JsonArray();

            var sourceValidation = service.Validate("segments", sourceSegment);
            if (!sourceValidation.Ok)
            {
                return Results.BadRequest(new { errors = sourceValidation.Issues });
            }

            var destinationValidation = service.Validate("segments", destinationSegment);
            if (!destinationValidation.Ok)
            {
                return Results.BadRequest(new { errors = destinationValidation.Issues });
            }

            await service.UpsertAsync("segments", "segmentId", sourceSegment, ct);
            if (destinationSegment["segmentId"]?.GetValue<string>() != sourceSegment["segmentId"]?.GetValue<string>())
            {
                await service.UpsertAsync("segments", "segmentId", destinationSegment, ct);
            }

            return Results.Ok(bed);
        });

        app.MapPatch("/api/paths/{id}", async (IGardenApplicationService service, string id, JsonObject payload, CancellationToken ct) =>
        {
            var segments = (await service.ListAsync("segments", ct)).OfType<JsonObject>().ToList();
            var sourceSegment = segments.FirstOrDefault(segment =>
                (segment["paths"] as JsonArray)?.OfType<JsonObject>().Any(path => path["pathId"]?.GetValue<string>() == id) == true);

            JsonObject path;
            if (sourceSegment is null)
            {
                var targetSegmentId = payload["segmentId"]?.GetValue<string>();
                if (string.IsNullOrWhiteSpace(targetSegmentId))
                {
                    return Results.BadRequest(new { errors = new[] { new { message = "segmentId is required when creating a path." } } });
                }

                sourceSegment = await service.GetByIdAsync("segments", "segmentId", targetSegmentId, ct);
                if (sourceSegment is null)
                {
                    return Results.NotFound();
                }

                path = payload.DeepClone() as JsonObject ?? new JsonObject();
                path["pathId"] = id;
            }
            else
            {
                var currentPath = (sourceSegment["paths"] as JsonArray)!
                    .OfType<JsonObject>()
                    .First(existing => existing["pathId"]?.GetValue<string>() == id);
                path = MergeLayoutEntity(currentPath, payload, "pathId", id);
            }

            var destinationSegmentId = path["segmentId"]?.GetValue<string>() ?? sourceSegment["segmentId"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(destinationSegmentId))
            {
                return Results.BadRequest(new { errors = new[] { new { message = "segmentId is required for path updates." } } });
            }

            path["segmentId"] = destinationSegmentId;
            var pathValidation = service.Validate("paths", path);
            if (!pathValidation.Ok)
            {
                return Results.BadRequest(new { errors = pathValidation.Issues });
            }

            var destinationSegment = destinationSegmentId == sourceSegment["segmentId"]?.GetValue<string>()
                ? sourceSegment
                : await service.GetByIdAsync("segments", "segmentId", destinationSegmentId, ct);
            if (destinationSegment is null)
            {
                return Results.NotFound();
            }

            RemoveNestedEntityById(sourceSegment, "paths", "pathId", id);
            UpsertNestedEntity(destinationSegment, "paths", "pathId", path);

            sourceSegment["beds"] = sourceSegment["beds"] is JsonArray sourceBeds ? sourceBeds : new JsonArray();
            destinationSegment["beds"] = destinationSegment["beds"] is JsonArray destinationBeds ? destinationBeds : new JsonArray();

            var sourceValidation = service.Validate("segments", sourceSegment);
            if (!sourceValidation.Ok)
            {
                return Results.BadRequest(new { errors = sourceValidation.Issues });
            }

            var destinationValidation = service.Validate("segments", destinationSegment);
            if (!destinationValidation.Ok)
            {
                return Results.BadRequest(new { errors = destinationValidation.Issues });
            }

            await service.UpsertAsync("segments", "segmentId", sourceSegment, ct);
            if (destinationSegment["segmentId"]?.GetValue<string>() != sourceSegment["segmentId"]?.GetValue<string>())
            {
                await service.UpsertAsync("segments", "segmentId", destinationSegment, ct);
            }

            return Results.Ok(path);
        });

        app.MapDelete("/api/beds/{id}", async (IGardenApplicationService service, string id, CancellationToken ct) =>
        {
            var segments = (await service.ListAsync("segments", ct)).OfType<JsonObject>().ToList();
            var sourceSegment = segments.FirstOrDefault(segment =>
                (segment["beds"] as JsonArray)?.OfType<JsonObject>().Any(bed => bed["bedId"]?.GetValue<string>() == id) == true);
            if (sourceSegment is null)
            {
                return Results.NotFound();
            }

            RemoveNestedEntityById(sourceSegment, "beds", "bedId", id);
            sourceSegment["paths"] = sourceSegment["paths"] is JsonArray paths ? paths : new JsonArray();

            var segmentValidation = service.Validate("segments", sourceSegment);
            if (!segmentValidation.Ok)
            {
                return Results.BadRequest(new { errors = segmentValidation.Issues });
            }

            await service.UpsertAsync("segments", "segmentId", sourceSegment, ct);
            return Results.NoContent();
        });

        app.MapDelete("/api/paths/{id}", async (IGardenApplicationService service, string id, CancellationToken ct) =>
        {
            var segments = (await service.ListAsync("segments", ct)).OfType<JsonObject>().ToList();
            var sourceSegment = segments.FirstOrDefault(segment =>
                (segment["paths"] as JsonArray)?.OfType<JsonObject>().Any(path => path["pathId"]?.GetValue<string>() == id) == true);
            if (sourceSegment is null)
            {
                return Results.NotFound();
            }

            RemoveNestedEntityById(sourceSegment, "paths", "pathId", id);
            sourceSegment["beds"] = sourceSegment["beds"] is JsonArray beds ? beds : new JsonArray();

            var segmentValidation = service.Validate("segments", sourceSegment);
            if (!segmentValidation.Ok)
            {
                return Results.BadRequest(new { errors = segmentValidation.Issues });
            }

            await service.UpsertAsync("segments", "segmentId", sourceSegment, ct);
            return Results.NoContent();
        });
    }

    private static JsonObject MergeLayoutEntity(JsonObject existing, JsonObject patch, string idProperty, string id)
    {
        var merged = existing.DeepClone() as JsonObject ?? new JsonObject();
        foreach (var (key, value) in patch)
        {
            merged[key] = value?.DeepClone();
        }

        merged[idProperty] = id;
        return merged;
    }

    private static void RemoveNestedEntityById(JsonObject segment, string collectionKey, string idKey, string id)
    {
        var items = segment[collectionKey] as JsonArray ?? new JsonArray();
        for (var index = items.Count - 1; index >= 0; index--)
        {
            if (items[index] is JsonObject existing && existing[idKey]?.GetValue<string>() == id)
            {
                items.RemoveAt(index);
            }
        }

        segment[collectionKey] = items;
    }

    private static void UpsertNestedEntity(JsonObject segment, string collectionKey, string idKey, JsonObject entity)
    {
        var items = segment[collectionKey] as JsonArray ?? new JsonArray();
        var targetId = entity[idKey]?.GetValue<string>();
        var replaced = false;
        for (var index = 0; index < items.Count; index++)
        {
            if (items[index] is JsonObject existing && existing[idKey]?.GetValue<string>() == targetId)
            {
                items[index] = entity.DeepClone();
                replaced = true;
                break;
            }
        }

        if (!replaced)
        {
            items.Add(entity.DeepClone());
        }

        segment[collectionKey] = items;
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
