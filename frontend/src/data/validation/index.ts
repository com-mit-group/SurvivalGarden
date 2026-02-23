import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject, ValidateFunction } from 'ajv';
import {
  appStateSchema,
  bedSchema,
  cropPlanSchema,
  cropSchema,
  seedInventoryItemSchema,
  settingsSchema,
  taskSchema,
} from '../../contracts';
import type {
  AppState,
  Bed,
  Crop,
  CropPlan,
  SeedInventoryItem,
  Settings,
  Task,
} from '../../contracts';

export type SchemaName =
  | 'appState'
  | 'bed'
  | 'crop'
  | 'cropPlan'
  | 'seedInventoryItem'
  | 'settings'
  | 'task';

export type SchemaTypeMap = {
  appState: AppState;
  bed: Bed;
  crop: Crop;
  cropPlan: CropPlan;
  seedInventoryItem: SeedInventoryItem;
  settings: Settings;
  task: Task;
};

export type ValidationIssue = {
  schemaName: SchemaName;
  path: string;
  message: string;
  keyword: string;
};

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
ajv.addSchema(bedSchema);
ajv.addSchema(cropSchema);
ajv.addSchema(cropPlanSchema);
ajv.addSchema(taskSchema);
ajv.addSchema(seedInventoryItemSchema);
ajv.addSchema(settingsSchema);

const validators: { [K in SchemaName]: ValidateFunction<SchemaTypeMap[K]> } = {
  appState: ajv.compile<SchemaTypeMap['appState']>(appStateSchema),
  bed: ajv.compile<SchemaTypeMap['bed']>(bedSchema),
  crop: ajv.compile<SchemaTypeMap['crop']>(cropSchema),
  cropPlan: ajv.compile<SchemaTypeMap['cropPlan']>(cropPlanSchema),
  seedInventoryItem: ajv.compile<SchemaTypeMap['seedInventoryItem']>(seedInventoryItemSchema),
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
  const validator = validators[schemaName];

  if (validator(payload)) {
    return payload;
  }

  const issues = (validator.errors || []).map((error) => normalizeError(schemaName, error));
  throw new SchemaValidationError(schemaName, issues);
};
