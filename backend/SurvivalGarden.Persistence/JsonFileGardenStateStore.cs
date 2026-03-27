using System.Text.Json;
using System.Text.Json.Nodes;
using SurvivalGarden.Application;

namespace SurvivalGarden.Persistence;

public sealed class JsonFileGardenStateStore : IGardenStateStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    private readonly string _filePath;

    public JsonFileGardenStateStore(string filePath)
    {
        _filePath = filePath;
    }

    public async Task<JsonObject?> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_filePath))
        {
            return null;
        }

        await using var stream = File.OpenRead(_filePath);
        var node = await JsonNode.ParseAsync(stream, cancellationToken: cancellationToken);
        return node as JsonObject;
    }

    public async Task SaveAsync(JsonObject appState, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_filePath) ?? ".");
        await using var stream = File.Create(_filePath);
        await JsonSerializer.SerializeAsync(stream, appState, JsonOptions, cancellationToken);
    }
}
