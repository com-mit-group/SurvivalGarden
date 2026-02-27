import type { AppState, SeedInventoryItem } from '../../contracts';
import { assertValid } from '../validation';
import type { ListQuery } from './interfaces';

const normalizeSeedInventoryItemCandidate = (value: unknown): unknown => value ?? {};

export const getSeedInventoryItemFromAppState = (
  appState: unknown,
  seedInventoryItemId: SeedInventoryItem['seedInventoryItemId'],
): SeedInventoryItem | null => {
  const state = assertValid('appState', appState);
  const candidate = state.seedInventoryItems.find(
    (seedInventoryItem) => seedInventoryItem.seedInventoryItemId === seedInventoryItemId,
  );

  if (!candidate) {
    return null;
  }

  return assertValid('seedInventoryItem', normalizeSeedInventoryItemCandidate(candidate));
};

export const listSeedInventoryItemsFromAppState = (
  appState: unknown,
  query: ListQuery<Pick<SeedInventoryItem, 'cropId' | 'status'>> = {},
): SeedInventoryItem[] => {
  const state = assertValid('appState', appState);
  const { filter } = query;

  return state.seedInventoryItems
    .filter((seedInventoryItem) => {
      if (!filter) {
        return true;
      }

      if (filter.cropId && seedInventoryItem.cropId !== filter.cropId) {
        return false;
      }

      if (filter.status && seedInventoryItem.status !== filter.status) {
        return false;
      }

      return true;
    })
    .map((seedInventoryItem) =>
      assertValid('seedInventoryItem', normalizeSeedInventoryItemCandidate(seedInventoryItem)),
    );
};

export const upsertSeedInventoryItemInAppState = (
  appState: unknown,
  seedInventoryItem: unknown,
): AppState => {
  const state = assertValid('appState', appState);
  const validSeedInventoryItem = assertValid(
    'seedInventoryItem',
    normalizeSeedInventoryItemCandidate(seedInventoryItem),
  );
  const existingIndex = state.seedInventoryItems.findIndex(
    (entry) => entry.seedInventoryItemId === validSeedInventoryItem.seedInventoryItemId,
  );

  const seedInventoryItems =
    existingIndex >= 0
      ? state.seedInventoryItems.map((entry, index) =>
          index === existingIndex ? validSeedInventoryItem : entry,
        )
      : [...state.seedInventoryItems, validSeedInventoryItem];

  return assertValid('appState', { ...state, seedInventoryItems });
};

export const removeSeedInventoryItemFromAppState = (
  appState: unknown,
  seedInventoryItemId: SeedInventoryItem['seedInventoryItemId'],
): AppState => {
  const state = assertValid('appState', appState);
  const seedInventoryItems = state.seedInventoryItems.filter(
    (seedInventoryItem) => seedInventoryItem.seedInventoryItemId !== seedInventoryItemId,
  );
  return assertValid('appState', { ...state, seedInventoryItems });
};
