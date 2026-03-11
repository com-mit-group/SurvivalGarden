import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import cropSchema from './crop.schema.json';

declare global {
  interface ImportMeta {
    glob: (
      pattern: string,
      options?: { eager?: boolean; import?: string },
    ) => Record<string, unknown>;
  }
}

const goldenFixtures = import.meta.glob('../../../fixtures/golden/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, { crops?: unknown[] }>;

describe('crop.schema.json', () => {
  const ajv = new Ajv2020({ strict: true });
  const validate = ajv.compile(cropSchema);

  const validPayload = {
    cropId: 'crop_tomato',
    name: 'Tomato',
    category: 'fruiting',
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
    taskRules: [
      {
        taskType: 'pre_sow',
        sequence: 1,
        windows: [{ month: 2, weekIndex: 2 }],
      },
      {
        taskType: 'transplant',
        sequence: 2,
        windows: [{ startDate: '2026-04-01', endDate: '2026-04-21' }],
      },
    ],
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
    const { cropId, name, ...payload } = validPayload;

    expect(cropId).toBeDefined();
    expect(name).toBeDefined();
    expect(validate(payload)).toBe(false);
  });


  it('accepts partial crop payloads with minimal identity only', () => {
    const payload = {
      cropId: 'crop_partial',
      name: 'Partial Crop',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    expect(validate(payload)).toBe(true);
  });


  it('accepts minimal payload with migration aliases and partial rules', () => {
    const payload = {
      id: 'crop_garlic',
      commonName: 'Garlic',
      createdAt: '2026-01-01T01:00:00+01:00',
      updatedAt: '2026-01-01T01:00:00+01:00',
      rules: {
        sowing: {
          sequence: 1,
          windows: [{ startMonth: 10, startWeek: 1, endMonth: 11, endWeek: 4 }],
        },
      },
      defaults: { spacingCm: 15 },
      meta: { family: 'Amaryllidaceae' },
    };

    expect(validate(payload)).toBe(true);
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

  it('rejects invalid task rule task types and window shapes', () => {
    const payload = {
      ...validPayload,
      taskRules: [
        {
          taskType: 'sowing',
          sequence: 1,
          windows: [{ month: 2 }],
        },
      ],
    };

    expect(validate(payload)).toBe(false);
  });

  it('accepts all crop records from real golden datasets', () => {
    const fixturePaths = Object.keys(goldenFixtures).sort();

    expect(fixturePaths.length).toBeGreaterThan(0);

    for (const fixturePath of fixturePaths) {
      const crops = goldenFixtures[fixturePath]?.crops ?? [];
      const fixtureName = fixturePath.replace('../../../fixtures/golden/', '');

      for (let index = 0; index < crops.length; index += 1) {
        const crop = crops[index];
        const isValid = validate(crop);
        const formattedErrors = (validate.errors ?? [])
          .map((error) => `${error.instancePath || '/'} ${error.message}`)
          .join('; ');

        expect(
          isValid,
          `Fixture ${fixtureName} crops/${index} failed: ${formattedErrors}`,
        ).toBe(true);
      }
    }
  });
});
