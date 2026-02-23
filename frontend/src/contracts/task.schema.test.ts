import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import taskSchema from './task.schema.json';

describe('task.schema.json', () => {
  const ajv = new Ajv2020({ strict: true });
  const validate = ajv.compile(taskSchema);

  const validPayload = {
    id: 'task_001',
    sourceKey: 'batch_2026-03-01_crop_tomato_bed_001_water',
    date: '2026-03-01',
    type: 'water',
    cropId: 'crop_tomato',
    bedId: 'bed_001',
    batchId: 'batch_2026_03',
    checklist: [{ label: 'Water thoroughly', done: false }],
    status: 'pending',
  };

  it('accepts a valid Task payload', () => {
    expect(validate(validPayload)).toBe(true);
  });

  it('rejects payloads missing required fields', () => {
    const { status, ...payload } = validPayload;

    expect(status).toBeDefined();
    expect(validate(payload)).toBe(false);
  });

  it('rejects invalid date format', () => {
    const payload = {
      ...validPayload,
      date: '2026-03-01T00:00:00Z',
    };

    expect(validate(payload)).toBe(false);
  });

  it('accepts regenerated payload shape with stable sourceKey and updated status', () => {
    const payload = {
      ...validPayload,
      status: 'completed',
      checklist: [{ label: 'Water thoroughly', done: true }],
    };

    expect(payload.sourceKey).toBe(validPayload.sourceKey);
    expect(validate(payload)).toBe(true);
  });
});
