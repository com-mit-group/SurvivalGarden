using System.Text.Json.Nodes;
using FluentAssertions;
using NUnit.Framework;
using SurvivalGarden.Application;

namespace SurvivalGarden.Api.Tests;

public class StageTransitionEventEmissionTests
{
    [Test]
    public async Task ApplyBatchStageTransitionAsync_PersistsBeforePublishingEvent()
    {
        var store = new RecordingStore(CreateState("started"));
        var publisher = new RecordingPublisher(store.Actions);
        var service = new GardenApplicationService(store, publisher);

        var result = await service.ApplyBatchStageTransitionAsync("batch-1", "transplant", "2026-01-01T00:00:00.000Z");

        result.Ok.Should().BeTrue();
        store.Actions.Should().ContainInOrder("save", "publish:StageAdvanced");
    }

    [Test]
    public async Task ApplyBatchStageTransitionAsync_RepeatedStage_DoesNotPublishTransitionEvent()
    {
        var store = new RecordingStore(CreateState("transplant"));
        var publisher = new RecordingPublisher(store.Actions);
        var service = new GardenApplicationService(store, publisher);

        var first = await service.ApplyBatchStageTransitionAsync("batch-1", "transplant", "2026-01-01T00:00:00.000Z");
        var second = await service.ApplyBatchStageTransitionAsync("batch-1", "transplant", "2026-01-02T00:00:00.000Z");

        first.Ok.Should().BeTrue();
        second.Ok.Should().BeTrue();
        publisher.Published.Should().BeEmpty();
    }

    private static JsonObject CreateState(string currentStage) => new()
    {
        ["batches"] = new JsonArray
        {
            new JsonObject
            {
                ["batchId"] = "batch-1",
                ["currentStage"] = currentStage,
                ["stageEvents"] = new JsonArray()
            }
        }
    };

    private sealed class RecordingStore : IGardenStateStore
    {
        private JsonObject _state;

        public RecordingStore(JsonObject state)
        {
            _state = state;
        }

        public List<string> Actions { get; } = [];

        public Task<JsonObject?> LoadAsync(CancellationToken cancellationToken = default)
            => Task.FromResult<JsonObject?>((JsonObject)_state.DeepClone());

        public Task SaveAsync(JsonObject appState, CancellationToken cancellationToken = default)
        {
            Actions.Add("save");
            _state = (JsonObject)appState.DeepClone();
            return Task.CompletedTask;
        }
    }

    private sealed class RecordingPublisher(List<string> actions) : IApplicationEventPublisher
    {
        public List<IApplicationEvent> Published { get; } = [];

        public Task PublishAsync(IApplicationEvent applicationEvent, CancellationToken cancellationToken = default)
        {
            Published.Add(applicationEvent);
            actions.Add($"publish:{applicationEvent.GetType().Name}");
            return Task.CompletedTask;
        }
    }
}
