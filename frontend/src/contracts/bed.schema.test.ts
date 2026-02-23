import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import bedSchema from './bed.schema.json';

describe('bed.schema.json', () => {
  const ajv = new Ajv({ strict: true });
  const validate = ajv.compile(bedSchema);

  it('accepts a valid Bed payload', () => {
    const payload = {
      bedId: 'bed_001',
      gardenId: 'garden_001',
      name: 'South Bed',
      notes: 'Partial shade near fence',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    expect(validate(payload)).toBe(true);
  });

  it('rejects non-string IDs', () => {
    const payload = {
      bedId: 1,
      gardenId: 'garden_001',
      name: 'South Bed',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    expect(validate(payload)).toBe(false);
  });
});
