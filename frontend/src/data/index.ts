import type { AppState, Bed } from '../contracts';
import { assertValid } from './validation';

const APP_STATE_DB_NAME = 'survival-garden';
const APP_STATE_DB_VERSION = 3;
const APP_STATE_STORE = 'appState';
const APP_STATE_RECORD_KEY = 'current';
const META_STORE = 'meta';
const BED_INDEX_STORE = 'bedsById';
const SCHEMA_VERSION_KEY = 'schemaVersion';

export type {
  AppStateRepository,
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

const normalizeBedCandidate = (value: unknown): unknown => value ?? {};

export const getBedFromAppState = (appState: unknown, bedId: Bed['bedId']): Bed | null => {
  const state = assertValid('appState', appState);
  const candidate = state.beds.find((bed) => bed.bedId === bedId);

  if (!candidate) {
    return null;
  }

  return assertValid('bed', normalizeBedCandidate(candidate));
};

export const listBedsFromAppState = (appState: unknown): Bed[] => {
  const state = assertValid('appState', appState);
  return state.beds.map((bed) => assertValid('bed', normalizeBedCandidate(bed)));
};

export const upsertBedInAppState = (appState: unknown, bed: unknown): AppState => {
  const state = assertValid('appState', appState);
  const validBed = assertValid('bed', normalizeBedCandidate(bed));
  const existingIndex = state.beds.findIndex((entry) => entry.bedId === validBed.bedId);

  const beds =
    existingIndex >= 0
      ? state.beds.map((entry, index) => (index === existingIndex ? validBed : entry))
      : [...state.beds, validBed];

  return assertValid('appState', { ...state, beds });
};

export const removeBedFromAppState = (appState: unknown, bedId: Bed['bedId']): AppState => {
  const state = assertValid('appState', appState);
  const beds = state.beds.filter((bed) => bed.bedId !== bedId);
  return assertValid('appState', { ...state, beds });
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
    const transaction = database.transaction([APP_STATE_STORE, META_STORE, BED_INDEX_STORE], 'readwrite');

    transaction.objectStore(APP_STATE_STORE).put(validState, APP_STATE_RECORD_KEY);
    transaction.objectStore(META_STORE).put(validState.schemaVersion, SCHEMA_VERSION_KEY);

    const bedStore = transaction.objectStore(BED_INDEX_STORE);
    const existingBedKeys = await requestToPromise(bedStore.getAllKeys());

    for (const key of existingBedKeys) {
      bedStore.delete(key);
    }

    for (const bed of validState.beds) {
      bedStore.put(assertValid('bed', normalizeBedCandidate(bed)));
    }

    await transactionDone(transaction);
  } finally {
    database.close();
  }
};
