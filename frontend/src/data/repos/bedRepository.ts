import type { AppState, Bed } from '../../contracts';
import { assertValid } from '../validation';

const LEGACY_BED_TYPE = 'vegetable_bed';

const normalizeBedCandidate = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  return {
    ...candidate,
    type: typeof candidate.type === 'string' ? candidate.type : LEGACY_BED_TYPE,
  };
};

const listBedsFromSegments = (state: AppState): Bed[] =>
  (state.segments ?? []).flatMap((segment) =>
    segment.beds.map((bed) => {
      const normalizedBed: Bed & { x?: number; y?: number; width?: number; height?: number } = { ...bed };
      delete normalizedBed.x;
      delete normalizedBed.y;
      delete normalizedBed.width;
      delete normalizedBed.height;
      return normalizedBed;
    }),
  );

const resolveCanonicalSegments = (state: AppState) => state.segments ?? [];

export const getBedFromAppState = (appState: unknown, bedId: Bed['bedId']): Bed | null => {
  const state = assertValid('appState', appState);
  const beds = listBedsFromSegments(state);
  const candidate = beds.find((bed) => bed.bedId === bedId);

  if (!candidate) {
    return null;
  }

  return assertValid('bed', normalizeBedCandidate(candidate));
};

export const listBedsFromAppState = (appState: unknown): Bed[] => {
  const state = assertValid('appState', appState);
  const beds = listBedsFromSegments(state);
  return beds.map((bed) => assertValid('bed', normalizeBedCandidate(bed)));
};

export const upsertBedInAppState = (appState: unknown, bed: unknown): AppState => {
  const state = assertValid('appState', appState);
  const validBed = assertValid('bed', normalizeBedCandidate(bed));
  const targetSegmentId = validBed.segmentId ?? resolveCanonicalSegments(state)[0]?.segmentId;
  const segments = resolveCanonicalSegments(state).map((segment) => {
    const existingIndex = segment.beds.findIndex((entry) => entry.bedId === validBed.bedId);
    if (existingIndex < 0 && segment.segmentId !== targetSegmentId) {
      return segment;
    }

    if (existingIndex < 0 && segment.segmentId === targetSegmentId) {
      return { ...segment, beds: [...segment.beds, validBed] };
    }

    return {
      ...segment,
      beds:
        segment.segmentId === targetSegmentId
          ? segment.beds.map((entry, index) => (index === existingIndex ? validBed : entry))
          : segment.beds.filter((entry, index) => index !== existingIndex),
    };
  });
  return assertValid('appState', { ...state, segments });
};

export const removeBedFromAppState = (appState: unknown, bedId: Bed['bedId']): AppState => {
  const state = assertValid('appState', appState);
  const segments = resolveCanonicalSegments(state).map((segment) => ({
    ...segment,
    beds: segment.beds.filter((bed) => bed.bedId !== bedId),
  }));
  return assertValid('appState', { ...state, segments });
};
