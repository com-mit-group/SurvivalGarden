using System.Text.Json;
using System.Text.Json.Nodes;

namespace SurvivalGarden.Api.Contracts;

internal static class DtoJsonMapper
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    internal static JsonObject ToJsonObject<T>(T payload)
    {
        return JsonSerializer.SerializeToNode(payload, SerializerOptions) as JsonObject ?? new JsonObject();
    }

    internal static JsonObject ToCanonicalCropUpsert(CropUpsertRequest request, string cropId)
    {
        var payload = ToJsonObject(request);
        return Pick(payload,
            ("cropId", cropId),
            "id",
            "name",
            "commonName",
            "cultivar",
            "cultivarGroup",
            "speciesId",
            "scientificName",
            "taxonomy",
            "aliases",
            "isUserDefined",
            "category",
            "companionsGood",
            "companionsAvoid",
            "rules",
            "taskRules",
            "nutritionProfile",
            "defaults",
            "meta");
    }

    internal static JsonObject ToCanonicalSeedInventoryItemUpsert(SeedInventoryItemUpsertRequest request, string seedInventoryItemId)
    {
        var payload = ToJsonObject(request);
        return Pick(payload,
            ("seedInventoryItemId", seedInventoryItemId),
            "cultivarId",
            "variety",
            "cropTypeId",
            "speciesId",
            "propagationType",
            "materialType",
            "supplier",
            "lotNumber",
            "quantity",
            "unit",
            "purchaseDate",
            "expiryDate",
            "status",
            "storageLocation",
            "notes");
    }

    private static JsonObject Pick(JsonObject payload, params string[] keys)
    {
        var mapped = new JsonObject();
        foreach (var key in keys)
        {
            if (payload[key] is not null)
            {
                mapped[key] = payload[key]!.DeepClone();
            }
        }

        return mapped;
    }

    private static JsonObject Pick(JsonObject payload, (string Key, string Value) requiredIdentity, params string[] keys)
    {
        var mapped = Pick(payload, keys);
        mapped[requiredIdentity.Key] = requiredIdentity.Value;
        return mapped;
    }
}
