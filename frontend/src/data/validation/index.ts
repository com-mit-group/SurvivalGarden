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

const collectCropPlanReferenceIssues = (schemaName: SchemaName, payload: unknown): ValidationIssue[] => {
  if (schemaName !== 'appState' || !isObjectRecord(payload)) {
    return [];
  }

  const segments = Array.isArray(payload.segments) ? payload.segments : [];
  const crops = Array.isArray(payload.crops) ? payload.crops : [];
  const cropPlans = Array.isArray(payload.cropPlans) ? payload.cropPlans : [];

  const cropIds = new Set<string>();
  crops.forEach((crop) => {
    if (isObjectRecord(crop) && typeof crop.cropId === 'string' && crop.cropId.length > 0) {
      cropIds.add(crop.cropId);
    }
  });

  const bedBySegment = new Map<string, Set<string>>();
  const bedDimensions = new Map<string, { width: number; height: number }>();

  segments.forEach((segment) => {
    if (!isObjectRecord(segment) || typeof segment.segmentId !== 'string' || !Array.isArray(segment.beds)) {
      return;
    }

    const segmentBeds = new Set<string>();
    segment.beds.forEach((bed) => {
      if (!isObjectRecord(bed) || typeof bed.bedId !== 'string') {
        return;
      }

      segmentBeds.add(bed.bedId);

      const width = toFiniteNumber(bed.width);
      const height = toFiniteNumber(bed.height);
      if (width !== null && height !== null) {
        bedDimensions.set(`${segment.segmentId}:${bed.bedId}`, { width, height });
      }
    });

    bedBySegment.set(segment.segmentId, segmentBeds);
  });

  const issues: ValidationIssue[] = [];

  cropPlans.forEach((plan, planIndex) => {
    if (!isObjectRecord(plan)) {
      return;
    }

    if (typeof plan.cropId === 'string' && plan.cropId.length > 0 && !cropIds.has(plan.cropId)) {
      issues.push({
        schemaName,
        path: `/cropPlans/${planIndex}/cropId`,
        keyword: 'invalidReference',
        message: `cropPlan references unknown cropId '${plan.cropId}'`,
      });
    }

    if (typeof plan.segmentId === 'string' && typeof plan.bedId === 'string') {
      const bedsInSegment = bedBySegment.get(plan.segmentId);
      if (!bedsInSegment) {
        issues.push({
          schemaName,
          path: `/cropPlans/${planIndex}/segmentId`,
          keyword: 'invalidReference',
          message: `cropPlan references unknown segmentId '${plan.segmentId}'`,
        });
      } else if (!bedsInSegment.has(plan.bedId)) {
        issues.push({
          schemaName,
          path: `/cropPlans/${planIndex}/bedId`,
          keyword: 'invalidReference',
          message: `cropPlan bedId '${plan.bedId}' does not belong to segmentId '${plan.segmentId}'`,
        });
      }

      if (Array.isArray(plan.placements)) {
        const bedSize = bedDimensions.get(`${plan.segmentId}:${plan.bedId}`);

        plan.placements.forEach((placement, placementIndex) => {
          if (!isObjectRecord(placement) || !Array.isArray(placement.points)) {
            return;
          }

          placement.points.forEach((point, pointIndex) => {
            if (!isObjectRecord(point)) {
              return;
            }

            const x = toFiniteNumber(point.x);
            const y = toFiniteNumber(point.y);

            if (x !== null && (x < -EPSILON || x > 1 + EPSILON)) {
              issues.push({
                schemaName,
                path: `/cropPlans/${planIndex}/placements/${placementIndex}/points/${pointIndex}/x`,
                keyword: 'maximum',
                message: `placement x must be within bed-local bounds [0, 1]`,
              });
            }

            if (y !== null && (y < -EPSILON || y > 1 + EPSILON)) {
              issues.push({
                schemaName,
                path: `/cropPlans/${planIndex}/placements/${placementIndex}/points/${pointIndex}/y`,
                keyword: 'maximum',
                message: `placement y must be within bed-local bounds [0, 1]`,
              });
            }

            if (bedSize && x !== null && y !== null) {
              const absoluteX = x * bedSize.width;
              const absoluteY = y * bedSize.height;
              if (absoluteX < -EPSILON || absoluteX - bedSize.width > EPSILON) {
                issues.push({
                  schemaName,
                  path: `/cropPlans/${planIndex}/placements/${placementIndex}/points/${pointIndex}/x`,
                  keyword: 'maximum',
                  message: `placement x resolves outside bed width ${bedSize.width}`,
                });
              }
              if (absoluteY < -EPSILON || absoluteY - bedSize.height > EPSILON) {
                issues.push({
                  schemaName,
                  path: `/cropPlans/${planIndex}/placements/${placementIndex}/points/${pointIndex}/y`,
                  keyword: 'maximum',
                  message: `placement y resolves outside bed height ${bedSize.height}`,
                });
              }
            }
          });
        });
      }
    }
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
    const cropPlanReferenceIssues = collectCropPlanReferenceIssues(schemaName, payload);

    if (geometryIssues.length === 0 && pathPlacementIssues.length === 0 && cropPlanReferenceIssues.length === 0) {
      return { ok: true, value: payload };
    }

    return { ok: false, issues: [...geometryIssues, ...pathPlacementIssues, ...cropPlanReferenceIssues] };
  }

  const issues = (validator.errors || []).map((error) => normalizeError(schemaName, error));
  const geometryIssues = collectSegmentGeometryIssues(schemaName, payload);
  const pathPlacementIssues = collectPathPlacementIssues(schemaName, payload);
  const cropPlanReferenceIssues = collectCropPlanReferenceIssues(schemaName, payload);
  return { ok: false, issues: [...issues, ...geometryIssues, ...pathPlacementIssues, ...cropPlanReferenceIssues] };
};
