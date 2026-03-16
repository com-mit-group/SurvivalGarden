import appStateSchema from './app-state.schema.json';
import batchSchema from './batch.schema.json';
import bedSchema from './bed.schema.json';
import cropPlanSchema from './crop-plan.schema.json';
import cropSchema from './crop.schema.json';
import pathSchema from './path.schema.json';
import seedInventoryItemSchema from './seed-inventory-item.schema.json';
import segmentSchema from './segment.schema.json';
import settingsSchema from './settings.schema.json';
import taskSchema from './task.schema.json';

export {
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
};

// Generated contract types are read-only. Regenerate with `pnpm --filter frontend gen:types`.
export type * from '../generated/contracts';
