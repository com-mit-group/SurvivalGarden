# Derived Field Ownership

Derived fields are server-owned output fields. Clients may include them in payloads, but API mapping removes them before validation/persistence.

## Policy

- **Canonical input fields**: accepted from client and persisted.
- **Derived/output-only fields**: ignored from client payloads.
- Endpoint handlers must use centralized mapper methods in `DtoJsonMapper` for typed upserts.

## Current upsert guardrails

### Crop upsert (`/api/crops/{id}`)

- **Canonical input**: `id`, `name`, `commonName`, `cultivar`, `cultivarGroup`, `speciesId`, `scientificName`, `taxonomy`, `aliases`, `isUserDefined`, `category`, `companionsGood`, `companionsAvoid`, `rules`, `taskRules`, `nutritionProfile`, `defaults`, `meta`.
- **Canonical identity override**: `cropId` always comes from route `{id}`.
- **Ignored derived/output-only**: `createdAt`, `updatedAt`, `species`.

### Seed inventory upsert (`/api/seedInventoryItems/{id}`)

- **Canonical input**: `cultivarId`, `variety`, `cropTypeId`, `speciesId`, `propagationType`, `materialType`, `supplier`, `lotNumber`, `quantity`, `unit`, `purchaseDate`, `expiryDate`, `status`, `storageLocation`, `notes`.
- **Canonical identity override**: `seedInventoryItemId` always comes from route `{id}`.
- **Ignored derived/output-only**: `createdAt`, `updatedAt`.

## Examples

If a client sends:

```json
{ "cropId": "other", "name": "Tomato", "createdAt": "2020-01-01T00:00:00Z" }
```

for `PUT /api/crops/crop-123`, stored canonical payload uses `cropId = "crop-123"` and ignores `createdAt`.
