using System.Text.Json.Nodes;
using SurvivalGarden.Application;
using SurvivalGarden.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddPersistence(builder.Configuration["Persistence:AppStatePath"]);
builder.Services.AddApplication();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

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
    contracts = "mirrored"
}));

app.MapGet("/api/app-state", async (IGardenApplicationService service, CancellationToken ct) =>
{
    var state = await service.LoadAppStateAsync(ct);
    return state is null ? Results.NotFound() : Results.Ok(state);
});

app.MapPut("/api/app-state", async (IGardenApplicationService service, JsonObject payload, CancellationToken ct) =>
{
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
MapEntityCrud(app, "crops", "cropId");
MapEntityCrud(app, "cultivars", "id");
MapEntityCrud(app, "segments", "segmentId");
MapEntityCrud(app, "beds", "bedId");
MapEntityCrud(app, "paths", "pathId");
MapEntityCrud(app, "seedInventoryItems", "seedInventoryItemId");
MapEntityCrud(app, "cropPlans", "planId");

app.MapGet("/api/batches", async (
    IGardenApplicationService service,
    string? stage,
    string? cropId,
    string? bedId,
    string? startedAtFrom,
    string? startedAtTo,
    CancellationToken ct) =>
{
    var rows = await service.ListBatchesAsync(stage, cropId, bedId, startedAtFrom, startedAtTo, ct);
    return Results.Ok(rows);
});

app.MapGet("/api/batches/{id}", async (IGardenApplicationService service, string id, CancellationToken ct) =>
{
    var batch = await service.GetByIdAsync("batches", "batchId", id, ct);
    return batch is null ? Results.NotFound() : Results.Ok(batch);
});

app.MapPut("/api/batches/{id}", async (IGardenApplicationService service, string id, JsonObject payload, CancellationToken ct) =>
{
    payload["batchId"] = id;
    var validation = service.Validate("batches", payload);
    if (!validation.Ok)
    {
        return Results.BadRequest(new { errors = validation.Issues });
    }

    var saved = await service.UpsertAsync("batches", "batchId", payload, ct);
    return Results.Ok(saved);
});

app.MapDelete("/api/batches/{id}", async (IGardenApplicationService service, string id, CancellationToken ct) =>
{
    var removed = await service.RemoveAsync("batches", "batchId", id, ct);
    return removed ? Results.NoContent() : Results.NotFound();
});

app.MapPost("/api/validate/{collection}", (IGardenApplicationService service, string collection, JsonObject payload) =>
{
    var validation = service.Validate(collection, payload);
    return Results.Ok(new
    {
        ok = validation.Ok,
        issues = validation.Issues
    });
});

await app.RunAsync();

static void MapEntityCrud(WebApplication app, string collectionName, string idProperty)
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
