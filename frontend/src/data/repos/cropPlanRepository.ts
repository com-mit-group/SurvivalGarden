import type { AppState, CropPlan } from '../../contracts';
import { assertValid } from '../validation';

const normalizeCropPlanCandidate = (value: unknown): unknown => value ?? {};

export const getCropPlanFromAppState = (
  appState: unknown,
  planId: CropPlan['planId'],
): CropPlan | null => {
  const state = assertValid('appState', appState);
  const candidate = state.cropPlans.find((cropPlan) => cropPlan.planId === planId);

  if (!candidate) {
    return null;
  }

  return assertValid('cropPlan', normalizeCropPlanCandidate(candidate));
};

export const listCropPlansFromAppState = (appState: unknown): CropPlan[] => {
  const state = assertValid('appState', appState);
  return state.cropPlans.map((cropPlan) =>
    assertValid('cropPlan', normalizeCropPlanCandidate(cropPlan)),
  );
};

export const upsertCropPlanInAppState = (appState: unknown, cropPlan: unknown): AppState => {
  const state = assertValid('appState', appState);
  const validCropPlan = assertValid('cropPlan', normalizeCropPlanCandidate(cropPlan));
  const existingIndex = state.cropPlans.findIndex((entry) => entry.planId === validCropPlan.planId);

  const cropPlans =
    existingIndex >= 0
      ? state.cropPlans.map((entry, index) => (index === existingIndex ? validCropPlan : entry))
      : [...state.cropPlans, validCropPlan];

  return assertValid('appState', { ...state, cropPlans });
};

export const removeCropPlanFromAppState = (
  appState: unknown,
  planId: CropPlan['planId'],
): AppState => {
  const state = assertValid('appState', appState);
  const cropPlans = state.cropPlans.filter((cropPlan) => cropPlan.planId !== planId);
  return assertValid('appState', { ...state, cropPlans });
};
