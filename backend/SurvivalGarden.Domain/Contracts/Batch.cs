namespace SurvivalGarden.Domain.Contracts;

public sealed record Batch(
    string Id,
    string? CultivarId,
    string StartedAt,
    string CurrentStage,
    IReadOnlyList<StageEvent> StageEvents,
    IReadOnlyList<BedAssignment> Assignments,
    string? Notes
);

public sealed record StageEvent(
    string Stage,
    string OccurredAt,
    string? Method,
    string? Location,
    string? Notes
);

public sealed record BedAssignment(
    string BedId,
    string AssignedAt,
    string? RemovedAt,
    IReadOnlyDictionary<string, object?>? Meta
);
