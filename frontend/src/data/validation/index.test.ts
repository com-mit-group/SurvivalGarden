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
  generateOperationalTasks,
  generatePlannedTasks,
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
  type: 'vegetable_bed',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
};


const validSpecies = {
  id: 'species_carrot',
  commonName: 'Carrot',
  scientificName: 'Daucus carota',
  aliases: ['Garden carrot'],
  notes: 'Cool-season root crop.',
};


const validCrop = {
  cropId: 'crop-1',
  name: 'Carrot',
  scientificName: 'Daucus carota',
  aliases: ['Garden carrot', 'Nantes carrot'],
  isUserDefined: true,
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

const validPartialCrop = {
  cropId: 'crop-partial',
  name: 'Partial Crop',
  createdAt: '2024-01-03T00:00:00Z',
  updatedAt: '2024-01-03T00:00:00Z',
};

const validCropPlan = {
  planId: 'plan-1',
  segmentId: 'segment-1',
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
  placements: [
    {
      type: 'points',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.1 },
      ],
    },
  ],
};

const validSegment = {
  segmentId: 'segment-1',
  name: 'Segment 1',
  width: 10,
  height: 5,
  originReference: 'nw_corner',
  beds: [
    {
      ...validBed,
      x: 0,
      y: 0,
      width: 2,
      height: 1,
    },
  ],
  paths: [],
};

const validBatch = {
  batchId: 'batch-1',
  cropId: 'crop-1',
  variety: 'Nantes',
  startedAt: '2024-03-01T00:00:00Z',
  stage: 'sowing',
  currentStage: 'sowing',
  seedCountPlanned: 120,
  seedCountGerminated: 98,
  plantCountAlive: 94,
  meta: { confidence: 'exact' },
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
  cultivarId: 'cultivar-1',
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
  segments: [validSegment],
  beds: [validBed],
  species: [validSpecies],
  crops: [validCrop],
  cultivars: [
    {
      cultivarId: 'cultivar-1',
      cropTypeId: 'crop-1',
      name: 'Nantes',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ],
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
        type: 'vegetable_bed',
        createdAt: 'not-a-date',
        updatedAt: '2024-01-01T00:00:00Z',
      }),
    ).toThrowError(SchemaValidationError);

    try {
      assertValid('bed', {
        bedId: 'bed-1',
        gardenId: 'garden-1',
        name: 'Bed 1',
        type: 'vegetable_bed',
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
      expect(() => assertValid('appState', JSON.parse(firstExport))).not.toThrow();
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

  it('roundtrips vNext crop identity and batch count/confidence fields exactly', () => {
    const state = {
      ...validAppState,
      crops: [
        {
          ...validCrop,
          cropId: 'crop-vnext',
          name: 'Custom Tomato',
          scientificName: 'Solanum lycopersicum',
          aliases: ['Tomate', 'Garden tomato'],
          isUserDefined: true,
        },
      ],
      batches: [
        {
          ...validBatch,
          batchId: 'batch-vnext',
          cropId: 'crop-vnext',
          variety: 'Black Cherry',
          seedCountPlanned: 48,
          seedCountGerminated: 36,
          plantCountAlive: 30,
          stageEvents: [{ stage: 'sowing', occurredAt: '2026-02-01T00:00:00Z', meta: { confidence: 'estimated' } }],
          assignments: [{ bedId: 'bed-1', assignedAt: '2026-02-01T00:00:00Z' }],
          meta: { confidence: 'estimated' },
        },
        {
          ...validBatch,
          batchId: 'batch-vnext-no-counts',
          cropId: 'crop-vnext',
          variety: 'Sun Gold',
          seedCountPlanned: undefined,
          seedCountGerminated: undefined,
          plantCountAlive: undefined,
          meta: { confidence: 'unknown' },
        },
      ],
    };

    const exported = serializeAppStateForExport(state);
    const exportedPayload = JSON.parse(exported);
    expect(() => assertValid('appState', exportedPayload)).not.toThrow();

    const imported = parseImportedAppState(exported);
    const reExportedPayload = JSON.parse(serializeAppStateForExport(imported));

    expect(canonicalizeForComparison(reExportedPayload)).toEqual(canonicalizeForComparison(exportedPayload));

    const importedCrop = imported.crops.find((crop) => crop.cropId === 'crop-vnext');
    expect(importedCrop).toMatchObject({
      scientificName: 'Solanum lycopersicum',
      aliases: ['Tomate', 'Garden tomato'],
      isUserDefined: true,
    });

    const importedBatch = imported.batches.find((batch) => batch.batchId === 'batch-vnext');
    expect(importedBatch).toMatchObject({
      variety: 'Black Cherry',
      seedCountPlanned: 48,
      seedCountGerminated: 36,
      plantCountAlive: 30,
      meta: { confidence: 'estimated' },
    });
    expect(importedBatch?.stageEvents[0]).toMatchObject({ meta: { confidence: 'estimated' } });

    const importedBatchWithoutCounts = imported.batches.find((batch) => batch.batchId === 'batch-vnext-no-counts');
    expect(importedBatchWithoutCounts).toMatchObject({
      variety: 'Sun Gold',
      meta: { confidence: 'unknown' },
    });
    expect(importedBatchWithoutCounts?.seedCountPlanned).toBeUndefined();
    expect(importedBatchWithoutCounts?.seedCountGerminated).toBeUndefined();
    expect(importedBatchWithoutCounts?.plantCountAlive).toBeUndefined();
  });


  it('normalizes legacy imported batches into canonical schema-valid records', () => {
    const legacyImport = JSON.stringify({
      ...validAppState,
      batches: [
        {
          batchId: 'legacy-seed',
          cropId: 'crop-1',
          startedAt: '2026-03-01T00:00:00Z',
          stage: 'sowing',
          currentStage: 'sowing',
          seedCountPlanned: 20,
          seedCountGerminated: 16,
          plantCountAlive: 14,
          stageEvents: [{ stage: 'sowing', occurredAt: '2026-03-01T00:00:00Z' }],
          assignments: [],
        },
        {
          batchId: 'legacy-cutting',
          cropId: 'crop-1',
          startedAt: '2026-04-10T00:00:00Z',
          stage: 'transplant',
          currentStage: 'transplant',
          propagationType: 'cutting',
          stageEvents: [{ stage: 'transplant', occurredAt: '2026-04-10T00:00:00Z' }],
          assignments: [],
        },
      ],
    });

    const parsed = parseImportedAppState(legacyImport);

    expect(() => assertValid('appState', parsed)).not.toThrow();
    expect(parsed.batches).toHaveLength(2);
    expect(parsed.batches[0]).toMatchObject({
      batchId: 'legacy-seed',
      seedCountPlanned: 20,
      seedCountGerminated: 16,
      plantCountAlive: 14,
      startedAt: '2026-03-01T00:00:00Z',
      currentStage: 'sowing',
    });
    expect(parsed.batches[1]).toMatchObject({
      batchId: 'legacy-cutting',
      propagationType: 'cutting',
      startedAt: '2026-04-10T00:00:00Z',
      currentStage: 'transplant',
    });
    expect(parsed.batches[1]?.seedCountPlanned).toBeUndefined();
    expect(parsed.batches[1]?.seedCountGerminated).toBeUndefined();
  });

  it('canonicalizes export ordering and keeps photo data metadata-only', () => {
    const unorderedState = {
      ...validAppState,
      beds: [
        { ...validBed, bedId: 'bed-2', name: 'B bed' },
        { ...validBed, bedId: 'bed-1', name: 'A bed' },
      ],
      batches: [
        {
          ...validBatch,
          batchId: 'batch-2',
          photos: [
            { id: 'photo-2', storageRef: 'photo-2', filename: 'second.jpg' },
            { id: 'photo-1', storageRef: 'photo-1', filename: 'first.jpg' },
          ],
        },
      ],
      tasks: [
        { ...validTask, id: 'task-2', sourceKey: 'source-2' },
        { ...validTask, id: 'task-1', sourceKey: 'source-1' },
      ],
    };

    const exported = JSON.parse(serializeAppStateForExport(unorderedState)) as {
      beds: Array<{ bedId: string }>;
      tasks: Array<{ id: string }>;
      batches: Array<{ photos?: Array<{ id: string; filename?: string; blobBase64?: string }> }>;
    };

    expect(exported.beds.map((bed) => bed.bedId)).toEqual(['bed-1', 'bed-2']);
    expect(exported.tasks.map((task) => task.id)).toEqual(['task-1', 'task-2']);
    expect(exported.batches[0]?.photos?.map((photo) => photo.id)).toEqual(['photo-1', 'photo-2']);
    expect(JSON.stringify(exported)).not.toContain('blobBase64');
  });
});




const describeIndexedDb = typeof indexedDB === 'undefined' ? describe.skip : describe;

describeIndexedDb('indexeddb photo blob storage', () => {
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

    const firstBatch = loaded?.batches[0] as { photos?: Array<Record<string, unknown>> } | undefined;
    expect(firstBatch?.photos?.[0]).toEqual({ id: 'photo-2', storageRef: 'photo-2', filename: 'sample.jpg' });
    expect(JSON.stringify(loaded)).not.toContain('blobBase64');
    expect(JSON.stringify(loaded)).not.toContain('image-bytes');
  });




  it('merge mode persists new species entries after reload', async () => {
    await saveAppStateToIndexedDb({
      ...validAppState,
      species: [{ ...validSpecies, notes: 'Existing notes.' }],
    }, { mode: 'replace' });

    const report = await saveAppStateToIndexedDb({
      ...validAppState,
      species: [
        { ...validSpecies, notes: 'Updated imported notes.' },
        {
          id: 'species_pea',
          commonName: 'Pea',
          scientificName: 'Pisum sativum',
          aliases: ['Garden pea'],
          notes: 'Imported during merge.',
        },
      ],
    }, { mode: 'merge' });

    const loaded = await loadAppStateFromIndexedDb();

    expect(loaded?.species).toEqual([
      { ...validSpecies, notes: 'Updated imported notes.' },
      {
        id: 'species_pea',
        commonName: 'Pea',
        scientificName: 'Pisum sativum',
        aliases: ['Garden pea'],
        notes: 'Imported during merge.',
      },
    ]);
    expect(report?.species.updated).toBe(1);
    expect(report?.species.added).toBe(1);
  });

  it('merge mode prevents duplicate entities and tasks by id/sourceKey', async () => {
    await resetToGoldenDataset();

    const imported = {
      ...validAppState,
      beds: [{ ...validBed, bedId: 'bed-1', name: 'Imported Bed Name', updatedAt: '2024-01-03T00:00:00Z' }],
      tasks: [
        {
          ...validTask,
          id: 'task-imported-id',
          sourceKey: 'shared-source',
          status: 'pending',
          checklist: [{ step: 'Water thoroughly' }],
        },
      ],
    };

    await saveAppStateToIndexedDb({
      ...validAppState,
      tasks: [
        {
          ...validTask,
          id: 'task-existing-id',
          sourceKey: 'shared-source',
          status: 'done',
          checklist: [{ step: 'Water thoroughly', done: true }],
        },
      ],
    }, { mode: 'replace' });

    const report = await saveAppStateToIndexedDb(imported, { mode: 'merge' });
    const loaded = await loadAppStateFromIndexedDb();

    expect(loaded?.beds).toHaveLength(1);
    expect(loaded?.beds[0]?.name).toBe('Imported Bed Name');
    expect(loaded?.tasks).toHaveLength(1);
    expect(loaded?.tasks[0]?.sourceKey).toBe('shared-source');
    expect(loaded?.tasks[0]?.status).toBe('done');
    expect(report?.beds.updated).toBe(1);
    expect(report?.tasks.updated).toBe(1);
  });

  it('merge mode prefers latest updatedAt and records conflict for equal timestamps', async () => {
    await saveAppStateToIndexedDb({
      ...validAppState,
      beds: [{ ...validBed, bedId: 'bed-conflict', name: 'Current Name', updatedAt: '2024-01-03T00:00:00Z' }],
    }, { mode: 'replace' });

    const report = await saveAppStateToIndexedDb({
      ...validAppState,
      beds: [{ ...validBed, bedId: 'bed-conflict', name: 'Imported Name', updatedAt: '2024-01-03T00:00:00Z' }],
    }, { mode: 'merge' });

    const loaded = await loadAppStateFromIndexedDb();
    expect(loaded?.beds[0]?.name).toBe('Imported Name');
    expect(report?.conflicts.some((entry) => entry.includes('beds:bed-conflict'))).toBe(true);
  });

  it('merge mode treats missing updatedAt as imported newer and warns', async () => {
    await saveAppStateToIndexedDb({
      ...validAppState,
      batches: [{ ...validBatch, batchId: 'batch-missing-updated-at', stage: 'sowing' }],
    }, { mode: 'replace' });

    const report = await saveAppStateToIndexedDb({
      ...validAppState,
      batches: [{ ...validBatch, batchId: 'batch-missing-updated-at', stage: 'harvest' }],
    }, { mode: 'merge' });

    const loaded = await loadAppStateFromIndexedDb();
    expect(loaded?.batches[0]?.stage).toBe('harvest');
    expect(report?.warnings.some((entry) => entry.includes('batch-missing-updated-at'))).toBe(true);
  });
  it('replace mode wipes previous entities, clears blobs, and seeds default settings when missing', async () => {
    await resetToGoldenDataset();

    await savePhotoBlobToIndexedDb('stale-photo', new Blob(['old-bytes'], { type: 'image/jpeg' }));

    const replacementState = {
      ...validAppState,
      beds: [{ ...validBed, bedId: 'replacement-bed', name: 'Replacement Bed' }],
      crops: [{ ...validCrop, cropId: 'replacement-crop', name: 'Replacement Crop' }],
      cropPlans: [{ ...validCropPlan, planId: 'replacement-plan', cropId: 'replacement-crop' }],
      batches: [{ ...validBatch, batchId: 'replacement-batch', bedId: 'replacement-bed', cropId: 'replacement-crop' }],
      settings: undefined,
    };

    await saveAppStateToIndexedDb(replacementState, { mode: 'replace' });

    const loaded = await loadAppStateFromIndexedDb();
    expect(loaded?.beds).toEqual([{ ...validBed, bedId: 'replacement-bed', name: 'Replacement Bed' }]);
    expect(loaded?.crops).toEqual([{ ...validCrop, cropId: 'replacement-crop', name: 'Replacement Crop' }]);
    expect(loaded?.cropPlans).toEqual([{ ...validCropPlan, planId: 'replacement-plan', cropId: 'replacement-crop' }]);
    expect(loaded?.batches).toEqual([{ ...validBatch, batchId: 'replacement-batch', bedId: 'replacement-bed', cropId: 'replacement-crop' }]);
    expect(loaded?.settings).toEqual(getSettingsOrDefault(undefined));

    await expect(loadPhotoBlobFromIndexedDb('stale-photo')).resolves.toBeNull();
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

  it('accepts partial crops without rules, nutrition, or companions', () => {
    const upserted = upsertCropInAppState(validAppState, validPartialCrop);

    expect(getCropFromAppState(upserted, validPartialCrop.cropId)).toEqual(validPartialCrop);
    expect(listCropsFromAppState(upserted)).toContainEqual(validPartialCrop);
  });

  it('roundtrips partial crops through export/import', () => {
    const stateWithPartialCrop = upsertCropInAppState(validAppState, validPartialCrop);
    const exported = serializeAppStateForExport(stateWithPartialCrop);
    const imported = parseImportedAppState(exported);

    expect(getCropFromAppState(imported, validPartialCrop.cropId)).toEqual(validPartialCrop);
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
        currentStage: 'ended',
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
      currentStage: 'failed',
      stageEvents: [...validBatch.stageEvents, { stage: 'failed', occurredAt: '2024-03-10T00:00:00Z' }],
    };

    const withFailed = upsertBatchInAppState(validAppState, failedBatch);

    const endedBatch = {
      ...failedBatch,
      stage: 'ended',
      currentStage: 'ended',
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
        currentStage: 'transplant',
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

describe('planned task generation', () => {
  it('returns deterministic planned tasks for the golden fixture', () => {
    const fixture = goldenFixtures['../../../../fixtures/golden/trier-v1.json'];

    const first = generatePlannedTasks(fixture, 2026);
    const second = generatePlannedTasks(fixture, 2026);

    expect(first).toEqual(second);
    expect(first.map((task) => `${task.date}:${task.sourceKey}`)).toEqual(
      [...first.map((task) => `${task.date}:${task.sourceKey}`)].sort(),
    );
    expect(first.every((task) =>
      /^plan_2026_[a-z0-9-]+_[a-z0-9-]+_\d+_[a-z_]+_\d+$/.test(task.sourceKey),
    )).toBe(true);
  });

  it('skips crop plans that cannot resolve crop task rules', () => {
    const tasks = generatePlannedTasks(
      {
        ...validAppState,
        cropPlans: [
          {
            ...validCropPlan,
            cropId: 'missing-crop',
            seasonYear: 2026,
          },
        ],
      },
      2026,
    );

    expect(tasks).toEqual([]);
  });
});



describe('operational task generation', () => {
  it('generates deterministic batch-linked tasks from stage timelines using latest active cycle anchors', () => {
    const fixture = goldenFixtures['../../../../fixtures/golden/trier-v1.json'] as Record<string, unknown>;

    const withBatches = {
      ...fixture,
      batches: [
        {
          batchId: 'batch-alpha',
          cropId: 'tomato',
          startedAt: '2026-03-01T00:00:00Z',
          stage: 'transplant',
          stageEvents: [
            { stage: 'pre_sown', occurredAt: '2026-03-01T00:00:00Z' },
            { stage: 'germinated', occurredAt: '2026-03-10T00:00:00Z' },
            { stage: 'transplant', occurredAt: '2026-05-01T00:00:00Z' },
            { stage: 'transplant', occurredAt: '2026-05-15T00:00:00Z' },
          ],
          assignments: [{ bedId: 'bed_001', assignedAt: '2026-05-15T00:00:00Z' }],
        },
      ],
    };

    const first = generateOperationalTasks(withBatches);
    const second = generateOperationalTasks(withBatches);

    expect(first).toEqual(second);
    expect(first).not.toHaveLength(0);
    expect(first.every((task) => task.batchId === 'batch-alpha')).toBe(true);
    expect(first.map((task) => `${task.date}:${task.sourceKey}`)).toEqual(
      [...first.map((task) => `${task.date}:${task.sourceKey}`)].sort(),
    );

    const hardenOffTasks = first.filter((task) => task.type === 'harden-off');
    expect(hardenOffTasks).toHaveLength(2);
    expect(hardenOffTasks.every((task) => task.sourceKey.includes('2026-05-15t00:00:00z'))).toBe(true);

    const transplantAnchorTasks = first.filter((task) =>
      ['harden-off', 'bed-assignment', 'harvest-reminder'].includes(task.type),
    );
    expect(transplantAnchorTasks.every((task) => task.sourceKey.includes('2026-05-15t00:00:00z'))).toBe(true);
  });

  it('resolves bedId per task date using batch assignment history', () => {
    const fixture = goldenFixtures['../../../../fixtures/golden/trier-v1.json'] as Record<string, unknown>;

    const generated = generateOperationalTasks({
      ...fixture,
      batches: [
        {
          batchId: 'batch-alpha',
          cropId: 'tomato',
          startedAt: '2026-03-01T00:00:00Z',
          stage: 'transplant',
          stageEvents: [
            { stage: 'pre_sown', occurredAt: '2026-03-01T00:00:00Z' },
            { stage: 'germinated', occurredAt: '2026-03-10T00:00:00Z' },
            { stage: 'transplant', occurredAt: '2026-03-20T00:00:00Z' },
          ],
          assignments: [
            { bedId: 'bed_001', assignedAt: '2026-03-01T00:00:00Z' },
            { bedId: 'bed_002', assignedAt: '2026-03-16T00:00:00Z' },
          ],
        },
      ],
    });

    expect(generated.find((task) => task.type === 'germination-check' && task.date === '2026-03-08')?.bedId).toBe('bed_001');
    expect(generated.find((task) => task.type === 'pot-up')?.bedId).toBe('bed_002');
    expect(generated.find((task) => task.type === 'bed-assignment')?.bedId).toBe('bed_002');

    const withoutActiveAssignment = generateOperationalTasks({
      ...fixture,
      batches: [
        {
          batchId: 'batch-beta',
          cropId: 'tomato',
          startedAt: '2026-03-01T00:00:00Z',
          stage: 'germinated',
          stageEvents: [
            { stage: 'pre_sown', occurredAt: '2026-03-01T00:00:00Z' },
          ],
          assignments: [{ bedId: 'bed_003', assignedAt: '2026-03-10T00:00:00Z' }],
        },
      ],
    });

    expect(withoutActiveAssignment[0]?.bedId).toBe('unassigned');
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
        checklist: [{ step: 'Water and mulch' }],
      },
    ]);
  });

  it('preserves checklist completion and keeps user-added checklist entries on regeneration', () => {
    const appStateWithTask = {
      ...validAppState,
      tasks: [
        {
          ...validTask,
          checklist: [
            { step: 'Water thoroughly', done: true },
            { step: 'User note', done: true },
          ],
          status: 'done',
        },
      ],
    };

    const regeneratedTask = {
      ...validTask,
      id: 'task-2',
      date: '2026-03-10',
      checklist: [
        { step: 'Water thoroughly', done: false },
        { step: 'Add compost', done: false },
      ],
      status: 'pending',
    };

    const merged = upsertGeneratedTasksInAppState(appStateWithTask, [regeneratedTask]);

    expect(merged.tasks).toEqual([
      {
        ...regeneratedTask,
        status: 'done',
        checklist: [
          { step: 'Water thoroughly', done: true },
          { step: 'Add compost', done: false },
          { step: 'User note', done: true },
        ],
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

    expect(listSeedInventoryItemsFromAppState(withSeedItem, { filter: { cultivarId: 'cultivar-1' } })).toEqual([
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

describe('segment-local geometry bounds', () => {
  it('rejects beds and paths that exceed parent segment bounds with explicit coordinate messages', () => {
    expect(() =>
      assertValid('segment', {
        segmentId: 'segment_main',
        name: 'Main segment',
        width: 10,
        height: 5,
        originReference: 'NW',
        beds: [
          {
            bedId: 'bed_001',
            gardenId: 'garden_001',
            name: 'Bed 1',
            type: 'vegetable_bed',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            x: 9.5,
            y: 0,
            width: 1,
            height: 1,
          },
        ],
        paths: [
          {
            pathId: 'path_001',
            name: 'Path 1',
            x: 0,
            y: 4.8,
            width: 1,
            height: 0.5,
          },
        ],
      }),
    ).toThrowError(SchemaValidationError);

    try {
      assertValid('segment', {
        segmentId: 'segment_main',
        name: 'Main segment',
        width: 10,
        height: 5,
        originReference: 'NW',
        beds: [
          {
            bedId: 'bed_001',
            gardenId: 'garden_001',
            name: 'Bed 1',
            type: 'vegetable_bed',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            x: 9.5,
            y: 0,
            width: 1,
            height: 1,
          },
        ],
        paths: [
          {
            pathId: 'path_001',
            name: 'Path 1',
            x: 0,
            y: 4.8,
            width: 1,
            height: 0.5,
          },
        ],
      });
    } catch (error) {
      const validationError = error as SchemaValidationError;
      expect(validationError.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: '/beds/0/x',
            message: expect.stringContaining('bed extends past segment east boundary'),
          }),
          expect.objectContaining({
            path: '/paths/0/y',
            message: expect.stringContaining('path extends past segment south boundary'),
          }),
        ]),
      );
    }
  });
});
