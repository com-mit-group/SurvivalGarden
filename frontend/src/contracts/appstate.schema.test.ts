import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import cropPlanSchema from './crop-plan.schema.json';
import seedInventoryItemSchema from './seed-inventory-item.schema.json';
import settingsSchema from './settings.schema.json';

describe('appstate-related schemas', () => {
  const ajv = new Ajv2020({ strict: true });

  it('accepts a valid CropPlan payload', () => {
    const validate = ajv.compile(cropPlanSchema);
    const payload = {
      planId: 'plan_001',
      cropId: 'crop_tomato',
      bedId: 'bed_001',
      seasonYear: 2026,
      plannedWindows: {
        sowing: [{ startMonth: 3, startWeek: 1, endMonth: 3, endWeek: 4 }],
        transplant: [{ startMonth: 4, startWeek: 2, endMonth: 5, endWeek: 1 }],
        harvest: [{ startMonth: 7, startWeek: 1, endMonth: 9, endWeek: 4 }],
      },
      expectedYield: {
        amount: 5,
        unit: 'kg',
      },
    };

    expect(validate(payload)).toBe(true);
  });

  it('rejects CropPlan payload with invalid window fields', () => {
    const validate = ajv.compile(cropPlanSchema);
    const payload = {
      planId: 'plan_001',
      cropId: 'crop_tomato',
      seasonYear: 2026,
      plannedWindows: {
        sowing: [{ startMonth: 0, startWeek: 1, endMonth: 3, endWeek: 4 }],
        harvest: [{ startMonth: 7, startWeek: 1, endMonth: 9, endWeek: 4 }],
      },
      expectedYield: {
        amount: 5,
        unit: 'kg',
      },
    };

    expect(validate(payload)).toBe(false);
  });

  it('accepts a valid SeedInventoryItem payload', () => {
    const validate = ajv.compile(seedInventoryItemSchema);
    const payload = {
      seedInventoryItemId: 'seed_item_001',
      cropId: 'crop_carrot',
      variety: 'Nantes',
      supplier: 'Seed Coop',
      lotNumber: 'LOT-2026-01',
      quantity: 120,
      unit: 'seeds',
      purchaseDate: '2026-01-05T00:00:00Z',
      expiryDate: '2027-01-05T00:00:00Z',
      status: 'available',
      storageLocation: 'Pantry shelf',
      createdAt: '2026-01-05T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    };

    expect(validate(payload)).toBe(true);
  });

  it('rejects SeedInventoryItem payload with invalid status', () => {
    const validate = ajv.compile(seedInventoryItemSchema);
    const payload = {
      seedInventoryItemId: 'seed_item_001',
      cropId: 'crop_carrot',
      variety: 'Nantes',
      quantity: 120,
      unit: 'seeds',
      status: 'in_stock',
      createdAt: '2026-01-05T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    };

    expect(validate(payload)).toBe(false);
  });

  it('accepts a valid Settings payload', () => {
    const validate = ajv.compile(settingsSchema);
    const payload = {
      settingsId: 'settings_001',
      locale: 'de-DE',
      timezone: 'Europe/Berlin',
      weekStartsOn: 'monday',
      units: {
        temperature: 'celsius',
        yield: 'metric',
      },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-10T00:00:00Z',
    };

    expect(validate(payload)).toBe(true);
  });

  it('rejects Settings payload with non-Berlin timezone', () => {
    const validate = ajv.compile(settingsSchema);
    const payload = {
      settingsId: 'settings_001',
      locale: 'de-DE',
      timezone: 'UTC',
      units: {
        temperature: 'celsius',
        yield: 'metric',
      },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-10T00:00:00Z',
    };

    expect(validate(payload)).toBe(false);
  });
});
