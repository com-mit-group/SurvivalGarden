import type { AppState } from '../contracts';
import { assertValid } from './validation';
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

const GOLDEN_DATASET = assertValid('appState', goldenDatasetFixture);

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
  return assertValid('appState', parsed);
};

export const serializeAppStateForExport = (appState: unknown): string => {
  const validState = assertValid('appState', appState);
  return JSON.stringify(validState);
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

export const saveAppStateToIndexedDb = async (appState: unknown): Promise<void> => {
  const database = await openAppStateDatabase();

  try {
    const validState = assertValid('appState', appState);
    const transaction = database.transaction(
      [APP_STATE_STORE, META_STORE, BED_INDEX_STORE, CROP_INDEX_STORE, CROP_PLAN_INDEX_STORE, BATCH_INDEX_STORE],
      'readwrite',
    );

    transaction.objectStore(APP_STATE_STORE).put(validState, APP_STATE_RECORD_KEY);
    transaction.objectStore(META_STORE).put(validState.schemaVersion, SCHEMA_VERSION_KEY);

    const bedStore = transaction.objectStore(BED_INDEX_STORE);
    const existingBedKeys = await requestToPromise(bedStore.getAllKeys());

    for (const key of existingBedKeys) {
      bedStore.delete(key);
    }

    for (const bed of validState.beds) {
      bedStore.put(assertValid('bed', bed ?? {}));
    }

    const cropStore = transaction.objectStore(CROP_INDEX_STORE);
    const existingCropKeys = await requestToPromise(cropStore.getAllKeys());

    for (const key of existingCropKeys) {
      cropStore.delete(key);
    }

    for (const crop of validState.crops) {
      cropStore.put(assertValid('crop', crop ?? {}));
    }

    const cropPlanStore = transaction.objectStore(CROP_PLAN_INDEX_STORE);
    const existingCropPlanKeys = await requestToPromise(cropPlanStore.getAllKeys());

    for (const key of existingCropPlanKeys) {
      cropPlanStore.delete(key);
    }

    for (const cropPlan of validState.cropPlans) {
      cropPlanStore.put(assertValid('cropPlan', cropPlan ?? {}));
    }

    const batchStore = transaction.objectStore(BATCH_INDEX_STORE);
    const existingBatchKeys = await requestToPromise(batchStore.getAllKeys());

    for (const key of existingBatchKeys) {
      batchStore.delete(key);
    }

    for (const batch of validState.batches) {
      batchStore.put(assertValid('batch', batch ?? {}));
    }

    await transactionDone(transaction);
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
