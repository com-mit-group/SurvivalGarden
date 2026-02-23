import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import cropSchema from './crop.schema.json';

describe('crop.schema.json', () => {
  const ajv = new Ajv2020({ strict: true });
  const validate = ajv.compile(cropSchema);

  const validPayload = {
    cropId: 'crop_tomato',
    name: 'Tomato',
    category: 'fruiting',
    companionsGood: ['basil', 'marigold'],
    companionsAvoid: ['potato'],
    rules: {
      sowing: {
        sequence: 1,
        windows: [{ startMonth: 2, startWeek: 1, endMonth: 3, endWeek: 4 }],
      },
      transplant: {
        sequence: 2,
        windows: [{ startMonth: 4, startWeek: 1, endMonth: 5, endWeek: 2 }],
      },
      harvest: {
        sequence: 3,
        windows: [{ startMonth: 7, startWeek: 1, endMonth: 9, endWeek: 4 }],
      },
      storage: {
        sequence: 4,
        windows: [{ startMonth: 7, startWeek: 1, endMonth: 10, endWeek: 2 }],
        notes: 'Room temperature for short-term storage',
      },
    },
    nutritionProfile: [
      {
        nutrient: 'Vitamin C',
        value: 13.7,
        unit: 'mg',
        source: 'USDA FoodData Central',
        assumptions: 'Per 100g raw edible portion',
      },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('accepts a valid Crop payload', () => {
    expect(validate(validPayload)).toBe(true);
  });

  it('rejects payloads missing required fields', () => {
    const { rules, ...payload } = validPayload;

    expect(rules).toBeDefined();
    expect(validate(payload)).toBe(false);
  });

  it('rejects invalid rule window shape', () => {
    const payload = {
      ...validPayload,
      rules: {
        ...validPayload.rules,
        sowing: {
          sequence: 1,
          windows: [{ startMonth: 2, startWeek: 1, endMonth: 3 }],
        },
      },
    };

    expect(validate(payload)).toBe(false);
  });

  it('rejects invalid nutrition units and source metadata', () => {
    const payload = {
      ...validPayload,
      nutritionProfile: [
        {
          nutrient: 'Protein',
          value: 0.9,
          unit: 'grams',
          source: '',
          assumptions: '',
        },
      ],
    };

    expect(validate(payload)).toBe(false);
  });
});
