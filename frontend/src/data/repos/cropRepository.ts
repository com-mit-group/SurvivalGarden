import type { AppState, Crop } from '../../contracts';
import { assertValid } from '../validation';

const normalizeCropCandidate = (value: unknown): unknown => value ?? {};

export const getCropFromAppState = (appState: unknown, cropId: Crop['cropId']): Crop | null => {
  const state = assertValid('appState', appState);
  const candidate = state.crops.find((crop) => crop.cropId === cropId);

  if (!candidate) {
    return null;
  }

  return assertValid('crop', normalizeCropCandidate(candidate));
};

export const listCropsFromAppState = (appState: unknown): Crop[] => {
  const state = assertValid('appState', appState);
  return state.crops.map((crop) => assertValid('crop', normalizeCropCandidate(crop)));
};

export const upsertCropInAppState = (appState: unknown, crop: unknown): AppState => {
  const state = assertValid('appState', appState);
  const validCrop = assertValid('crop', normalizeCropCandidate(crop));
  const existingIndex = state.crops.findIndex((entry) => entry.cropId === validCrop.cropId);

  const crops =
    existingIndex >= 0
      ? state.crops.map((entry, index) => (index === existingIndex ? validCrop : entry))
      : [...state.crops, validCrop];

  return assertValid('appState', { ...state, crops });
};

export const removeCropFromAppState = (appState: unknown, cropId: Crop['cropId']): AppState => {
  const state = assertValid('appState', appState);
  const crops = state.crops.filter((crop) => crop.cropId !== cropId);
  return assertValid('appState', { ...state, crops });
};
