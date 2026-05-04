using System.Net;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using NUnit.Framework;

namespace SurvivalGarden.Api.Tests;

[TestFixture]
public sealed class ApiContractRouteOwnershipTests
{
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;

    [OneTimeSetUp]
    public void SetUp()
    {
        _factory = new WebApplicationFactory<Program>();
        _client = _factory.CreateClient();
    }

    [OneTimeTearDown]
    public void TearDown()
    {
        _client?.Dispose();
        _factory?.Dispose();
    }

    [Test]
    public async Task OpenApi_DoesNotExposeGenericSegmentMutationRoutes()
    {
        var document = await LoadOpenApiAsync();
        var segmentById = document["paths"]?["/api/segments/{id}"]?.AsObject();

        segmentById.Should().NotBeNull();
        segmentById!.ContainsKey("put").Should().BeFalse("workflow-owned segment writes must be command-style");
    }

    [Test]
    public async Task OpenApi_BatchGenericMutationRoutesRemainBlockedWhenBatchWorkflowCutoverCompletes()
    {
        var document = await LoadOpenApiAsync();
        var batchById = document["paths"]?["/api/batches/{id}"]?.AsObject();

        batchById.Should().NotBeNull();
        batchById!.ContainsKey("patch").Should().BeFalse("generic batch patch mutations are disallowed for workflow-owned entities");
    }

    private async Task<JsonObject> LoadOpenApiAsync()
    {
        _client.Should().NotBeNull();
        using var response = await _client!.GetAsync("/openapi/v1.json");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var node = JsonNode.Parse(json)?.AsObject();
        node.Should().NotBeNull();
        return node!;
    }
}
