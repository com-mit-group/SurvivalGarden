import appStateSchema from './app-state.schema.json';
import bedSchema from './bed.schema.json';
import cropPlanSchema from './crop-plan.schema.json';
import cropSchema from './crop.schema.json';
import seedInventoryItemSchema from './seed-inventory-item.schema.json';
import settingsSchema from './settings.schema.json';
import taskSchema from './task.schema.json';

export {
  appStateSchema,
  bedSchema,
  cropPlanSchema,
  cropSchema,
  seedInventoryItemSchema,
  settingsSchema,
  taskSchema,
};

// Generated contract types are read-only. Regenerate with `pnpm --filter frontend gen:types`.
export type * from '../generated/contracts';
