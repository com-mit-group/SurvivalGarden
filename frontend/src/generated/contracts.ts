/**
 * GENERATED FILE - DO NOT EDIT.
 * Regenerate with `pnpm --filter frontend gen:types`.
 */


export interface BatchStageEvent {
  stage: string;
  occurredAt: string;
}

export interface BatchAssignment {
  bedId: string;
  assignedAt: string;
}

export interface Batch {
  batchId: string;
  cropId: string;
  startedAt: string;
  stage: string;
  stageEvents: BatchStageEvent[];
  assignments: BatchAssignment[];
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
  category?: string;
  companionsGood: string[];
  companionsAvoid: string[];
  rules: {
    sowing: CropRuleSection;
    transplant: CropRuleSection;
    harvest: CropRuleSection;
    storage: CropRuleSection;
  };
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
