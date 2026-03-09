/**
 * GENERATED FILE - DO NOT EDIT.
 * Regenerate with `pnpm --filter frontend gen:types`.
 */


export interface BatchStageEvent {
  stage: string;
  occurredAt: string;
  location?: string;
  method?: string;
  meta?: {
    [k: string]: unknown;
  };
}

export interface BatchBedAssignment {
  bedId: string;
  assignedAt: string;
  removedAt?: string;
  meta?: {
    [k: string]: unknown;
  };
}

export interface BatchPhotoMetadata {
  id: string;
  storageRef: string;
  capturedAt?: string;
  contentType?: string;
  filename?: string;
  caption?: string;
  meta?: {
    [k: string]: unknown;
  };
}

export type BatchPropagationType =
  | 'seed'
  | 'transplant'
  | 'cutting'
  | 'division'
  | 'tuber'
  | 'bulb'
  | 'runner'
  | 'graft'
  | 'other';

export interface BatchStartQuantity {
  count: number;
  unit: string;
}

export interface Batch {
  batchId: string;
  cropId: string;
  variety?: string;
  startedAt: string;
  propagationType: BatchPropagationType;
  startMethod?: string;
  startLocation?: string;
  startQuantity: BatchStartQuantity;
  seedCountPlanned?: number;
  seedCountGerminated?: number;
  plantCountAlive?: number;
  currentStage: string;
  stageEvents: BatchStageEvent[];
  bedAssignments: BatchBedAssignment[];
  notes?: string;
  photos: BatchPhotoMetadata[];
  meta?: {
    [k: string]: unknown;
  };
}

export interface Bed {
  bedId: string;
  gardenId: string;
  name: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CropWindowRange {
  startMonth: number;
  startWeek: number;
  endMonth: number;
  endWeek: number;
}

export interface CropRuleSection {
  sequence: number;
  windows: CropWindowRange[];
  notes?: string;
}

export type CropTaskType =
  | 'pre_sow'
  | 'pot_up'
  | 'harden_off'
  | 'transplant'
  | 'direct_sow'
  | 'harvest'
  | 'preserve';

export interface CropTaskRuleDateRangeWindow {
  startDate: string;
  endDate: string;
}

export interface CropTaskRuleMonthWeekWindow {
  month: number;
  weekIndex: number;
}

export type CropTaskRuleWindow = CropTaskRuleDateRangeWindow | CropTaskRuleMonthWeekWindow;

export interface CropTaskRuleSection {
  taskType: CropTaskType;
  sequence: number;
  windows: CropTaskRuleWindow[];
  notes?: string;
}

export interface CropNutritionItem {
  nutrient: string;
  value: number;
  unit: 'kcal' | 'g' | 'mg' | 'mcg' | 'IU';
  source: string;
  assumptions: string;
}

export interface Crop {
  cropId: string;
  name: string;
  scientificName?: string;
  taxonomy?: {
    family?: string;
    genus?: string;
    species?: string;
  };
  aliases?: string[];
  isUserDefined?: boolean;
  category?: string;
  companionsGood: string[];
  companionsAvoid: string[];
  rules: {
    sowing: CropRuleSection;
    transplant: CropRuleSection;
    harvest: CropRuleSection;
    storage: CropRuleSection;
  };
  taskRules?: CropTaskRuleSection[];
  nutritionProfile: CropNutritionItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CropPlanWindowRange {
  startMonth: number;
  startWeek: number;
  endMonth: number;
  endWeek: number;
}

export interface CropPlan {
  planId: string;
  cropId: string;
  bedId?: string;
  seasonYear: number;
  plannedWindows: {
    sowing: CropPlanWindowRange[];
    transplant?: CropPlanWindowRange[];
    harvest: CropPlanWindowRange[];
  };
  expectedYield: {
    amount: number;
    unit: 'g' | 'kg' | 'pieces';
  };
  notes?: string;
}

export interface SeedInventoryItem {
  seedInventoryItemId: string;
  cropId: string;
  variety: string;
  supplier?: string;
  lotNumber?: string;
  quantity: number;
  unit: 'seeds' | 'g' | 'packets';
  purchaseDate?: string;
  expiryDate?: string;
  status: 'available' | 'low' | 'depleted';
  storageLocation?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  settingsId: string;
  locale: string;
  timezone: 'Europe/Berlin';
  weekStartsOn?: 'monday';
  units: {
    temperature: 'celsius';
    yield: 'metric';
  };
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  sourceKey: string;
  date: string;
  type: string;
  cropId: string;
  bedId: string;
  batchId: string;
  checklist: Record<string, unknown>[];
  status: string;
}

export interface AppState {
  schemaVersion: number;
  beds: Bed[];
  crops: Crop[];
  cropPlans: CropPlan[];
  batches: Batch[];
  tasks: Task[];
  seedInventoryItems: SeedInventoryItem[];
  settings: Settings;
}
