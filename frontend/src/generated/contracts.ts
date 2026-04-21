/**
 * GENERATED FILE - DO NOT EDIT.
 * Source: http://127.0.0.1:5178/openapi-v1.json
 * Contract version: 1.0.0
 * Persisted schemaVersion baseline: 2
 * Regenerate with `pnpm --filter frontend gen:types`.
 */


export type BatchConfidence = 'exact' | 'estimated' | 'unknown';

export interface BatchStageEvent {
  stage: string;
  occurredAt: string;
  location?: string;
  method?: string;
  meta?: {
    confidence?: BatchConfidence;
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
  cultivarId?: string;
  cropId: string;
  cropTypeId?: string;
  variety?: string;
  startedAt: string;
  propagationType?: BatchPropagationType;
  startMethod?: string;
  startLocation?: string;
  startQuantity?: BatchStartQuantity;
  seedCountPlanned?: number;
  seedCountGerminated?: number;
  plantCountAlive?: number;
  currentStage?: string;
  stage: string;
  stageEvents: BatchStageEvent[];
  bedAssignments?: BatchBedAssignment[];
  assignments: BatchBedAssignment[];
  notes?: string;
  photos?: BatchPhotoMetadata[] | unknown[] | undefined;
  meta?: {
    confidence?: BatchConfidence;
    [k: string]: unknown;
  };
}

export type BedType = 'ecology_strip' | 'vegetable_bed' | 'perennial_bed';

export interface Bed {
  bedId: string;
  segmentId?: string;
  gardenId: string;
  name: string;
  type: BedType;
  widthM?: number;
  lengthM?: number;
  x?: number;
  y?: number;
  rotationDeg?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Path {
  pathId: string;
  segmentId: string;
  name: string;
  x: number;
  y: number;
  widthM: number;
  lengthM: number;
  rotationDeg?: number;
  notes?: string;
  width?: number;
  height?: number;
  surface?: string;
}

export interface SegmentBed extends Bed {
  segmentId: string;
  x: number;
  y: number;
  widthM: number;
  lengthM: number;
  rotationDeg?: number;
  width?: number;
  height?: number;
}

export interface Segment {
  segmentId: string;
  name: string;
  kind?: string;
  notes?: string;
  widthM: number;
  lengthM: number;
  width?: number;
  height?: number;
  originReference?: string;
  beds: SegmentBed[];
  paths: Path[];
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

export interface Species {
  id: string;
  commonName?: string;
  scientificName?: string;
  aliases?: string[];
  notes?: string;
  taxonomy?: {
    family?: string;
    genus?: string;
    species?: string;
  };
}

export interface Crop {
  cropId: string;
  name: string;
  cultivar?: string;
  cultivarGroup?: string;
  speciesId: string;
  species?: {
    id?: string;
    commonName: string;
    scientificName: string;
    taxonomy?: {
      family?: string;
      genus?: string;
      species?: string;
    };
  };
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
  segmentId?: string;
  cropId: string;
  bedId: string;
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
  placements?: (
    | {
        type: 'points';
        points: {
          x: number;
          y: number;
        }[];
      }
    | {
        type: 'formula';
        formula:
          | {
              kind: 'grid';
              origin: { x: number; y: number };
              dx: number;
              dy: number;
              rows: number;
              cols: number;
            }
          | {
              kind: 'row';
              origin: { x: number; y: number };
              dx: number;
              count: number;
            }
          | {
              kind: 'staggered_grid';
              origin: { x: number; y: number };
              dx: number;
              dy: number;
              rows: number;
              cols: number;
              staggerX: number;
            }
          | {
              kind: 'line';
              start: { x: number; y: number };
              end: { x: number; y: number };
              count: number;
            }
          | {
              kind: 'repeated_offset';
              origin: { x: number; y: number };
              dx: number;
              dy: number;
              count: number;
            };
      }
  )[];
}

export interface SeedInventoryItem {
  seedInventoryItemId: string;
  cultivarId: string;
  cropId?: string;
  variety?: string;
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
  segments?: Segment[];
  beds: Bed[];
  species?: Species[];
  crops: Crop[];
  cropPlans: CropPlan[];
  batches: Batch[];
  tasks: Task[];
  seedInventoryItems: SeedInventoryItem[];
  settings: Settings;
}
