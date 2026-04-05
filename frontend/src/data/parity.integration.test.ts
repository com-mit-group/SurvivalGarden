import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { summarizeParityDiffs } from './parityTestUtils';

type DataModule = typeof import('./index');

type ParityOperation =
  | { kind: 'upsertBed'; payload: unknown }
  | { kind: 'upsertCrop'; payload: unknown }
  | { kind: 'upsertSeedInventoryItem'; payload: unknown }
  | { kind: 'upsertCropPlan'; payload: unknown };
type BatchMutationOperation =
  | { kind: 'transitionBatchStage'; nextStage: string; occurredAt: string }
  | { kind: 'mutateBatchAssignment'; operation: 'assign' | 'move' | 'remove'; at: string; bedId?: string };

const PRODUCTION_DB_NAME = 'survival-garden';
const MAX_DIFFS = 20;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../..');
const parityTmpRoot = resolve(repoRoot, 'tmp/parity');
const hasDotnetRuntime = spawnSync('dotnet', ['--version'], { stdio: 'ignore' }).status === 0;
const shouldRunParityIntegration = hasDotnetRuntime && process.env.CI !== 'true';

const installIndexedDbMockIfMissing = (): void => {
  if (typeof indexedDB !== 'undefined') {
    return;
  }

  type StoreRecord = {
    keyPath?: string | undefined;
    values: Map<IDBValidKey, unknown>;
  };
  type DatabaseRecord = {
    version: number;
    stores: Map<string, StoreRecord>;
  };
  const databases = new Map<string, DatabaseRecord>();

  const makeRequest = <T>(executor: () => T): IDBRequest<T> => {
    const request = {} as IDBRequest<T>;
    const mutableRequest = request as unknown as { result: T; error: DOMException | null };
    setTimeout(() => {
      try {
        mutableRequest.result = executor();
        request.onsuccess?.(new Event('success'));
      } catch (error) {
        mutableRequest.error = error as DOMException;
        request.onerror?.(new Event('error'));
      }
    }, 0);
    return request;
  };

  const makeObjectStore = (store: StoreRecord): IDBObjectStore =>
    ({
      get: (key: IDBValidKey) => makeRequest(() => store.values.get(key) as never),
      put: (value: unknown, key?: IDBValidKey) =>
        makeRequest(() => {
          const resolvedKey =
            key ??
            (store.keyPath && typeof value === 'object' && value !== null
              ? ((value as Record<string, unknown>)[store.keyPath] as IDBValidKey)
              : undefined);
          if (resolvedKey === undefined) {
            throw new Error('Key is required for this store.');
          }
          store.values.set(resolvedKey, structuredClone(value));
          return resolvedKey as never;
        }),
      delete: (key: IDBValidKey) =>
        makeRequest(() => {
          store.values.delete(key);
          return undefined as never;
        }),
      clear: () =>
        makeRequest(() => {
          store.values.clear();
          return undefined as never;
        }),
      getAllKeys: () => makeRequest(() => [...store.values.keys()] as never),
    }) as unknown as IDBObjectStore;

  const makeTransaction = (database: DatabaseRecord): IDBTransaction => {
    const transaction = {
      objectStore: (name: string) => {
        const existingStore = database.stores.get(name);
        const store = existingStore ?? { values: new Map<IDBValidKey, unknown>() };
        if (!existingStore) {
          database.stores.set(name, store);
        }
        return makeObjectStore(store);
      },
    } as IDBTransaction;
    setTimeout(() => transaction.oncomplete?.(new Event('complete')), 0);
    return transaction;
  };

  const indexedDbApi: IDBFactory = {
    open: (name: string, version?: number) => {
      const request = {} as IDBOpenDBRequest;

      setTimeout(() => {
        const existing = databases.get(name);
        const nextVersion = version ?? existing?.version ?? 1;
        const needsUpgrade = !existing || nextVersion > existing.version;
        const dbRecord: DatabaseRecord = existing ?? { version: nextVersion, stores: new Map() };
        dbRecord.version = nextVersion;

        const database = {
          close: () => undefined,
          createObjectStore: (storeName: string, options?: IDBObjectStoreParameters) => {
            if (!dbRecord.stores.has(storeName)) {
              dbRecord.stores.set(storeName, { keyPath: options?.keyPath as string | undefined, values: new Map() });
            }
            return makeObjectStore(dbRecord.stores.get(storeName)!);
          },
          transaction: (stores: string | string[]) => {
            void stores;
            return makeTransaction(dbRecord);
          },
          objectStoreNames: {
            contains: (storeName: string) => dbRecord.stores.has(storeName),
          } as DOMStringList,
          version: nextVersion,
          onversionchange: null,
        } as unknown as IDBDatabase;

        (request as { result: IDBDatabase }).result = database;
        (request as { transaction: IDBTransaction }).transaction = makeTransaction(dbRecord);
        databases.set(name, dbRecord);

        if (needsUpgrade) {
          request.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent);
        }
        request.onsuccess?.(new Event('success'));
      }, 0);

      return request;
    },
    deleteDatabase: (name: string) =>
      makeRequest(() => {
        databases.delete(name);
        return undefined as never;
      }) as unknown as IDBOpenDBRequest,
    cmp: (first: IDBValidKey, second: IDBValidKey) => (first === second ? 0 : String(first) < String(second) ? -1 : 1),
  } as IDBFactory;

  vi.stubGlobal('indexedDB', indexedDbApi);
};

const request = async (url: string, init?: RequestInit): Promise<Response> => {
  const response = await fetch(url, init);
  return response;
};

const waitForHealthyBackend = async (baseUrl: string): Promise<void> => {
  const timeoutMs = 30_000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await request(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }

  throw new Error(`Backend did not become healthy within ${timeoutMs}ms at ${baseUrl}.`);
};

const deleteIndexedDb = async (dbName: string): Promise<void> => {
  await new Promise<void>((resolveDelete, rejectDelete) => {
    const deleteRequest = indexedDB.deleteDatabase(dbName);
    deleteRequest.onsuccess = () => resolveDelete();
    deleteRequest.onerror = () => rejectDelete(deleteRequest.error ?? new Error('IndexedDB delete failed.'));
    deleteRequest.onblocked = () => rejectDelete(new Error(`IndexedDB delete blocked for '${dbName}'.`));
  });
};

const canonicalizeState = (data: DataModule, appState: unknown): unknown =>
  JSON.parse(data.serializeAppStateForExport(appState));

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));


const toTaskKey = (task: Record<string, unknown>): string => {
  const sourceKey = task.sourceKey;
  if (typeof sourceKey === 'string' && sourceKey.length > 0) {
    return sourceKey;
  }

  const id = task.id;
  if (typeof id === 'string' && id.length > 0) {
    return id;
  }

  return '<missing-task-key>';
};

const collectTaskParityMismatches = (leftState: unknown, rightState: unknown): string[] => {
  if (!isPlainObject(leftState) || !isPlainObject(rightState)) {
    return ['$.<root>: app state payload is not an object on one or both sides.'];
  }
  if (!Array.isArray(leftState.tasks) || !Array.isArray(rightState.tasks)) {
    return ['$.tasks: tasks collection is missing on one or both states.'];
  }

  const fieldsToValidate = ['id', 'sourceKey', 'date', 'type', 'cropId', 'bedId', 'batchId', 'status', 'checklist'];
  const leftByKey = new Map<string, Record<string, unknown>>();
  const rightByKey = new Map<string, Record<string, unknown>>();
  const mismatches: string[] = [];

  for (const candidate of leftState.tasks) {
    if (!isPlainObject(candidate)) {
      mismatches.push('$.tasks: left task entry is not an object.');
      continue;
    }
    leftByKey.set(toTaskKey(candidate), candidate);
  }

  for (const candidate of rightState.tasks) {
    if (!isPlainObject(candidate)) {
      mismatches.push('$.tasks: right task entry is not an object.');
      continue;
    }
    rightByKey.set(toTaskKey(candidate), candidate);
  }

  const allKeys = [...new Set([...leftByKey.keys(), ...rightByKey.keys()])].sort();
  for (const taskKey of allKeys) {
    const leftTask = leftByKey.get(taskKey);
    const rightTask = rightByKey.get(taskKey);

    if (!leftTask) {
      mismatches.push(`tasks[${taskKey}]: missing in TS local output.`);
      continue;
    }
    if (!rightTask) {
      mismatches.push(`tasks[${taskKey}]: missing in backend output.`);
      continue;
    }

    for (const field of fieldsToValidate) {
      const leftValue = leftTask[field];
      const rightValue = rightTask[field];
      if (JSON.stringify(leftValue) !== JSON.stringify(rightValue)) {
        mismatches.push(
          `tasks[${taskKey}].${field}: ${JSON.stringify(leftValue)} !== ${JSON.stringify(rightValue)}`,
        );
      }
    }
  }

  return mismatches.sort();
};

const getBatchFromCanonicalState = (state: unknown, batchId: string): Record<string, unknown> => {
  if (!isPlainObject(state) || !Array.isArray(state.batches)) {
    throw new Error('Canonical state is missing batches collection.');
  }

  const batch = state.batches.find((candidate) => isPlainObject(candidate) && candidate.batchId === batchId);
  if (!isPlainObject(batch)) {
    throw new Error(`Batch '${batchId}' not found in canonical state.`);
  }

  return batch;
};

const runTsWorkflow = async (
  data: DataModule,
  seed: unknown,
  operations: ParityOperation[],
): Promise<unknown> => {
  await data.saveAppStateToIndexedDb(seed, { mode: 'replace' });

  for (const operation of operations) {
    switch (operation.kind) {
      case 'upsertBed':
        await data.upsertBed(operation.payload);
        break;
      case 'upsertCrop':
        await data.upsertCrop(operation.payload);
        break;
      case 'upsertSeedInventoryItem':
        await data.upsertSeedInventoryItem(operation.payload);
        break;
      case 'upsertCropPlan':
        await data.upsertCropPlan(operation.payload);
        break;
      default:
        throw new Error(`Unsupported TS operation '${(operation as { kind: string }).kind}'.`);
    }
  }

  const finalState = await data.loadAppStateFromIndexedDb();
  if (!finalState) {
    throw new Error('TS workflow produced no app state.');
  }

  return canonicalizeState(data, finalState);
};

const runBackendWorkflow = async (
  data: DataModule,
  backendBaseUrl: string,
  seed: unknown,
  operations: ParityOperation[],
): Promise<unknown> => {
  const seedResponse = await request(`${backendBaseUrl}/api/app-state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(seed),
  });

  if (!seedResponse.ok) {
    throw new Error(`Failed to seed backend app state: ${seedResponse.status} ${seedResponse.statusText}.`);
  }

  for (const operation of operations) {
    let response: Response;

    switch (operation.kind) {
      case 'upsertBed': {
        const payload = operation.payload as { bedId: string };
        response = await request(`${backendBaseUrl}/api/beds/${payload.bedId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(operation.payload),
        });
        break;
      }
      case 'upsertCrop': {
        const payload = operation.payload as { cropId: string };
        response = await request(`${backendBaseUrl}/api/crops/${payload.cropId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(operation.payload),
        });
        break;
      }
      case 'upsertSeedInventoryItem': {
        const payload = operation.payload as { seedInventoryItemId: string };
        response = await request(`${backendBaseUrl}/api/seedInventoryItems/${payload.seedInventoryItemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(operation.payload),
        });
        break;
      }
      case 'upsertCropPlan': {
        const payload = operation.payload as { planId: string };
        response = await request(`${backendBaseUrl}/api/cropPlans/${payload.planId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(operation.payload),
        });
        break;
      }
      default:
        throw new Error(`Unsupported backend operation '${(operation as { kind: string }).kind}'.`);
    }

    if (!response.ok) {
      throw new Error(`Backend operation '${operation.kind}' failed: ${response.status} ${response.statusText}.`);
    }
  }

  const stateResponse = await request(`${backendBaseUrl}/api/app-state`);
  if (!stateResponse.ok) {
    throw new Error(`Failed to load backend app state: ${stateResponse.status} ${stateResponse.statusText}.`);
  }

  return canonicalizeState(data, await stateResponse.json());
};

const applyTsBatchMutationSequence = async (
  data: DataModule,
  batchId: string,
  operations: BatchMutationOperation[],
): Promise<void> => {
  for (const operation of operations) {
    if (operation.kind === 'transitionBatchStage') {
      await data.transitionBatchStage(batchId, operation.nextStage, operation.occurredAt);
      continue;
    }

    const payload =
      operation.bedId === undefined
        ? { batchId, at: operation.at }
        : { batchId, bedId: operation.bedId, at: operation.at };
    await data.mutateBatchAssignment(operation.operation, payload);
  }
};

const applyBackendBatchMutationSequence = async (
  backendBaseUrl: string,
  batchId: string,
  operations: BatchMutationOperation[],
): Promise<void> => {
  for (const operation of operations) {
    const endpoint =
      operation.kind === 'transitionBatchStage'
        ? `${backendBaseUrl}/api/domain/batches/${batchId}/stage-events`
        : `${backendBaseUrl}/api/domain/batches/${batchId}/assignment`;
    const payload =
      operation.kind === 'transitionBatchStage'
        ? { stage: operation.nextStage, occurredAt: operation.occurredAt }
        : { operation: operation.operation, bedId: operation.bedId, at: operation.at };

    const response = await request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(
        `Backend batch mutation '${operation.kind}' failed: ${response.status} ${response.statusText}.`,
      );
    }
  }
};

const describeParity = shouldRunParityIntegration ? describe.sequential : describe.skip;

describeParity('parity integration (frontend IndexedDB vs backend persistence)', () => {
  let backendProcess: ChildProcessWithoutNullStreams | null = null;
  let tmpDir: string | null = null;
  let testDbName = '';
  let backendFilePath = '';
  let backendBaseUrl = '';

  beforeEach(async () => {
    installIndexedDbMockIfMissing();
    const testId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    testDbName = `survival-garden-parity-${testId}`;
    backendBaseUrl = `http://127.0.0.1:${4100 + Math.floor(Math.random() * 1000)}`;
    await mkdir(parityTmpRoot, { recursive: true });
    tmpDir = await mkdtemp(join(parityTmpRoot, `${testId}-`));
    backendFilePath = join(tmpDir, 'backend-appstate.json');

    (globalThis as Record<string, unknown>).__SURVIVAL_GARDEN_TEST_DB_NAME__ = testDbName;

    vi.resetModules();

    const data = (await import('./index')) as DataModule;

    if (data.getAppStateDbNameForTesting() === PRODUCTION_DB_NAME) {
      throw new Error('Safety guard failed: parity test attempted to use production IndexedDB name.');
    }

    const normalizedTmpRoot = `${parityTmpRoot}/`;
    const normalizedBackendPath = backendFilePath.split('\\').join('/');
    const normalizedTmp = normalizedTmpRoot.split('\\').join('/');
    if (!normalizedBackendPath.startsWith(normalizedTmp)) {
      throw new Error(`Safety guard failed: backend path '${backendFilePath}' is outside '${parityTmpRoot}'.`);
    }

    await deleteIndexedDb(testDbName);

    const backendProject = resolve(repoRoot, 'backend/SurvivalGarden.Api/SurvivalGarden.Api.csproj');
    backendProcess = spawn(
      'dotnet',
      ['run', '--project', backendProject, '--no-launch-profile'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          ASPNETCORE_URLS: backendBaseUrl,
          APP_STATE_FILE_PATH: backendFilePath,
        },
      },
    );

    backendProcess.stdout.on('data', () => {
      // Intentionally ignored to avoid noisy test output.
    });

    backendProcess.stderr.on('data', () => {
      // Intentionally ignored to avoid noisy test output.
    });

    await waitForHealthyBackend(backendBaseUrl);
  }, 60_000);

  afterEach(async () => {
    if (backendProcess && !backendProcess.killed) {
      backendProcess.kill('SIGTERM');
      await new Promise((resolveExit) => {
        backendProcess?.once('exit', () => resolveExit(undefined));
        setTimeout(() => resolveExit(undefined), 5_000);
      });
    }

    if (testDbName) {
      await deleteIndexedDb(testDbName);
    }

    delete (globalThis as Record<string, unknown>).__SURVIVAL_GARDEN_TEST_DB_NAME__;

    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('applies deterministic parity operations and compares canonical app-state JSON output', { timeout: 180_000 }, async () => {
    const data = (await import('./index')) as DataModule;
    const trierFixtureRaw = await readFile(resolve(repoRoot, 'fixtures/golden/trier-v1.json'), 'utf8');
    const paritySeedRaw = await readFile(resolve(repoRoot, 'fixtures/equivalence/parity-seed.v1.json'), 'utf8');
    const operationsRaw = await readFile(resolve(repoRoot, 'fixtures/equivalence/parity-ops.v1.json'), 'utf8');

    const trierSeed = JSON.parse(trierFixtureRaw);
    const paritySeed = JSON.parse(paritySeedRaw);
    const operations = JSON.parse(operationsRaw) as ParityOperation[];

    expect(canonicalizeState(data, trierSeed)).toStrictEqual(canonicalizeState(data, paritySeed));

    const frontendState = await runTsWorkflow(data, trierSeed, operations);
    const backendState = await runBackendWorkflow(data, backendBaseUrl, paritySeed, operations);

    const diffSummary = summarizeParityDiffs(frontendState as Record<string, unknown>, backendState as Record<string, unknown>, MAX_DIFFS);
    expect(frontendState, `Parity mismatch summary:\n${diffSummary.join('\n')}`).toStrictEqual(backendState);
  });

  it(
    'keeps TS and backend batch mutation flows in deterministic canonical parity',
    { timeout: 180_000 },
    async () => {
      const data = (await import('./index')) as DataModule;
      const paritySeedRaw = await readFile(resolve(repoRoot, 'fixtures/equivalence/parity-seed.v1.json'), 'utf8');
      const paritySeed = JSON.parse(paritySeedRaw) as Record<string, unknown>;

      const batchId = 'batch_parity_mutations_001';
      const bedAlphaId = 'bed_parity_alpha';
      const bedBetaId = 'bed_parity_beta';
      const cropId = 'crop_type_potato';
      const startedAt = '2026-02-01T08:00:00Z';

      const deterministicSeed = {
        ...paritySeed,
        beds: [
          {
            bedId: bedAlphaId,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            gardenId: 'garden_parity',
            name: 'Parity Bed Alpha',
            type: 'vegetable_bed',
            notes: 'Deterministic parity bed A.',
          },
          {
            bedId: bedBetaId,
            createdAt: '2026-01-02T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            gardenId: 'garden_parity',
            name: 'Parity Bed Beta',
            type: 'vegetable_bed',
            notes: 'Deterministic parity bed B.',
          },
        ],
        batches: [
          {
            batchId,
            cropId,
            variety: 'Deterministic Yukon Gold',
            startedAt,
            propagationType: 'seed',
            stage: 'sowing',
            currentStage: 'sowing',
            stageEvents: [
              {
                stage: 'sowing',
                occurredAt: startedAt,
              },
            ],
            bedAssignments: [],
            assignments: [],
            notes: 'Deterministic parity integration batch.',
          },
        ],
      };

      const operations: BatchMutationOperation[] = [
        { kind: 'transitionBatchStage', nextStage: 'transplant', occurredAt: '2026-02-10T08:00:00Z' },
        { kind: 'mutateBatchAssignment', operation: 'assign', bedId: bedAlphaId, at: '2026-02-11T08:00:00Z' },
        { kind: 'mutateBatchAssignment', operation: 'move', bedId: bedBetaId, at: '2026-02-20T08:00:00Z' },
        { kind: 'transitionBatchStage', nextStage: 'harvest', occurredAt: '2026-03-15T08:00:00Z' },
        { kind: 'mutateBatchAssignment', operation: 'remove', at: '2026-03-20T08:00:00Z' },
      ];

      await data.saveAppStateToIndexedDb(deterministicSeed, { mode: 'replace' });
      await applyTsBatchMutationSequence(data, batchId, operations);
      const persistedTsState = await data.loadAppStateFromIndexedDb();
      if (!persistedTsState) {
        throw new Error('TS workflow produced no app state after deterministic batch mutations.');
      }
      const frontendState = canonicalizeState(data, persistedTsState);

      const backendSeedResponse = await request(`${backendBaseUrl}/api/app-state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deterministicSeed),
      });
      if (!backendSeedResponse.ok) {
        throw new Error(`Failed to seed backend app state: ${backendSeedResponse.status} ${backendSeedResponse.statusText}.`);
      }
      await applyBackendBatchMutationSequence(backendBaseUrl, batchId, operations);
      const backendStateResponse = await request(`${backendBaseUrl}/api/app-state`);
      if (!backendStateResponse.ok) {
        throw new Error(
          `Failed to load backend app state: ${backendStateResponse.status} ${backendStateResponse.statusText}.`,
        );
      }
      const backendState = canonicalizeState(data, await backendStateResponse.json());
      const backendPersistedRaw = await readFile(backendFilePath, 'utf8');
      const backendPersistedState = canonicalizeState(data, JSON.parse(backendPersistedRaw));

      expect(backendPersistedState).toStrictEqual(backendState);

      const expectedStageEvents = [
        { stage: 'sowing', occurredAt: '2026-02-01T08:00:00Z' },
        { stage: 'transplant', occurredAt: '2026-02-10T08:00:00Z' },
        { stage: 'harvest', occurredAt: '2026-03-15T08:00:00Z' },
      ];
      const expectedAssignments = [
        {
          bedId: bedAlphaId,
          assignedAt: '2026-02-11T08:00:00Z',
          fromDate: '2026-02-11T08:00:00Z',
          toDate: '2026-02-20T08:00:00Z',
        },
        {
          bedId: bedBetaId,
          assignedAt: '2026-02-20T08:00:00Z',
          fromDate: '2026-02-20T08:00:00Z',
          toDate: '2026-03-20T08:00:00Z',
        },
      ];

      const frontendBatch = getBatchFromCanonicalState(frontendState, batchId);
      const backendBatch = getBatchFromCanonicalState(backendState, batchId);

      expect(frontendBatch.stageEvents).toStrictEqual(expectedStageEvents);
      expect(backendBatch.stageEvents).toStrictEqual(expectedStageEvents);
      expect(frontendBatch.bedAssignments).toStrictEqual(expectedAssignments);
      expect(backendBatch.bedAssignments).toStrictEqual(expectedAssignments);
      expect(frontendBatch.currentStage).toBe('harvest');
      expect(frontendBatch.stage).toBe('harvest');
      expect(backendBatch.currentStage).toBe('harvest');
      expect(backendBatch.stage).toBe('harvest');

      const diffSummary = summarizeParityDiffs(frontendState as Record<string, unknown>, backendState as Record<string, unknown>, MAX_DIFFS);
      expect(frontendState, `Parity mismatch summary:\n${diffSummary.join('\n')}`).toStrictEqual(backendState);
    },
  );

  it(
    'keeps calendar task derivation in parity across TS local and backend regenerateCalendarTasks paths',
    { timeout: 180_000 },
    async () => {
      const data = (await import('./index')) as DataModule;
      const paritySeedRaw = await readFile(resolve(repoRoot, 'fixtures/equivalence/parity-seed.v1.json'), 'utf8');
      const paritySeed = JSON.parse(paritySeedRaw) as Record<string, unknown>;
      const knownYear = 2026;
      const bedId = 'bed_parity_tasks_001';
      const cropId = 'crop_type_potato';
      const batchId = 'batch_parity_tasks_001';
      const startedAt = '2026-03-20T08:00:00Z';
      const transplantAt = '2026-04-14T08:00:00Z';

      const deterministicSeed = {
        ...paritySeed,
        tasks: [],
        beds: [
          {
            bedId,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            gardenId: 'garden_parity',
            name: 'Parity Task Bed',
            type: 'vegetable_bed',
            notes: 'Task parity integration bed.',
          },
        ],
        cropPlans: [
          {
            planId: 'plan_parity_tasks_001',
            cropId,
            bedId,
            seasonYear: knownYear,
            plannedWindows: {
              sowing: [{ startMonth: 3, startWeek: 2, endMonth: 4, endWeek: 4 }],
              harvest: [{ startMonth: 7, startWeek: 1, endMonth: 9, endWeek: 4 }],
            },
            expectedYield: { amount: 22, unit: 'kg' },
            notes: 'Deterministic parity plan for calendar generation.',
          },
        ],
        batches: [
          {
            batchId,
            cropId,
            variety: 'Deterministic Yukon Gold',
            startedAt,
            propagationType: 'seed',
            stage: 'transplant',
            currentStage: 'transplant',
            stageEvents: [
              { stage: 'sowing', occurredAt: startedAt },
              { stage: 'germinated', occurredAt: '2026-03-30T08:00:00Z' },
              { stage: 'transplant', occurredAt: transplantAt },
            ],
            bedAssignments: [{ bedId, assignedAt: transplantAt, fromDate: transplantAt }],
            assignments: [{ bedId, assignedAt: transplantAt, fromDate: transplantAt }],
            notes: 'Deterministic parity integration batch for task derivation.',
          },
        ],
      };

      const previousMode = process.env.VITE_FRONTEND_MODE;
      const previousTasksRouteFlag = process.env.VITE_ROUTE_TASKS_TO_BACKEND;
      const previousBackendBaseUrl = process.env.VITE_BACKEND_API_BASE_URL;

      try {
        process.env.VITE_FRONTEND_MODE = 'typescript';
        delete process.env.VITE_ROUTE_TASKS_TO_BACKEND;
        process.env.VITE_BACKEND_API_BASE_URL = backendBaseUrl;
        await data.saveAppStateToIndexedDb(deterministicSeed, { mode: 'replace' });
        await data.regenerateCalendarTasks(knownYear);
        const tsPersistedState = await data.loadAppStateFromIndexedDb();
        if (!tsPersistedState) {
          throw new Error('TS local regenerateCalendarTasks path produced no app state.');
        }
        const frontendState = canonicalizeState(data, tsPersistedState);

        const backendSeedResponse = await request(`${backendBaseUrl}/api/app-state`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(deterministicSeed),
        });
        if (!backendSeedResponse.ok) {
          throw new Error(`Failed to seed backend app state: ${backendSeedResponse.status} ${backendSeedResponse.statusText}.`);
        }

        process.env.VITE_FRONTEND_MODE = 'backend';
        process.env.VITE_ROUTE_TASKS_TO_BACKEND = 'true';
        process.env.VITE_BACKEND_API_BASE_URL = backendBaseUrl;
        await data.regenerateCalendarTasks(knownYear);
        const backendStateResponse = await request(`${backendBaseUrl}/api/app-state`);
        if (!backendStateResponse.ok) {
          throw new Error(
            `Failed to load backend app state: ${backendStateResponse.status} ${backendStateResponse.statusText}.`,
          );
        }
        const backendState = canonicalizeState(data, await backendStateResponse.json());
        const backendPersistedRaw = await readFile(backendFilePath, 'utf8');
        const backendPersistedState = canonicalizeState(data, JSON.parse(backendPersistedRaw));

        const tsPersistedPath = join(tmpDir!, 'ts-regenerated-appstate.canonical.json');
        const backendPersistedPath = join(tmpDir!, 'backend-regenerated-appstate.canonical.json');
        await writeFile(tsPersistedPath, JSON.stringify(frontendState, null, 2), 'utf8');
        await writeFile(backendPersistedPath, JSON.stringify(backendPersistedState, null, 2), 'utf8');

        expect(backendPersistedState).toStrictEqual(backendState);

        const taskMismatches = collectTaskParityMismatches(frontendState, backendState);
        expect(taskMismatches, `Task parity mismatches:\n${taskMismatches.join('\n')}`).toStrictEqual([]);

        const diffSummary = summarizeParityDiffs(frontendState as Record<string, unknown>, backendState as Record<string, unknown>, MAX_DIFFS);
        expect(frontendState, `AppState parity mismatch summary:\n${diffSummary.join('\n')}`).toStrictEqual(backendState);
      } finally {
        if (previousMode === undefined) {
          delete process.env.VITE_FRONTEND_MODE;
        } else {
          process.env.VITE_FRONTEND_MODE = previousMode;
        }

        if (previousTasksRouteFlag === undefined) {
          delete process.env.VITE_ROUTE_TASKS_TO_BACKEND;
        } else {
          process.env.VITE_ROUTE_TASKS_TO_BACKEND = previousTasksRouteFlag;
        }

        if (previousBackendBaseUrl === undefined) {
          delete process.env.VITE_BACKEND_API_BASE_URL;
        } else {
          process.env.VITE_BACKEND_API_BASE_URL = previousBackendBaseUrl;
        }
      }
    },
  );
});
