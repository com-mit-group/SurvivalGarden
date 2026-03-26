import type {
  AppState,
  Batch,
  Bed,
  Crop,
  CropPlan,
  SeedInventoryItem,
  Settings,
  Task,
} from '../../generated/contracts';

export type Unsubscribe = () => void;

export interface ListQuery<TFilter extends Record<string, unknown> = Record<string, never>> {
  filter?: Partial<TFilter>;
}

export interface WatchableRepository<TValue> {
  watch(listener: (value: TValue) => void): Unsubscribe;
}

export interface CrudRepository<TEntity, TId> {
  getById(id: TId): Promise<TEntity | null>;
  upsert(entity: TEntity): Promise<TEntity>;
  remove(id: TId): Promise<void>;
}

export interface ListableRepository<TEntity, TFilter extends Record<string, unknown> = Record<string, never>> {
  list(query?: ListQuery<TFilter>): Promise<TEntity[]>;
}

export interface AppStateRepository extends WatchableRepository<AppState> {
  load(): Promise<AppState | null>;
  save(appState: AppState): Promise<void>;
}

export type BedRepository = CrudRepository<Bed, Bed['bedId']> &
  ListableRepository<Bed, Pick<Bed, 'gardenId'>>;

export type CropRepository = CrudRepository<Crop, Crop['cropId']> & ListableRepository<Crop>;

export type CropPlanRepository = CrudRepository<CropPlan, CropPlan['planId']> &
  ListableRepository<CropPlan, Pick<CropPlan, 'cropId' | 'seasonYear'>>;

export type BatchListFilter = {
  stage: Batch['stage'];
  cropId: Batch['cropId'];
  bedId: string;
  startedAtFrom: string;
  startedAtTo: string;
};

export type BatchRepository = CrudRepository<Batch, Batch['batchId']> &
  ListableRepository<Batch, BatchListFilter>;

export type TaskRepository = CrudRepository<Task, Task['id']> &
  ListableRepository<Task, Pick<Task, 'date' | 'status'>>;

export type SeedInventoryRepository =
  CrudRepository<SeedInventoryItem, SeedInventoryItem['seedInventoryItemId']> &
  ListableRepository<SeedInventoryItem, Pick<SeedInventoryItem, 'cropId' | 'status'>>;

export interface SettingsRepository {
  get(): Promise<Settings | null>;
  save(settings: Settings): Promise<Settings>;
}
