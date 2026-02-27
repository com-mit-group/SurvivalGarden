import type { Crop } from '../../contracts';
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
