import type { AppState, Batch } from '../contracts';
import { assertValid } from './validation';
import { getSettingsOrDefault } from './repos/settingsRepository';
import { mergeTaskForImport } from './repos/taskRepository';
import goldenDatasetFixture from '../../../fixtures/golden/trier-v1.json';

export {
  getBedFromAppState,
  listBedsFromAppState,
  removeBedFromAppState,
  upsertBedInAppState,
} from './repos/bedRepository';
export {
  getCropFromAppState,
  listCropsFromAppState,
  removeCropFromAppState,
  upsertCropInAppState,
} from './repos/cropRepository';
export {
  getCropPlanFromAppState,
  listCropPlansFromAppState,
  removeCropPlanFromAppState,
  upsertCropPlanInAppState,
} from './repos/cropPlanRepository';
export {
  assignBatchToBed,
  getActiveBedAssignment,
  getBatchFromAppState,
  listBatchesFromAppState,
  moveBatch,
  removeBatchFromBed,
  removeBatchFromAppState,
  upsertBatchInAppState,
} from './repos/batchRepository';

export {
  getSeedInventoryItemFromAppState,
  listSeedInventoryItemsFromAppState,
  removeSeedInventoryItemFromAppState,
  upsertSeedInventoryItemInAppState,
} from './repos/seedInventoryRepository';
export {
  getSettingsFromAppState,
  getSettingsOrDefault,
  saveSettingsInAppState,
} from './repos/settingsRepository';
export {
  generateCalendarTasksWithDiagnostics,
  generateOperationalTasks,
  generatePlannedTasks,
  getTaskFromAppState,
  listTasksFromAppState,
  removeTaskFromAppState,
  upsertGeneratedTasksInAppState,
  upsertTaskInAppState,
} from './repos/taskRepository';

const APP_STATE_DB_NAME = 'survival-garden';
const APP_STATE_DB_VERSION = 6;
const APP_STATE_STORE = 'appState';
const APP_STATE_RECORD_KEY = 'current';
const META_STORE = 'meta';
const BED_INDEX_STORE = 'bedsById';
const CROP_INDEX_STORE = 'cropsById';
const CROP_PLAN_INDEX_STORE = 'cropPlansById';
const BATCH_INDEX_STORE = 'batchesById';
const PHOTO_BLOB_STORE = 'photoBlobsById';
const SCHEMA_VERSION_KEY = 'schemaVersion';

const LEGACY_BED_TYPE = 'vegetable_bed';

const addTypeToLegacyBed = <T extends Record<string, unknown>>(bed: T): T => ({
  ...bed,
  type: typeof bed.type === 'string' ? bed.type : LEGACY_BED_TYPE,
});

const migrateLegacyBedTypes = (payload: unknown): unknown => {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const state = payload as Record<string, unknown>;
  const beds = Array.isArray(state.beds)
    ? state.beds.map((bed) => (bed && typeof bed === 'object' ? addTypeToLegacyBed(bed as Record<string, unknown>) : bed))
    : state.beds;

  const segments = Array.isArray(state.segments)
    ? state.segments.map((segment) => {
        if (!segment || typeof segment !== 'object') {
          return segment;
        }

        const typedSegment = segment as Record<string, unknown>;
        const segmentBeds = Array.isArray(typedSegment.beds)
          ? typedSegment.beds.map((bed) =>
              bed && typeof bed === 'object' ? addTypeToLegacyBed(bed as Record<string, unknown>) : bed,
            )
          : typedSegment.beds;

        return {
          ...typedSegment,
          beds: segmentBeds,
          paths: Array.isArray(typedSegment.paths) ? typedSegment.paths : [],
        };
      })
    : state.segments;

  return {
    ...state,
    beds,
    segments,
  };
};

const GOLDEN_DATASET = assertValid('appState', migrateLegacyBedTypes(goldenDatasetFixture));

export type {
  AppStateRepository,
  BatchListFilter,
  BatchRepository,
  BedRepository,
  CropPlanRepository,
  CropRepository,
  CrudRepository,
  ListQuery,
  ListableRepository,
  SeedInventoryRepository,
  SettingsRepository,
  TaskRepository,
  Unsubscribe,
  WatchableRepository,
} from './repos/interfaces';

export {
  SchemaValidationError,
  type SchemaName,
  type SchemaTypeMap,
  type ValidationIssue,
  assertValid,
} from './validation';

export const parseImportedAppState = (rawPayload: string): AppState => {
  const parsed: unknown = JSON.parse(rawPayload);
  return assertValid('appState', migrateLegacyBedTypes(parsed));
};

const compareByString = (left: string, right: string): number => left.localeCompare(right);

const getStringValue = (record: unknown, key: string): string | null => {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
};

const sortCollectionByKey = <T>(collection: T[], keys: string[]): T[] =>
  [...collection].sort((left, right) => {
    for (const key of keys) {
      const leftValue = getStringValue(left, key);
      const rightValue = getStringValue(right, key);

      if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
        return compareByString(leftValue, rightValue);
      }
    }

    return compareByString(JSON.stringify(left), JSON.stringify(right));
  });

const canonicalizeForExport = (appState: AppState): AppState => {
  const canonicalBatches = sortCollectionByKey(
    appState.batches.map((batch) => ({
      ...batch,
      photos: Array.isArray((batch as Batch & { photos?: unknown[] }).photos)
        ? sortCollectionByKey((batch as Batch & { photos?: unknown[] }).photos ?? [], ['id', 'storageRef', 'capturedAt', 'filename'])
        : (batch as Batch & { photos?: unknown[] }).photos,
    })),
    ['batchId', 'cropId', 'startedAt'],
  );

  return {
    ...appState,
    beds: sortCollectionByKey(appState.beds, ['bedId', 'gardenId', 'name']),
    crops: sortCollectionByKey(appState.crops, ['cropId', 'name']),
    cropPlans: sortCollectionByKey(appState.cropPlans, ['planId', 'cropId']),
    batches: canonicalBatches,
    seedInventoryItems: sortCollectionByKey(appState.seedInventoryItems, ['seedInventoryItemId', 'cropId']),
    tasks: sortCollectionByKey(appState.tasks, ['id', 'sourceKey']),
    segments: appState.segments
      ? sortCollectionByKey(
          appState.segments.map((segment) => ({
            ...segment,
            beds: sortCollectionByKey(segment.beds, ['bedId', 'gardenId', 'name']),
            paths: sortCollectionByKey(segment.paths, ['pathId', 'name']),
          })),
          ['segmentId', 'name'],
        )
      : appState.segments,
  };
};

export const serializeAppStateForExport = (appState: unknown): string => {
  const validState = assertValid('appState', appState);
  return JSON.stringify(canonicalizeForExport(validState));
};

export const loadAppStateFromStorage = (
  storage: Pick<Storage, 'getItem'>,
  key: string,
): AppState | null => {
  const value = storage.getItem(key);

  if (value === null) {
    return null;
  }

  return parseImportedAppState(value);
};

export const saveAppStateToStorage = (
  storage: Pick<Storage, 'setItem'>,
  key: string,
  appState: unknown,
): void => {
  storage.setItem(key, serializeAppStateForExport(appState));
};

export class AppStateStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppStateStorageError';
  }
}

type SaveAppStateOptions = {
  mode?: 'merge' | 'replace';
};

type MergeReportSection = {
  added: number;
  updated: number;
  unchanged: number;
};

type MergeReport = {
  beds: MergeReportSection;
  crops: MergeReportSection;
  cropPlans: MergeReportSection;
  batches: MergeReportSection;
  tasks: MergeReportSection;
  seedInventoryItems: MergeReportSection;
  conflicts: string[];
  warnings: string[];
};

type EntityType = 'beds' | 'crops' | 'cropPlans' | 'batches' | 'seedInventoryItems';

const createEmptyMergeReportSection = (): MergeReportSection => ({ added: 0, updated: 0, unchanged: 0 });

const createEmptyMergeReport = (): MergeReport => ({
  beds: createEmptyMergeReportSection(),
  crops: createEmptyMergeReportSection(),
  cropPlans: createEmptyMergeReportSection(),
  batches: createEmptyMergeReportSection(),
  tasks: createEmptyMergeReportSection(),
  seedInventoryItems: createEmptyMergeReportSection(),
  conflicts: [],
  warnings: [],
});

const ENTITY_ID_KEY: Record<EntityType, string> = {
  beds: 'bedId',
  crops: 'cropId',
  cropPlans: 'planId',
  batches: 'batchId',
  seedInventoryItems: 'seedInventoryItemId',
};

const normalizeTimestamp = (value: unknown): number | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const date = Date.parse(value);
  return Number.isNaN(date) ? null : date;
};

const getObjectValue = (record: object, key: string): unknown =>
  (record as Record<string, unknown>)[key];

const compareWithUpdatedAt = (
  entityLabel: string,
  id: string,
  currentRecord: object,
  incomingRecord: object,
  report: MergeReport,
): number => {
  const currentUpdatedAt = normalizeTimestamp(getObjectValue(currentRecord, 'updatedAt'));
  const incomingUpdatedAt = normalizeTimestamp(getObjectValue(incomingRecord, 'updatedAt'));

  if (currentUpdatedAt === null || incomingUpdatedAt === null) {
    report.warnings.push(`${entityLabel}:${id} missing updatedAt; preferred imported value.`);
    return 1;
  }

  if (currentUpdatedAt === incomingUpdatedAt) {
    report.conflicts.push(`${entityLabel}:${id} has identical updatedAt; preferred imported value.`);
  }

  return incomingUpdatedAt >= currentUpdatedAt ? 1 : -1;
};

const mergeCollectionById = <T extends object>(
  entityType: EntityType,
  currentCollection: T[],
  incomingCollection: T[],
  report: MergeReport,
): T[] => {
  const section = report[entityType];
  const idKey = ENTITY_ID_KEY[entityType];
  const mergedById = new Map(currentCollection.map((record) => [String(getObjectValue(record, idKey)), record]));

  for (const incomingRecord of incomingCollection) {
    const id = String(getObjectValue(incomingRecord, idKey));
    const currentRecord = mergedById.get(id);

    if (!currentRecord) {
      mergedById.set(id, incomingRecord);
      section.added += 1;
      continue;
    }

    const preference = compareWithUpdatedAt(entityType, id, currentRecord, incomingRecord, report);
    const nextRecord = preference >= 0 ? incomingRecord : currentRecord;
    const unchanged = JSON.stringify(currentRecord) === JSON.stringify(nextRecord);
    mergedById.set(id, nextRecord);
    section[unchanged ? 'unchanged' : 'updated'] += 1;
  }

  return [...mergedById.values()];
};

const mergeTasksForImport = (currentTasks: AppState['tasks'], incomingTasks: AppState['tasks'], report: MergeReport): AppState['tasks'] => {
  const mergedBySourceKey = new Map(currentTasks.map((task) => [task.sourceKey, task]));

  for (const incomingTask of incomingTasks) {
    const currentTask = mergedBySourceKey.get(incomingTask.sourceKey) ?? null;
    const merged = mergeTaskForImport(currentTask, incomingTask);
    mergedBySourceKey.set(incomingTask.sourceKey, merged.task);
    report.tasks[merged.outcome] += 1;
  }

  return [...mergedBySourceKey.values()];
};

const mergeAppStates = (currentState: AppState, incomingState: AppState): { state: AppState; report: MergeReport } => {
  const report = createEmptyMergeReport();

  const mergedState: AppState = {
    ...currentState,
    schemaVersion: incomingState.schemaVersion,
    settings: incomingState.settings,
    beds: mergeCollectionById('beds', currentState.beds, incomingState.beds, report),
    crops: mergeCollectionById('crops', currentState.crops, incomingState.crops, report),
    cropPlans: mergeCollectionById('cropPlans', currentState.cropPlans, incomingState.cropPlans, report),
    batches: mergeCollectionById('batches', currentState.batches, incomingState.batches, report),
    tasks: mergeTasksForImport(currentState.tasks, incomingState.tasks, report),
    seedInventoryItems: mergeCollectionById('seedInventoryItems', currentState.seedInventoryItems, incomingState.seedInventoryItems, report),
  };

  return { state: mergedState, report };
};

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });

const migrateV1ToV2 = (database: IDBDatabase, transaction: IDBTransaction): void => {
  if (!database.objectStoreNames.contains(META_STORE)) {
    database.createObjectStore(META_STORE);
  }

  const metaStore = transaction.objectStore(META_STORE);
  metaStore.put(2, SCHEMA_VERSION_KEY);
};

const migrateV2ToV3 = (database: IDBDatabase): void => {
  if (!database.objectStoreNames.contains(BED_INDEX_STORE)) {
    database.createObjectStore(BED_INDEX_STORE, { keyPath: 'bedId' });
  }
};

const migrateV3ToV4 = (database: IDBDatabase): void => {
  if (!database.objectStoreNames.contains(CROP_INDEX_STORE)) {
    database.createObjectStore(CROP_INDEX_STORE, { keyPath: 'cropId' });
  }

  if (!database.objectStoreNames.contains(CROP_PLAN_INDEX_STORE)) {
    database.createObjectStore(CROP_PLAN_INDEX_STORE, { keyPath: 'planId' });
  }
};

const migrateV4ToV5 = (database: IDBDatabase): void => {
  if (!database.objectStoreNames.contains(BATCH_INDEX_STORE)) {
    database.createObjectStore(BATCH_INDEX_STORE, { keyPath: 'batchId' });
  }
};

const migrateV5ToV6 = (database: IDBDatabase): void => {
  if (!database.objectStoreNames.contains(PHOTO_BLOB_STORE)) {
    database.createObjectStore(PHOTO_BLOB_STORE);
  }
};

const isQuotaExceededError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const domExceptionLike = error as { name?: string; message?: string; code?: number };
  return (
    domExceptionLike.name === 'QuotaExceededError' ||
    domExceptionLike.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    domExceptionLike.code === 22 ||
    domExceptionLike.code === 1014 ||
    (typeof domExceptionLike.message === 'string' && domExceptionLike.message.toLowerCase().includes('quota'))
  );
};

const toStorageWriteError = (error: unknown, fallbackMessage: string): AppStateStorageError => {
  if (isQuotaExceededError(error)) {
    return new AppStateStorageError('Local storage quota exceeded while saving data. Free up browser storage and try again.');
  }

  const message = error instanceof Error && error.message ? `${fallbackMessage}: ${error.message}` : fallbackMessage;
  return new AppStateStorageError(message);
};

const openAppStateDatabase = async (): Promise<IDBDatabase> => {
  if (typeof indexedDB === 'undefined') {
    throw new AppStateStorageError('IndexedDB is not available in this environment.');
  }

  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(APP_STATE_DB_NAME, APP_STATE_DB_VERSION);

    openRequest.onupgradeneeded = (event) => {
      const database = openRequest.result;
      const { transaction } = openRequest;

      if (!transaction) {
        throw new AppStateStorageError('IndexedDB migration transaction was not created.');
      }

      if (!database.objectStoreNames.contains(APP_STATE_STORE)) {
        database.createObjectStore(APP_STATE_STORE);
      }

      if (event.oldVersion < 2) {
        migrateV1ToV2(database, transaction);
      }

      if (event.oldVersion < 3) {
        migrateV2ToV3(database);
      }

      if (event.oldVersion < 4) {
        migrateV3ToV4(database);
      }

      if (event.oldVersion < 5) {
        migrateV4ToV5(database);
      }

      if (event.oldVersion < 6) {
        migrateV5ToV6(database);
      }
    };

    openRequest.onblocked = () => {
      reject(new AppStateStorageError('Local data storage upgrade is blocked by another browser tab.'));
    };

    openRequest.onerror = () => {
      reject(new AppStateStorageError(`Failed to open local data storage${openRequest.error ? `: ${openRequest.error.message}` : ''}.`));
    };

    openRequest.onsuccess = () => {
      const database = openRequest.result;
      database.onversionchange = () => {
        database.close();
      };
      resolve(database);
    };
  });
};

export const initializeAppStateStorage = async (): Promise<void> => {
  const database = await openAppStateDatabase();

  try {
    const transaction = database.transaction([META_STORE], 'readwrite');
    transaction.objectStore(META_STORE).put(APP_STATE_DB_VERSION, SCHEMA_VERSION_KEY);
    await transactionDone(transaction);
  } finally {
    database.close();
  }

  await seedAppStateIfEmpty();
};

const isEmptyAppState = (appState: AppState | null): boolean =>
  !appState || (appState.beds.length === 0 && appState.crops.length === 0 && appState.cropPlans.length === 0);

const seedAppStateIfEmpty = async (): Promise<void> => {
  const currentState = await loadAppStateFromIndexedDb();

  if (!isEmptyAppState(currentState)) {
    return;
  }

  await saveAppStateToIndexedDb(GOLDEN_DATASET);
};

export const resetToGoldenDataset = async (): Promise<void> => {
  if (typeof indexedDB === 'undefined') {
    throw new AppStateStorageError('IndexedDB is not available in this environment.');
  }

  await new Promise<void>((resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase(APP_STATE_DB_NAME);

    deleteRequest.onsuccess = () => resolve();
    deleteRequest.onerror = () => reject(new AppStateStorageError('Failed to reset local data storage.'));
    deleteRequest.onblocked = () =>
      reject(new AppStateStorageError('Close other SurvivalGarden tabs and try reset again.'));
  });

  await initializeAppStateStorage();
};

export const loadAppStateFromIndexedDb = async (): Promise<AppState | null> => {
  const database = await openAppStateDatabase();

  try {
    const transaction = database.transaction([APP_STATE_STORE], 'readonly');
    const rawValue = await requestToPromise(transaction.objectStore(APP_STATE_STORE).get(APP_STATE_RECORD_KEY));
    await transactionDone(transaction);

    if (rawValue === undefined) {
      return null;
    }

    return assertValid('appState', rawValue);
  } finally {
    database.close();
  }
};

export const saveAppStateToIndexedDb = async (
  appState: unknown,
  options: SaveAppStateOptions = {},
): Promise<MergeReport | null> => {
  const database = await openAppStateDatabase();

  try {
    const candidateState =
      appState && typeof appState === 'object'
        ? {
            ...(appState as Record<string, unknown>),
            settings: getSettingsOrDefault((appState as { settings?: unknown }).settings),
          }
        : appState;
    const validState = assertValid('appState', candidateState);
    const isReplaceMode = options.mode === 'replace';
    let report: MergeReport | null = null;

    const transaction = database.transaction(
      isReplaceMode
        ? [APP_STATE_STORE, META_STORE, BED_INDEX_STORE, CROP_INDEX_STORE, CROP_PLAN_INDEX_STORE, BATCH_INDEX_STORE, PHOTO_BLOB_STORE]
        : [APP_STATE_STORE, META_STORE, BED_INDEX_STORE, CROP_INDEX_STORE, CROP_PLAN_INDEX_STORE, BATCH_INDEX_STORE],
      'readwrite',
    );

    let stateToPersist = validState;

    if (!isReplaceMode) {
      const existingRaw = await requestToPromise(transaction.objectStore(APP_STATE_STORE).get(APP_STATE_RECORD_KEY));

      if (existingRaw !== undefined) {
        const existingState = assertValid('appState', existingRaw);
        const merged = mergeAppStates(existingState, validState);
        stateToPersist = assertValid('appState', merged.state);
        report = merged.report;
      }
    }

    transaction.objectStore(APP_STATE_STORE).put(stateToPersist, APP_STATE_RECORD_KEY);
    transaction.objectStore(META_STORE).put(stateToPersist.schemaVersion, SCHEMA_VERSION_KEY);

    const bedStore = transaction.objectStore(BED_INDEX_STORE);
    const existingBedKeys = await requestToPromise(bedStore.getAllKeys());

    for (const key of existingBedKeys) {
      bedStore.delete(key);
    }

    for (const bed of stateToPersist.beds) {
      bedStore.put(assertValid('bed', bed ?? {}));
    }

    const cropStore = transaction.objectStore(CROP_INDEX_STORE);
    const existingCropKeys = await requestToPromise(cropStore.getAllKeys());

    for (const key of existingCropKeys) {
      cropStore.delete(key);
    }

    for (const crop of stateToPersist.crops) {
      cropStore.put(assertValid('crop', crop ?? {}));
    }

    const cropPlanStore = transaction.objectStore(CROP_PLAN_INDEX_STORE);
    const existingCropPlanKeys = await requestToPromise(cropPlanStore.getAllKeys());

    for (const key of existingCropPlanKeys) {
      cropPlanStore.delete(key);
    }

    for (const cropPlan of stateToPersist.cropPlans) {
      cropPlanStore.put(assertValid('cropPlan', cropPlan ?? {}));
    }

    const batchStore = transaction.objectStore(BATCH_INDEX_STORE);
    const existingBatchKeys = await requestToPromise(batchStore.getAllKeys());

    for (const key of existingBatchKeys) {
      batchStore.delete(key);
    }

    for (const batch of stateToPersist.batches) {
      batchStore.put(assertValid('batch', batch ?? {}));
    }

    if (isReplaceMode) {
      transaction.objectStore(PHOTO_BLOB_STORE).clear();
    }

    await transactionDone(transaction);
    return report;
  } catch (error) {
    throw toStorageWriteError(error, 'Failed to save app state to local data storage');
  } finally {
    database.close();
  }
};

export const savePhotoBlobToIndexedDb = async (photoId: string, blob: Blob): Promise<void> => {
  const database = await openAppStateDatabase();

  try {
    const transaction = database.transaction([PHOTO_BLOB_STORE], 'readwrite');
    transaction.objectStore(PHOTO_BLOB_STORE).put(blob, photoId);
    await transactionDone(transaction);
  } catch (error) {
    throw toStorageWriteError(error, `Failed to save photo blob '${photoId}'`);
  } finally {
    database.close();
  }
};

export const loadPhotoBlobFromIndexedDb = async (photoId: string): Promise<Blob | null> => {
  const database = await openAppStateDatabase();

  try {
    const transaction = database.transaction([PHOTO_BLOB_STORE], 'readonly');
    const stored = await requestToPromise(transaction.objectStore(PHOTO_BLOB_STORE).get(photoId));
    await transactionDone(transaction);
    return stored instanceof Blob ? stored : null;
  } finally {
    database.close();
  }
};

export const deletePhotoBlobFromIndexedDb = async (photoId: string): Promise<void> => {
  const database = await openAppStateDatabase();

  try {
    const transaction = database.transaction([PHOTO_BLOB_STORE], 'readwrite');
    transaction.objectStore(PHOTO_BLOB_STORE).delete(photoId);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
};
