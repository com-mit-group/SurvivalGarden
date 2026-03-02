export interface StageAssessmentPhotoMeta {
  readonly capturedAt?: string;
  readonly source?: string;
  readonly notes?: string;
  readonly tags?: readonly string[];
}

export interface StageAssessmentContext {
  readonly batchId: string;
  readonly currentStage: string;
  readonly cropId?: string;
  readonly bedId?: string;
}

export interface StageAssessmentSuggestion {
  readonly stage: string;
  readonly confidence?: number;
  readonly rationale?: string;
}

/**
 * Extension seam for future stage suggestion integrations.
 *
 * TODO: Wire an adapter implementation in the app layer when external stage
 * assessment is introduced.
 *
 * This contract is intentionally unused by default and does not alter existing
 * domain transitions, persistence, or batch schema.
 */
export interface StageAssessmentService {
  assessStage(
    photoMeta: StageAssessmentPhotoMeta,
    context: StageAssessmentContext,
  ): Promise<StageAssessmentSuggestion>;
}
