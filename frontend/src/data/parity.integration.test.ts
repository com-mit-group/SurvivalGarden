import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';

type DataModule = typeof import('./index');

type ParityOperation =
  | { kind: 'upsertBed'; payload: unknown }
  | { kind: 'upsertCrop'; payload: unknown }
  | { kind: 'upsertSeedInventoryItem'; payload: unknown }
  | { kind: 'upsertCropPlan'; payload: unknown };

const PRODUCTION_DB_NAME = 'survival-garden';
const MAX_DIFFS = 8;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../..');
const parityTmpRoot = resolve(repoRoot, 'tmp/parity');
const hasDotnetRuntime = spawnSync('dotnet', ['--version'], { stdio: 'ignore' }).status === 0;

const installIndexedDbMockIfMissing = (): void => {
  if (typeof indexedDB !== 'undefined') {
    return;
  }

  type StoreRecord = {
    keyPath?: string;
    values: Map<IDBValidKey, unknown>;
  };
  type DatabaseRecord = {
    version: number;
    stores: Map<string, StoreRecord>;
  };
  const databases = new Map<string, DatabaseRecord>();

  const makeRequest = <T>(executor: () => T): IDBRequest<T> => {
    const request = {} as IDBRequest<T>;
    setTimeout(() => {
      try {
        request.result = executor();
        request.onsuccess?.(new Event('success'));
      } catch (error) {
        request.error = error as DOMException;
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
    }) as IDBObjectStore;

  const makeTransaction = (database: DatabaseRecord): IDBTransaction => {
    const transaction = {
      objectStore: (name: string) => {
        const store = database.stores.get(name);
        if (!store) {
          throw new Error(`Object store '${name}' not found.`);
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
      }) as IDBOpenDBRequest,
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

const summarizeDiffs = (left: unknown, right: unknown, maxDiffs: number): string[] => {
  const diffs: string[] = [];

  const visit = (leftValue: unknown, rightValue: unknown, path: string): void => {
    if (diffs.length >= maxDiffs) {
      return;
    }

    if (Object.is(leftValue, rightValue)) {
      return;
    }

    if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
      if (leftValue.length !== rightValue.length) {
        diffs.push(`${path} length mismatch (${leftValue.length} vs ${rightValue.length})`);
      }

      const maxLength = Math.max(leftValue.length, rightValue.length);
      for (let index = 0; index < maxLength; index += 1) {
        visit(leftValue[index], rightValue[index], `${path}[${index}]`);
        if (diffs.length >= maxDiffs) {
          return;
        }
      }
      return;
    }

    if (isPlainObject(leftValue) && isPlainObject(rightValue)) {
      const keys = [...new Set([...Object.keys(leftValue), ...Object.keys(rightValue)])].sort();
      for (const key of keys) {
        visit(leftValue[key], rightValue[key], path === '$' ? `$.${key}` : `${path}.${key}`);
        if (diffs.length >= maxDiffs) {
          return;
        }
      }
      return;
    }

    diffs.push(`${path} differs (${JSON.stringify(leftValue)} vs ${JSON.stringify(rightValue)})`);
  };

  visit(left, right, '$');
  return diffs;
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

const describeParity = hasDotnetRuntime ? describe.sequential : describe.skip;

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
    const normalizedBackendPath = backendFilePath.replaceAll('\\', '/');
    const normalizedTmp = normalizedTmpRoot.replaceAll('\\', '/');
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

  it('applies deterministic parity operations and compares canonical app-state JSON output', async () => {
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

    const diffSummary = summarizeDiffs(frontendState, backendState, MAX_DIFFS);
    expect(frontendState, `Parity mismatch summary:\n${diffSummary.join('\n')}`).toStrictEqual(backendState);
  }, 90_000);
});
