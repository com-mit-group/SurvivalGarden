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

app.MapPost("/api/domain/batches/{id}/stage-events", async (
    IGardenApplicationService service,
    string id,
    JsonObject payload,
    CancellationToken ct) =>
{
    var state = await service.LoadAppStateAsync(ct);
    if (state is null)
    {
        return Results.NotFound(new { error = "app_state_not_found" });
    }

    var batch = GardenJsonCollectionHelpers.GetCollection(state, "batches")
        .OfType<JsonObject>()
        .FirstOrDefault(candidate => string.Equals(candidate["batchId"]?.GetValue<string>(), id, StringComparison.Ordinal));
    if (batch is null)
    {
        return Results.NotFound(new { error = "batch_not_found" });
    }

    var nextStage = payload["stage"]?.GetValue<string>() ?? string.Empty;
    var occurredAt = payload["occurredAt"]?.GetValue<string>() ?? string.Empty;
    if (string.IsNullOrWhiteSpace(nextStage) || string.IsNullOrWhiteSpace(occurredAt))
    {
        return Results.BadRequest(new { error = "stage_and_occurredAt_required" });
    }

    var transition = ApplyStageEvent(batch, nextStage, occurredAt);
    if (!transition.Ok)
    {
        return Results.BadRequest(new { error = transition.Error });
    }

    await service.SaveAppStateAsync(state, ct);
    return Results.Ok(transition.Batch);
});

app.MapPost("/api/domain/batches/{id}/assignment", async (
    IGardenApplicationService service,
    string id,
    JsonObject payload,
    CancellationToken ct) =>
{
    var state = await service.LoadAppStateAsync(ct);
    if (state is null)
    {
        return Results.NotFound(new { error = "app_state_not_found" });
    }

    var batch = GardenJsonCollectionHelpers.GetCollection(state, "batches")
        .OfType<JsonObject>()
        .FirstOrDefault(candidate => string.Equals(candidate["batchId"]?.GetValue<string>(), id, StringComparison.Ordinal));
    if (batch is null)
    {
        return Results.NotFound(new { error = "batch_not_found" });
    }

    var operation = payload["operation"]?.GetValue<string>() ?? string.Empty;
    var at = payload["at"]?.GetValue<string>() ?? string.Empty;
    var bedId = payload["bedId"]?.GetValue<string>();
    if (string.IsNullOrWhiteSpace(operation) || string.IsNullOrWhiteSpace(at))
    {
        return Results.BadRequest(new { error = "operation_and_at_required" });
    }

    var mutation = MutateAssignment(batch, operation, bedId, at);
    if (!mutation.Ok)
    {
        return Results.BadRequest(new { error = mutation.Error });
    }

    await service.SaveAppStateAsync(state, ct);
    return Results.Ok(mutation.Batch);
});

app.MapPost("/api/domain/tasks/regenerate-calendar", async (
    IGardenApplicationService service,
    JsonObject payload,
    CancellationToken ct) =>
{
    var state = await service.LoadAppStateAsync(ct);
    if (state is null)
    {
        return Results.NotFound(new { error = "app_state_not_found" });
    }

    var diagnostics = new JsonArray();
    var tasks = GardenJsonCollectionHelpers.GetCollection(state, "tasks");
    var generatedTasks = new JsonArray();
    foreach (var task in tasks.OfType<JsonObject>())
    {
        if (task["sourceKey"] is null)
        {
            continue;
        }

        generatedTasks.Add(task.DeepClone());
    }

    return Results.Ok(new
    {
        generatedTasks,
        diagnostics,
        stateAfter = state
    });
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

static string NormalizeStage(string stage) => stage switch
{
    "pre_sown" => "sowing",
    _ => stage
};

static bool CanTransition(string currentStage, string nextStage)
{
    var current = NormalizeStage(currentStage);
    var next = NormalizeStage(nextStage);
    if (next == "failed")
    {
        return true;
    }

    if (next == "ended")
    {
        return current is "harvest" or "failed";
    }

    return current switch
    {
        "sowing" => next is "transplant" or "harvest" or "failed",
        "started" => next is "transplant" or "harvest" or "failed",
        "transplant" => next is "harvest" or "failed",
        "harvest" => next is "ended" or "failed",
        "failed" => next is "ended",
        "ended" => next is "failed",
        _ => false
    };
}

static (bool Ok, string? Error, JsonObject Batch) ApplyStageEvent(JsonObject batch, string nextStage, string occurredAt)
{
    var currentStage = NormalizeStage(batch["stage"]?.GetValue<string>() ?? "unknown");
    var normalizedNextStage = NormalizeStage(nextStage);
    if (normalizedNextStage != currentStage && !CanTransition(currentStage, normalizedNextStage))
    {
        return (false, "invalid_stage_transition", batch);
    }

    batch["stage"] = normalizedNextStage;
    batch["currentStage"] = normalizedNextStage;
    var stageEvents = batch["stageEvents"] as JsonArray ?? new JsonArray();
    stageEvents.Add(new JsonObject
    {
        ["stage"] = normalizedNextStage,
        ["occurredAt"] = occurredAt
    });
    batch["stageEvents"] = stageEvents;
    return (true, null, batch);
}

static bool IsWithinWindow(JsonObject assignment, string at)
{
    var fromDate = assignment["fromDate"]?.GetValue<string>() ?? assignment["assignedAt"]?.GetValue<string>() ?? "";
    var toDate = assignment["toDate"]?.GetValue<string>();
    if (string.CompareOrdinal(fromDate, at) > 0)
    {
        return false;
    }

    if (toDate is not null && string.CompareOrdinal(toDate, at) < 0)
    {
        return false;
    }

    return true;
}

static JsonObject? GetActiveAssignment(JsonObject batch, string at)
{
    var assignments = batch["assignments"] as JsonArray;
    if (assignments is null)
    {
        return null;
    }

    JsonObject? active = null;
    foreach (var assignment in assignments.OfType<JsonObject>())
    {
        if (!IsWithinWindow(assignment, at))
        {
            continue;
        }

        var activeFrom = active?["fromDate"]?.GetValue<string>() ?? active?["assignedAt"]?.GetValue<string>() ?? "";
        var candidateFrom = assignment["fromDate"]?.GetValue<string>() ?? assignment["assignedAt"]?.GetValue<string>() ?? "";
        if (active is null || string.CompareOrdinal(candidateFrom, activeFrom) >= 0)
        {
            active = assignment;
        }
    }

    return active;
}

static (bool Ok, string? Error, JsonObject Batch) MutateAssignment(JsonObject batch, string operation, string? bedId, string at)
{
    var assignments = batch["assignments"] as JsonArray ?? new JsonArray();
    batch["assignments"] = assignments;
    batch["bedAssignments"] = assignments.DeepClone();

    if (operation == "assign")
    {
        if (string.IsNullOrWhiteSpace(bedId))
        {
            return (false, "bedId_required", batch);
        }

        var sameBedActive = assignments.OfType<JsonObject>()
            .Any(assignment => string.Equals(assignment["bedId"]?.GetValue<string>(), bedId, StringComparison.Ordinal) && IsWithinWindow(assignment, at));
        if (sameBedActive)
        {
            return (true, null, batch);
        }

        var overlap = assignments.OfType<JsonObject>()
            .Any(assignment => IsWithinWindow(assignment, at));
        if (overlap)
        {
            return (false, "batch_assignment_overlap", batch);
        }

        assignments.Add(new JsonObject
        {
            ["bedId"] = bedId,
            ["assignedAt"] = at,
            ["fromDate"] = at
        });

        return (true, null, batch);
    }

    if (operation == "move")
    {
        if (string.IsNullOrWhiteSpace(bedId))
        {
            return (false, "bedId_required", batch);
        }

        var active = GetActiveAssignment(batch, at);
        if (active is null)
        {
            return (false, "batch_assignment_no_active", batch);
        }

        var activeFrom = active["fromDate"]?.GetValue<string>() ?? active["assignedAt"]?.GetValue<string>() ?? "";
        if (string.CompareOrdinal(at, activeFrom) < 0)
        {
            return (false, "batch_assignment_move_before_start", batch);
        }

        if (string.Equals(active["bedId"]?.GetValue<string>(), bedId, StringComparison.Ordinal))
        {
            return (true, null, batch);
        }

        active["toDate"] = at;
        assignments.Add(new JsonObject
        {
            ["bedId"] = bedId,
            ["assignedAt"] = at,
            ["fromDate"] = at
        });
        return (true, null, batch);
    }

    if (operation == "remove")
    {
        var active = GetActiveAssignment(batch, at);
        if (active is null)
        {
            return (true, null, batch);
        }

        active["toDate"] = at;
        return (true, null, batch);
    }

    return (false, "invalid_assignment_operation", batch);
}
