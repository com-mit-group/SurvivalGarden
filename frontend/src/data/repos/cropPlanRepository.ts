import type { CropPlan } from '../../contracts';
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
