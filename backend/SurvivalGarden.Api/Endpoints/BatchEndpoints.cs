using System.Text.Json.Nodes;
using SurvivalGarden.Api.Contracts;
using SurvivalGarden.Application;

namespace SurvivalGarden.Api.Endpoints;

internal static class BatchEndpoints
{
    internal static void MapBatchEndpoints(this WebApplication app)
    {
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

        app.MapPost("/api/batches", async (IGardenApplicationService service, JsonObject payload, CancellationToken ct) =>
        {
            var validation = service.Validate("batches", payload);
            if (!validation.Ok)
            {
                return Results.BadRequest(new
                {
                    error = "validation_failed",
                    workflow = "create_batch",
                    errors = validation.Issues
                });
            }

            var saved = await service.UpsertAsync("batches", "batchId", payload, ct);
            return Results.Ok(saved);
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

        app.MapPost("/api/batches/{id}/stage-events", async (
            IGardenApplicationService service,
            string id,
            StageEventRequest request,
            CancellationToken ct) =>
        {
            var state = await service.LoadAppStateAsync(ct);
            if (state is null)
            {
                return Results.NotFound(new { error = "app_state_not_found", workflow = "stage_event" });
            }

            var batch = GetCollection(state, "batches")
                .OfType<JsonObject>()
                .FirstOrDefault(candidate => string.Equals(candidate["batchId"]?.GetValue<string>(), id, StringComparison.Ordinal));
            if (batch is null)
            {
                return Results.NotFound(new { error = "batch_not_found", workflow = "stage_event", batchId = id });
            }

            var nextStage = request.Stage ?? string.Empty;
            var occurredAt = request.OccurredAt ?? string.Empty;
            if (string.IsNullOrWhiteSpace(nextStage) || string.IsNullOrWhiteSpace(occurredAt))
            {
                return Results.BadRequest(new
                {
                    error = "validation_failed",
                    workflow = "stage_event",
                    errors = new[] { new { path = "/stage|/occurredAt", message = "stage_and_occurredAt_required" } }
                });
            }

            var transition = ApplyStageEvent(batch, nextStage, occurredAt);
            if (!transition.Ok)
            {
                return Results.BadRequest(new
                {
                    error = transition.Error,
                    workflow = "stage_event",
                    batchId = id
                });
            }

            await service.SaveAppStateAsync(state, ct);
            return Results.Ok(transition.Batch);
        });

        app.MapPost("/api/batches/{id}/assign-bed", async (
            IGardenApplicationService service,
            string id,
            BatchAssignmentRequest request,
            CancellationToken ct) =>
        {
            return await MutateBatchAssignment(service, id, "assign", request.BedId, request.At, ct);
        });

        app.MapPost("/api/batches/{id}/unassign-bed", async (
            IGardenApplicationService service,
            string id,
            BatchAssignmentRequest request,
            CancellationToken ct) =>
        {
            return await MutateBatchAssignment(service, id, "remove", request.BedId, request.At, ct);
        });

        app.MapPost("/api/batches/{id}/move-bed", async (
            IGardenApplicationService service,
            string id,
            BatchAssignmentRequest request,
            CancellationToken ct) =>
        {
            return await MutateBatchAssignment(service, id, "move", request.BedId, request.At, ct);
        });

        app.MapPost("/api/batches/{id}/complete", async (
            IGardenApplicationService service,
            string id,
            StageEventRequest request,
            CancellationToken ct) =>
        {
            var occurredAt = request.OccurredAt ?? string.Empty;
            if (string.IsNullOrWhiteSpace(occurredAt))
            {
                return Results.BadRequest(new
                {
                    error = "validation_failed",
                    workflow = "complete_batch",
                    errors = new[] { new { path = "/occurredAt", message = "occurredAt_required" } }
                });
            }

            var state = await service.LoadAppStateAsync(ct);
            if (state is null)
            {
                return Results.NotFound(new { error = "app_state_not_found", workflow = "complete_batch" });
            }

            var batch = GetCollection(state, "batches")
                .OfType<JsonObject>()
                .FirstOrDefault(candidate => string.Equals(candidate["batchId"]?.GetValue<string>(), id, StringComparison.Ordinal));
            if (batch is null)
            {
                return Results.NotFound(new { error = "batch_not_found", workflow = "complete_batch", batchId = id });
            }

            var transition = ApplyStageEvent(batch, "ended", occurredAt);
            if (!transition.Ok)
            {
                return Results.BadRequest(new { error = transition.Error, workflow = "complete_batch", batchId = id });
            }

            await service.SaveAppStateAsync(state, ct);
            return Results.Ok(transition.Batch);
        });

        app.MapDelete("/api/batches/{id}", async (IGardenApplicationService service, string id, CancellationToken ct) =>
        {
            var removed = await service.RemoveAsync("batches", "batchId", id, ct);
            return removed ? Results.NoContent() : Results.NotFound();
        });
    }

    private static string NormalizeStage(string stage) => stage switch
    {
        "pre_sown" => "sowing",
        _ => stage
    };

    private static bool CanTransition(string currentStage, string nextStage)
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

    private static (bool Ok, string? Error, JsonObject Batch) ApplyStageEvent(JsonObject batch, string nextStage, string occurredAt)
    {
        var currentStage = NormalizeStage(batch["currentStage"]?.GetValue<string>() ?? batch["stage"]?.GetValue<string>() ?? "unknown");
        var normalizedNextStage = NormalizeStage(nextStage);
        if (normalizedNextStage != currentStage && !CanTransition(currentStage, normalizedNextStage))
        {
            return (false, "invalid_stage_transition", batch);
        }

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

    private static bool IsWithinWindow(JsonObject assignment, string at)
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

    private static JsonObject? GetActiveAssignment(JsonObject batch, string at)
    {
        var assignments = batch["bedAssignments"] as JsonArray ?? batch["assignments"] as JsonArray;
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

    private static (bool Ok, string? Error, JsonObject Batch) MutateAssignment(JsonObject batch, string operation, string? bedId, string at)
    {
        var assignments = batch["bedAssignments"] as JsonArray ?? batch["assignments"] as JsonArray ?? new JsonArray();
        batch["bedAssignments"] = assignments;

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

        return (false, "invalid_assignment_operation", batch);
    }

    private static async Task<IResult> MutateBatchAssignment(
        IGardenApplicationService service,
        string id,
        string operation,
        string? bedId,
        string? at,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(at))
        {
            return Results.BadRequest(new
            {
                error = "validation_failed",
                workflow = operation switch
                {
                    "assign" => "assign_bed",
                    "move" => "move_bed",
                    _ => "unassign_bed"
                },
                errors = new[] { new { path = "/at", message = "at_required" } }
            });
        }

        var state = await service.LoadAppStateAsync(ct);
        if (state is null)
        {
            return Results.NotFound(new { error = "app_state_not_found" });
        }

        var batch = GetCollection(state, "batches")
            .OfType<JsonObject>()
            .FirstOrDefault(candidate => string.Equals(candidate["batchId"]?.GetValue<string>(), id, StringComparison.Ordinal));
        if (batch is null)
        {
            return Results.NotFound(new { error = "batch_not_found", batchId = id });
        }

        var mutation = MutateAssignment(batch, operation, bedId, at);
        if (!mutation.Ok)
        {
            return Results.BadRequest(new
            {
                error = mutation.Error,
                workflow = operation switch
                {
                    "assign" => "assign_bed",
                    "move" => "move_bed",
                    _ => "unassign_bed"
                },
                batchId = id
            });
        }

        await service.SaveAppStateAsync(state, ct);
        return Results.Ok(mutation.Batch);
    }

    private static JsonArray GetCollection(JsonObject state, string name)
    {
        if (state[name] is JsonArray collection)
        {
            return collection;
        }

        var created = new JsonArray();
        state[name] = created;
        return created;
    }
}
