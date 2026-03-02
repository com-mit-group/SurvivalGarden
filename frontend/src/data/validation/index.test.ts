import { describe, expect, it, vi } from 'vitest';
import {
  SchemaValidationError,
  assertValid,
  parseImportedAppState,
  serializeAppStateForExport,
  saveAppStateToStorage,
  getBedFromAppState,
  listBedsFromAppState,
  upsertBedInAppState,
  getCropFromAppState,
  listCropsFromAppState,
  upsertCropInAppState,
  removeCropFromAppState,
  getCropPlanFromAppState,
  listCropPlansFromAppState,
  upsertCropPlanInAppState,
  removeCropPlanFromAppState,
  getBatchFromAppState,
  listBatchesFromAppState,
  upsertBatchInAppState,
  removeBatchFromAppState,
  getTaskFromAppState,
  listTasksFromAppState,
  upsertTaskInAppState,
  removeTaskFromAppState,
  upsertGeneratedTasksInAppState,
  getSeedInventoryItemFromAppState,
  listSeedInventoryItemsFromAppState,
  upsertSeedInventoryItemInAppState,
  removeSeedInventoryItemFromAppState,
  getSettingsFromAppState,
  saveSettingsInAppState,
  getSettingsOrDefault,
  savePhotoBlobToIndexedDb,
  loadPhotoBlobFromIndexedDb,
  deletePhotoBlobFromIndexedDb,
  saveAppStateToIndexedDb,
  loadAppStateFromIndexedDb,
  resetToGoldenDataset,
  AppStateStorageError,
} from '..';

const goldenFixtures = import.meta.glob('../../../../fixtures/golden/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

const pathSegmentWildcard = '*';
const nonRoundtrippedPaths = ['/photos/*/blob', '/photos/*/blobBase64'];

const pathMatches = (path: string, pattern: string): boolean => {
  const pathParts = path.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);

  if (pathParts.length !== patternParts.length) {
    return false;
  }

  return patternParts.every(
    (patternPart, index) => patternPart === pathSegmentWildcard || patternPart === pathParts[index],
  );
};


const validBed = {
  bedId: 'bed-1',
  gardenId: 'garden-1',
  name: 'Bed 1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
};


const validCrop = {
  cropId: 'crop-1',
  name: 'Carrot',
  category: 'root',
  companionsGood: ['onion'],
  companionsAvoid: ['dill'],
  rules: {
    sowing: {
      sequence: 1,
      windows: [
        {
          startMonth: 3,
          startWeek: 2,
          endMonth: 4,
          endWeek: 3,
        },
      ],
      notes: 'Direct sow',
    },
    transplant: {
      sequence: 2,
      windows: [
        {
          startMonth: 4,
          startWeek: 4,
          endMonth: 5,
          endWeek: 2,
        },
      ],
      notes: 'Thin as needed',
    },
    harvest: {
      sequence: 3,
      windows: [
        {
          startMonth: 6,
          startWeek: 1,
          endMonth: 9,
          endWeek: 4,
        },
      ],
      notes: 'Pull when ready',
    },
    storage: {
      sequence: 4,
      windows: [
        {
          startMonth: 9,
          startWeek: 1,
          endMonth: 12,
          endWeek: 4,
        },
      ],
      notes: 'Cool and humid',
    },
  },
  nutritionProfile: [
    {
      nutrient: 'fiber',
      value: 2.8,
      unit: 'g',
      source: 'USDA',
      assumptions: 'raw',
    },
  ],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
};

const validCropPlan = {
  planId: 'plan-1',
  cropId: 'crop-1',
  bedId: 'bed-1',
  seasonYear: 2024,
  plannedWindows: {
    sowing: [
      {
        startMonth: 3,
        startWeek: 2,
        endMonth: 4,
        endWeek: 3,
      },
    ],
    harvest: [
      {
        startMonth: 6,
        startWeek: 1,
        endMonth: 9,
        endWeek: 4,
      },
    ],
  },
  expectedYield: {
    amount: 12,
    unit: 'kg',
  },
  notes: 'Main spring bed',
};

const validBatch = {
  batchId: 'batch-1',
  cropId: 'crop-1',
  startedAt: '2024-03-01T00:00:00Z',
  stage: 'sowing',
  stageEvents: [{ stage: 'sowing', occurredAt: '2024-03-01T00:00:00Z' }],
  assignments: [{ bedId: 'bed-1', assignedAt: '2024-03-01T00:00:00Z' }],
  photos: [{ id: 'photo-1', storageRef: 'photo-1', contentType: 'image/jpeg' }],
};

const validTask = {
  id: 'task-1',
  sourceKey: 'batch_2026-03-01_crop_tomato_bed_001_water',
  date: '2026-03-01',
  type: 'water',
  cropId: 'crop-1',
  bedId: 'bed-1',
  batchId: 'batch-1',
  checklist: [{ step: 'Water thoroughly' }],
  status: 'done',
};

const validSeedInventoryItem = {
  seedInventoryItemId: 'seed-item-1',
  cropId: 'crop-1',
  variety: 'Nantes',
  quantity: 120,
  unit: 'seeds',
  status: 'available',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
};

const validAppState = {
  schemaVersion: 1,
  beds: [validBed],
  crops: [validCrop],
  cropPlans: [validCropPlan],
  batches: [validBatch],
  tasks: [],
  seedInventoryItems: [],
  settings: {
    settingsId: 'settings-1',
    locale: 'de-DE',
    timezone: 'Europe/Berlin',
    units: {
      temperature: 'celsius',
      yield: 'metric',
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
};

const canonicalizeForComparison = (value: unknown, path = '/'): unknown => {
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalizeForComparison(item, `${path}${path.endsWith('/') ? '' : '/'}${index}`));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => {
          const keyPath = `${path}${path.endsWith('/') ? '' : '/'}${key}`;
          return !nonRoundtrippedPaths.some((pattern) => pathMatches(keyPath, pattern));
        })
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => {
          const keyPath = `${path}${path.endsWith('/') ? '' : '/'}${key}`;
          return [key, canonicalizeForComparison(nestedValue, keyPath)];
        }),
    );
  }

  return value;
};

describe('assertValid', () => {
  it('throws normalized validation issues for invalid appState payloads', () => {
    expect(() => assertValid('appState', { schemaVersion: 0 })).toThrowError(
      SchemaValidationError,
    );

    try {
      assertValid('appState', { schemaVersion: 0 });
    } catch (error) {
      const validationError = error as SchemaValidationError;
      expect(validationError.schemaName).toBe('appState');
      expect(validationError.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            schemaName: 'appState',
            path: '/schemaVersion',
            keyword: 'minimum',
          }),
          expect.objectContaining({
            schemaName: 'appState',
            path: '/',
            keyword: 'required',
            message: expect.stringContaining("must have required property 'beds'"),
          }),
        ]),
      );
    }
  });

  it('throws readable error paths for nested contracts', () => {
    expect(() =>
      assertValid('bed', {
        bedId: 'bed-1',
        gardenId: 'garden-1',
        name: 'Bed 1',
        createdAt: 'not-a-date',
        updatedAt: '2024-01-01T00:00:00Z',
      }),
    ).toThrowError(SchemaValidationError);

    try {
      assertValid('bed', {
        bedId: 'bed-1',
        gardenId: 'garden-1',
        name: 'Bed 1',
        createdAt: 'not-a-date',
        updatedAt: '2024-01-01T00:00:00Z',
      });
    } catch (error) {
      const validationError = error as SchemaValidationError;
      expect(validationError.schemaName).toBe('bed');
      expect(validationError.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            schemaName: 'bed',
            path: '/createdAt',
            keyword: 'pattern',
          }),
        ]),
      );
    }
  });
});

describe('data boundary validation', () => {
  it('rejects invalid imported app state JSON payloads', () => {
    expect(() => parseImportedAppState('{"schemaVersion":0}')).toThrowError(
      SchemaValidationError,
    );
  });

  it('rejects invalid app state before storage persistence', () => {
    const setItem = vi.fn();
    const storage = { setItem };

    expect(() => saveAppStateToStorage(storage, 'survival-garden', { schemaVersion: 0 })).toThrowError(
      SchemaValidationError,
    );
    expect(setItem).not.toHaveBeenCalled();
  });

  it('roundtrips golden fixtures through export/import/export losslessly', () => {
    const fixturePaths = Object.keys(goldenFixtures).sort();
    expect(fixturePaths.length).toBeGreaterThan(0);

    for (const fixturePath of fixturePaths) {
      const fixture = goldenFixtures[fixturePath];
      const firstExport = serializeAppStateForExport(fixture);
      const imported = parseImportedAppState(firstExport);
      const secondExport = serializeAppStateForExport(imported);

      expect(canonicalizeForComparison(JSON.parse(secondExport))).toEqual(
        canonicalizeForComparison(JSON.parse(firstExport)),
      );
    }
  });

  it('preserves photo metadata in roundtrip while excluding blob payload paths by design', () => {
    const fixture = goldenFixtures['../../../../fixtures/golden/trier-v1.json'];
    const exported = serializeAppStateForExport(fixture);
    const imported = parseImportedAppState(exported);

    expect(canonicalizeForComparison(imported)).toEqual(canonicalizeForComparison(JSON.parse(exported)));
  });
});




describe('indexeddb photo blob storage', () => {
  it('persists and reloads photo blobs via dedicated object store', async () => {
    await resetToGoldenDataset();

    const photoBlob = new Blob(['image-bytes'], { type: 'image/jpeg' });
    await savePhotoBlobToIndexedDb('photo-1', photoBlob);

    const loadedBlob = await loadPhotoBlobFromIndexedDb('photo-1');
    expect(loadedBlob).toBeInstanceOf(Blob);
    expect(loadedBlob?.size).toBe(photoBlob.size);
    expect(loadedBlob?.type).toBe(photoBlob.type);

    await deletePhotoBlobFromIndexedDb('photo-1');
    await expect(loadPhotoBlobFromIndexedDb('photo-1')).resolves.toBeNull();
  });

  it('keeps export metadata-only without inline blob payload bytes', async () => {
    const state = {
      ...validAppState,
      batches: [
        {
          ...validBatch,
          photos: [{ id: 'photo-2', storageRef: 'photo-2', filename: 'sample.jpg' }],
        },
      ],
    };

    await saveAppStateToIndexedDb(state);
    const loaded = await loadAppStateFromIndexedDb();

    expect(loaded?.batches[0]?.photos?.[0]).toEqual({ id: 'photo-2', storageRef: 'photo-2', filename: 'sample.jpg' });
    expect(JSON.stringify(loaded)).not.toContain('blobBase64');
    expect(JSON.stringify(loaded)).not.toContain('image-bytes');
  });

  it('maps quota failures to AppStateStorageError with quota warning', async () => {
    const quotaError = Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' });
    const originalIndexedDB = globalThis.indexedDB;

    const open = vi.fn(() => {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        (request as { error?: DOMException }).error = quotaError as DOMException;
        request.onerror?.(new Event('error'));
      });
      return request;
    });

    vi.stubGlobal('indexedDB', { open });

    try {
      await saveAppStateToIndexedDb(validAppState);
      throw new Error('Expected saveAppStateToIndexedDb to throw for quota failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AppStateStorageError);
      expect((error as Error).message.toLowerCase()).toContain('quota');
    } finally {
      if (originalIndexedDB) {
        vi.stubGlobal('indexedDB', originalIndexedDB);
      } else {
        vi.unstubAllGlobals();
      }
    }
  });
});

describe('bed repository boundary helpers', () => {
  it('rejects invalid bed payloads on create/update via upsert', () => {
    expect(() => upsertBedInAppState(validAppState, null)).toThrowError(SchemaValidationError);
    expect(() =>
      upsertBedInAppState(validAppState, {
        ...validBed,
        createdAt: 'invalid-date',
      }),
    ).toThrowError(SchemaValidationError);
  });

  it('returns typed beds from read paths and normalizes missing records to null', () => {
    expect(getBedFromAppState(validAppState, validBed.bedId)).toEqual(validBed);
    expect(getBedFromAppState(validAppState, 'missing-bed')).toBeNull();
    expect(listBedsFromAppState(validAppState)).toEqual([validBed]);
  });
});


describe('crop repository boundary helpers', () => {
  it('returns typed crops from read paths and normalizes missing records to null', () => {
    expect(getCropFromAppState(validAppState, validCrop.cropId)).toEqual(validCrop);
    expect(getCropFromAppState(validAppState, 'missing-crop')).toBeNull();
    expect(listCropsFromAppState(validAppState)).toEqual([validCrop]);
  });

  it('supports upsert and remove paths for crops', () => {
    const updated = { ...validCrop, name: 'Updated Carrot' };
    const upserted = upsertCropInAppState(validAppState, updated);

    expect(getCropFromAppState(upserted, validCrop.cropId)).toEqual(updated);

    const removed = removeCropFromAppState(upserted, validCrop.cropId);
    expect(getCropFromAppState(removed, validCrop.cropId)).toBeNull();
  });
});

describe('crop plan repository boundary helpers', () => {
  it('returns typed crop plans from read paths and normalizes missing records to null', () => {
    expect(getCropPlanFromAppState(validAppState, validCropPlan.planId)).toEqual(validCropPlan);
    expect(getCropPlanFromAppState(validAppState, 'missing-plan')).toBeNull();
    expect(listCropPlansFromAppState(validAppState)).toEqual([validCropPlan]);
  });

  it('supports upsert and remove paths for crop plans', () => {
    const updated = { ...validCropPlan, notes: 'Updated notes' };
    const upserted = upsertCropPlanInAppState(validAppState, updated);

    expect(getCropPlanFromAppState(upserted, validCropPlan.planId)).toEqual(updated);

    const removed = removeCropPlanFromAppState(upserted, validCropPlan.planId);
    expect(getCropPlanFromAppState(removed, validCropPlan.planId)).toBeNull();
  });

  it('supports MVP empty cropPlans arrays without throwing', () => {
    const appStateWithNoPlans = { ...validAppState, cropPlans: [] };
    expect(listCropPlansFromAppState(appStateWithNoPlans)).toEqual([]);
  });
});


describe('batch repository boundary helpers', () => {
  it('rejects invalid stageEvents and assignments via schema validation', () => {
    expect(() =>
      upsertBatchInAppState(validAppState, {
        ...validBatch,
        stageEvents: [{ stage: '', occurredAt: '2024-03-01T00:00:00Z' }],
      }),
    ).toThrowError(SchemaValidationError);

    expect(() =>
      upsertBatchInAppState(validAppState, {
        ...validBatch,
        assignments: [{ bedId: '', assignedAt: '2024-03-01T00:00:00Z' }],
      }),
    ).toThrowError(SchemaValidationError);
  });

  it('rejects illegal stage transitions with reason codes', () => {
    expect(() =>
      upsertBatchInAppState(validAppState, {
        ...validBatch,
        stage: 'ended',
        stageEvents: [
          ...validBatch.stageEvents,
          { stage: 'ended', occurredAt: '2024-03-10T00:00:00Z' },
        ],
      }),
    ).toThrowError('invalid_stage_transition');
  });

  it('allows failed from any stage and ended after failed', () => {
    const failedBatch = {
      ...validBatch,
      stage: 'failed',
      stageEvents: [...validBatch.stageEvents, { stage: 'failed', occurredAt: '2024-03-10T00:00:00Z' }],
    };

    const withFailed = upsertBatchInAppState(validAppState, failedBatch);

    const endedBatch = {
      ...failedBatch,
      stage: 'ended',
      stageEvents: [...failedBatch.stageEvents, { stage: 'ended', occurredAt: '2024-03-20T00:00:00Z' }],
    };

    const withEnded = upsertBatchInAppState(withFailed, endedBatch);
    expect(getBatchFromAppState(withEnded, endedBatch.batchId)).toEqual(endedBatch);
  });

  it('rejects stage changes when latest stage event does not match current stage', () => {
    expect(() =>
      upsertBatchInAppState(validAppState, {
        ...validBatch,
        stage: 'transplant',
        stageEvents: [...validBatch.stageEvents, { stage: 'harvest', occurredAt: '2024-03-10T00:00:00Z' }],
      }),
    ).toThrowError('stage_event_stage_mismatch');
  });

  it('supports batch read/update/remove and list filters', () => {
    const secondBatch = {
      batchId: 'batch-2',
      cropId: 'crop-1',
      startedAt: '2024-04-15T00:00:00Z',
      stage: 'transplant',
      stageEvents: [{ stage: 'transplant', occurredAt: '2024-04-15T00:00:00Z' }],
      assignments: [{ bedId: 'bed-2', assignedAt: '2024-04-15T00:00:00Z' }],
    };

    const withSecondBatch = upsertBatchInAppState(validAppState, secondBatch);

    expect(getBatchFromAppState(withSecondBatch, validBatch.batchId)).toEqual(validBatch);
    expect(getBatchFromAppState(withSecondBatch, 'missing-batch')).toBeNull();

    expect(listBatchesFromAppState(withSecondBatch, { filter: { stage: 'sowing' } })).toEqual([validBatch]);
    expect(listBatchesFromAppState(withSecondBatch, { filter: { cropId: 'crop-1' } })).toHaveLength(2);
    expect(listBatchesFromAppState(withSecondBatch, { filter: { bedId: 'bed-2' } })).toEqual([secondBatch]);
    expect(
      listBatchesFromAppState(withSecondBatch, {
        filter: { startedAtFrom: '2024-04-01T00:00:00Z', startedAtTo: '2024-04-30T23:59:59Z' },
      }),
    ).toEqual([secondBatch]);

    const removed = removeBatchFromAppState(withSecondBatch, secondBatch.batchId);
    expect(getBatchFromAppState(removed, secondBatch.batchId)).toBeNull();
  });
});

describe('task repository boundary helpers', () => {
  it('supports task read/upsert/remove and list filters', () => {
    const appStateWithTask = {
      ...validAppState,
      tasks: [validTask],
    };

    expect(getTaskFromAppState(appStateWithTask, validTask.id)).toEqual(validTask);
    expect(getTaskFromAppState(appStateWithTask, 'missing-task')).toBeNull();

    const updatedTask = {
      ...validTask,
      status: 'pending',
      checklist: [{ step: 'Water tonight' }],
    };

    const upserted = upsertTaskInAppState(appStateWithTask, updatedTask);

    expect(getTaskFromAppState(upserted, validTask.id)).toEqual(updatedTask);
    expect(listTasksFromAppState(upserted, { filter: { status: 'pending' } })).toEqual([updatedTask]);
    expect(listTasksFromAppState(upserted, { filter: { date: '2026-03-01' } })).toEqual([updatedTask]);

    const removed = removeTaskFromAppState(upserted, updatedTask.id);
    expect(getTaskFromAppState(removed, updatedTask.id)).toBeNull();
  });
});

describe('generated task upsert boundary helper', () => {
  it('preserves existing status while updating regenerated task fields', () => {
    const appStateWithTask = {
      ...validAppState,
      tasks: [validTask],
    };

    const regeneratedTask = {
      ...validTask,
      id: 'task-2',
      date: '2026-03-08',
      checklist: [{ step: 'Water and mulch' }],
      status: 'pending',
    };

    const merged = upsertGeneratedTasksInAppState(appStateWithTask, [regeneratedTask]);

    expect(merged.tasks).toEqual([
      {
        ...regeneratedTask,
        status: 'done',
      },
    ]);
  });

  it('remains idempotent by sourceKey across repeated generation batches', () => {
    const firstGenerated = {
      ...validTask,
      id: 'task-gen-1',
      date: '2026-03-01',
      status: 'pending',
    };

    const secondGeneratedDuplicate = {
      ...validTask,
      id: 'task-gen-2',
      date: '2026-03-15',
      checklist: [{ step: 'Water deeply' }],
      status: 'pending',
    };

    const afterFirstPass = upsertGeneratedTasksInAppState(validAppState, [firstGenerated]);
    const afterSecondPass = upsertGeneratedTasksInAppState(afterFirstPass, [secondGeneratedDuplicate]);

    expect(afterSecondPass.tasks).toHaveLength(1);
    expect(afterSecondPass.tasks[0]).toEqual(secondGeneratedDuplicate);
  });

  it('uses last generated status for duplicate sourceKey entries in one batch when no task exists yet', () => {
    const firstGenerated = {
      ...validTask,
      id: 'task-gen-1',
      status: 'pending',
    };

    const secondGeneratedDuplicate = {
      ...validTask,
      id: 'task-gen-2',
      checklist: [{ step: 'Late refresh' }],
      status: 'done',
    };

    const merged = upsertGeneratedTasksInAppState(validAppState, [
      firstGenerated,
      secondGeneratedDuplicate,
    ]);

    expect(merged.tasks).toEqual([secondGeneratedDuplicate]);
  });
});

describe('seed inventory repository boundary helpers', () => {
  it('supports seed inventory read/upsert/remove and list filters', () => {
    const withSeedItem = upsertSeedInventoryItemInAppState(validAppState, validSeedInventoryItem);

    expect(
      getSeedInventoryItemFromAppState(withSeedItem, validSeedInventoryItem.seedInventoryItemId),
    ).toEqual(validSeedInventoryItem);
    expect(getSeedInventoryItemFromAppState(withSeedItem, 'missing-seed-item')).toBeNull();

    expect(listSeedInventoryItemsFromAppState(withSeedItem, { filter: { cropId: 'crop-1' } })).toEqual([
      validSeedInventoryItem,
    ]);
    expect(
      listSeedInventoryItemsFromAppState(withSeedItem, { filter: { status: 'available' } }),
    ).toEqual([validSeedInventoryItem]);

    const removed = removeSeedInventoryItemFromAppState(
      withSeedItem,
      validSeedInventoryItem.seedInventoryItemId,
    );

    expect(
      getSeedInventoryItemFromAppState(removed, validSeedInventoryItem.seedInventoryItemId),
    ).toBeNull();
  });
});

describe('settings repository boundary helpers', () => {
  it('supports settings get/save paths', () => {
    expect(getSettingsFromAppState(validAppState)).toEqual(validAppState.settings);

    const saved = saveSettingsInAppState(validAppState, {
      ...validAppState.settings,
      locale: 'en-US',
      updatedAt: '2024-02-01T00:00:00Z',
    });

    expect(saved.settings).toEqual({
      ...validAppState.settings,
      locale: 'en-US',
      updatedAt: '2024-02-01T00:00:00Z',
    });
  });

  it('returns schema-valid defaults when settings are absent or invalid', () => {
    const fallbackForMissing = getSettingsOrDefault(undefined);
    const fallbackForInvalid = getSettingsOrDefault({ locale: 'bad' });

    expect(assertValid('settings', fallbackForMissing)).toEqual(fallbackForMissing);
    expect(assertValid('settings', fallbackForInvalid)).toEqual(fallbackForInvalid);
  });
});
