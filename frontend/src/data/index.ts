import type { AppState } from '../contracts';
import { assertValid } from './validation';

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

export const serializeAppStateForExport = (appState: AppState): string => {
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
  appState: AppState,
): void => {
  storage.setItem(key, serializeAppStateForExport(appState));
};
