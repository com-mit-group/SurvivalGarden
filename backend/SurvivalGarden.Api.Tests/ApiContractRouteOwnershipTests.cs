using System.Net;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace SurvivalGarden.Api.Tests;

public sealed class ApiContractRouteOwnershipTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;

    public ApiContractRouteOwnershipTests(WebApplicationFactory<Program> factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task OpenApi_DoesNotExposeGenericSegmentMutationRoutes()
    {
        var document = await LoadOpenApiAsync();
        var segmentById = document["paths"]?["/api/segments/{id}"]?.AsObject();

        segmentById.Should().NotBeNull();
        segmentById!.ContainsKey("put").Should().BeFalse("workflow-owned segment writes must be command-style");
    }

    [Fact]
    public async Task OpenApi_BatchGenericMutationRoutesRemainBlockedWhenBatchWorkflowCutoverCompletes()
    {
        var document = await LoadOpenApiAsync();
        var batchById = document["paths"]?["/api/batches/{id}"]?.AsObject();

        batchById.Should().NotBeNull();
        batchById!.ContainsKey("patch").Should().BeFalse("generic batch patch mutations are disallowed for workflow-owned entities");
    }

    private async Task<JsonObject> LoadOpenApiAsync()
    {
        using var response = await _client.GetAsync("/openapi/v1.json");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var node = JsonNode.Parse(json)?.AsObject();
        node.Should().NotBeNull();
        return node!;
    }
}
