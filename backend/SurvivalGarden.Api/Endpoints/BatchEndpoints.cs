using System.Text.Json.Nodes;
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
    }
}
