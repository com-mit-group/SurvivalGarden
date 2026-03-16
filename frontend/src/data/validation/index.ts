import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject, ValidateFunction } from 'ajv';
import {
  appStateSchema,
  batchSchema,
  bedSchema,
  cropPlanSchema,
  cropSchema,
  pathSchema,
  seedInventoryItemSchema,
  segmentSchema,
  settingsSchema,
  taskSchema,
} from '../../contracts';
import type {
  AppState,
  Batch,
  Bed,
  Crop,
  CropPlan,
  Path,
  SeedInventoryItem,
  Segment,
  Settings,
  Task,
} from '../../contracts';

export type SchemaName =
  | 'appState'
  | 'batch'
  | 'bed'
  | 'crop'
  | 'cropPlan'
  | 'path'
  | 'seedInventoryItem'
  | 'segment'
  | 'settings'
  | 'task';

export type SchemaTypeMap = {
  appState: AppState;
  batch: Batch;
  bed: Bed;
  crop: Crop;
  cropPlan: CropPlan;
  path: Path;
  seedInventoryItem: SeedInventoryItem;
  segment: Segment;
  settings: Settings;
  task: Task;
};

export type ValidationIssue = {
  schemaName: SchemaName;
  path: string;
  message: string;
  keyword: string;
};

export type ValidationResult<T extends SchemaName> =
  | { ok: true; value: SchemaTypeMap[T] }
  | { ok: false; issues: ValidationIssue[] };

export class SchemaValidationError extends Error {
  readonly schemaName: SchemaName;
  readonly issues: ValidationIssue[];

  constructor(schemaName: SchemaName, issues: ValidationIssue[]) {
    super(`Validation failed for ${schemaName}`);
    this.name = 'SchemaValidationError';
    this.schemaName = schemaName;
    this.issues = issues;
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });

ajv.addSchema(appStateSchema);
ajv.addSchema(batchSchema);
ajv.addSchema(bedSchema);
ajv.addSchema(cropSchema);
ajv.addSchema(cropPlanSchema);
ajv.addSchema(pathSchema);
ajv.addSchema(taskSchema);
ajv.addSchema(seedInventoryItemSchema);
ajv.addSchema(segmentSchema);
ajv.addSchema(settingsSchema);


const EPSILON = 1e-9;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const collectSegmentGeometryIssues = (schemaName: SchemaName, payload: unknown): ValidationIssue[] => {
  const segments =
    schemaName === 'segment'
      ? [payload]
      : schemaName === 'appState' && isObjectRecord(payload) && Array.isArray(payload.segments)
        ? payload.segments
        : [];

  const issues: ValidationIssue[] = [];

  segments.forEach((segment, segmentIndex) => {
    if (!isObjectRecord(segment)) {
      return;
    }

    const segmentPath = schemaName === 'segment' ? '' : `/segments/${segmentIndex}`;
    const segmentWidth = toFiniteNumber(segment.width);
    const segmentHeight = toFiniteNumber(segment.height);

    const appendBoundsIssue = (
      itemType: 'beds' | 'paths',
      itemIndex: number,
      axis: 'x' | 'y',
      position: number,
      size: number,
      segmentSize: number,
      keyword: 'maximum' | 'minimum',
      message: string,
    ) => {
      issues.push({
        schemaName,
        path: `${segmentPath}/${itemType}/${itemIndex}/${axis}`,
        keyword,
        message: `${message} (got ${position} + ${size} > segment ${axis === 'x' ? 'width' : 'height'} ${segmentSize})`,
      });
    };

    const checkCollection = (collectionKey: 'beds' | 'paths') => {
      if (!Array.isArray(segment[collectionKey])) {
        return;
      }

      segment[collectionKey].forEach((item, itemIndex) => {
        if (!isObjectRecord(item)) {
          return;
        }

        const x = toFiniteNumber(item.x);
        const y = toFiniteNumber(item.y);
        const width = toFiniteNumber(item.width);
        const height = toFiniteNumber(item.height);

        if (x !== null && width !== null && segmentWidth !== null && x + width - segmentWidth > EPSILON) {
          appendBoundsIssue(
            collectionKey,
            itemIndex,
            'x',
            x,
            width,
            segmentWidth,
            'maximum',
            `${collectionKey === 'beds' ? 'bed' : 'path'} extends past segment east boundary`,
          );
        }

        if (y !== null && height !== null && segmentHeight !== null && y + height - segmentHeight > EPSILON) {
          appendBoundsIssue(
            collectionKey,
            itemIndex,
            'y',
            y,
            height,
            segmentHeight,
            'maximum',
            `${collectionKey === 'beds' ? 'bed' : 'path'} extends past segment south boundary`,
          );
        }
      });
    };

    checkCollection('beds');
    checkCollection('paths');
  });

  return issues;
};

const collectPathPlacementIssues = (schemaName: SchemaName, payload: unknown): ValidationIssue[] => {
  if (schemaName !== 'appState' || !isObjectRecord(payload)) {
    return [];
  }

  const segments = Array.isArray(payload.segments) ? payload.segments : [];
  const pathIds = new Set<string>();

  segments.forEach((segment) => {
    if (!isObjectRecord(segment) || !Array.isArray(segment.paths)) {
      return;
    }

    segment.paths.forEach((path) => {
      if (isObjectRecord(path) && typeof path.pathId === 'string' && path.pathId.length > 0) {
        pathIds.add(path.pathId);
      }
    });
  });

  if (pathIds.size === 0) {
    return [];
  }

  const issues: ValidationIssue[] = [];

  const addPlacementIssue = (path: string, pathId: string) => {
    issues.push({
      schemaName,
      path,
      keyword: 'invalidReference',
      message: `crop placement cannot target path entity '${pathId}'`,
    });
  };

  const cropPlans = Array.isArray(payload.cropPlans) ? payload.cropPlans : [];
  cropPlans.forEach((plan, planIndex) => {
    if (!isObjectRecord(plan) || typeof plan.bedId !== 'string') {
      return;
    }

    if (pathIds.has(plan.bedId)) {
      addPlacementIssue(`/cropPlans/${planIndex}/bedId`, plan.bedId);
    }
  });

  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  tasks.forEach((task, taskIndex) => {
    if (!isObjectRecord(task) || typeof task.bedId !== 'string') {
      return;
    }

    if (pathIds.has(task.bedId)) {
      addPlacementIssue(`/tasks/${taskIndex}/bedId`, task.bedId);
    }
  });

  const batches = Array.isArray(payload.batches) ? payload.batches : [];
  batches.forEach((batch, batchIndex) => {
    if (!isObjectRecord(batch)) {
      return;
    }

    const checkAssignments = (assignmentKey: 'assignments' | 'bedAssignments') => {
      if (!Array.isArray(batch[assignmentKey])) {
        return;
      }

      batch[assignmentKey].forEach((assignment, assignmentIndex) => {
        if (!isObjectRecord(assignment) || typeof assignment.bedId !== 'string') {
          return;
        }

        if (pathIds.has(assignment.bedId)) {
          addPlacementIssue(`/batches/${batchIndex}/${assignmentKey}/${assignmentIndex}/bedId`, assignment.bedId);
        }
      });
    };

    checkAssignments('assignments');
    checkAssignments('bedAssignments');
  });

  return issues;
};

const validators: { [K in SchemaName]: ValidateFunction<SchemaTypeMap[K]> } = {
  appState: ajv.compile<SchemaTypeMap['appState']>(appStateSchema),
  batch: ajv.compile<SchemaTypeMap['batch']>(batchSchema),
  bed: ajv.compile<SchemaTypeMap['bed']>(bedSchema),
  crop: ajv.compile<SchemaTypeMap['crop']>(cropSchema),
  cropPlan: ajv.compile<SchemaTypeMap['cropPlan']>(cropPlanSchema),
  path: ajv.compile<SchemaTypeMap['path']>(pathSchema),
  seedInventoryItem: ajv.compile<SchemaTypeMap['seedInventoryItem']>(seedInventoryItemSchema),
  segment: ajv.compile<SchemaTypeMap['segment']>(segmentSchema),
  settings: ajv.compile<SchemaTypeMap['settings']>(settingsSchema),
  task: ajv.compile<SchemaTypeMap['task']>(taskSchema),
};

const normalizeError = (schemaName: SchemaName, error: ErrorObject): ValidationIssue => ({
  schemaName,
  path: error.instancePath || '/',
  message: error.message || 'Invalid value',
  keyword: error.keyword,
});

export const assertValid = <T extends SchemaName>(
  schemaName: T,
  payload: unknown,
): SchemaTypeMap[T] => {
  const result = validateSchema(schemaName, payload);

  if (result.ok) {
    return result.value;
  }

  throw new SchemaValidationError(schemaName, result.issues);
};

export const validateSchema = <T extends SchemaName>(
  schemaName: T,
  payload: unknown,
): ValidationResult<T> => {
  const validator = validators[schemaName];

  if (validator(payload)) {
    const geometryIssues = collectSegmentGeometryIssues(schemaName, payload);
    const pathPlacementIssues = collectPathPlacementIssues(schemaName, payload);

    if (geometryIssues.length === 0 && pathPlacementIssues.length === 0) {
      return { ok: true, value: payload };
    }

    return { ok: false, issues: [...geometryIssues, ...pathPlacementIssues] };
  }

  const issues = (validator.errors || []).map((error) => normalizeError(schemaName, error));
  const geometryIssues = collectSegmentGeometryIssues(schemaName, payload);
  const pathPlacementIssues = collectPathPlacementIssues(schemaName, payload);
  return { ok: false, issues: [...issues, ...geometryIssues, ...pathPlacementIssues] };
};
