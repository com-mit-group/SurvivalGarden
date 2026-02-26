import type { AppState, Bed } from '../../contracts';
import { assertValid } from '../validation';

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
