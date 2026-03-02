import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import type { Batch } from './contracts';
import { initializeAppStateStorage, listBatchesFromAppState, loadAppStateFromIndexedDb, resetToGoldenDataset } from './data';

function BedsPage() {
  return <p>Beds</p>;
}

function CalendarPage() {
  return <p>Calendar</p>;
}

const getDerivedBedId = (batch: Batch): string | null => {
  if (batch.assignments.length === 0) {
    return null;
  }

  const latestAssignment = batch.assignments.reduce((latest, assignment) =>
    assignment.assignedAt > latest.assignedAt ? assignment : latest,
  );

  return latestAssignment.bedId;
};

function BatchesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [cropNames, setCropNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const appState = await loadAppStateFromIndexedDb();

      if (!appState) {
        setBatches([]);
        setCropNames({});
        setIsLoading(false);
        return;
      }

      setBatches(listBatchesFromAppState(appState));
      setCropNames(Object.fromEntries(appState.crops.map((crop) => [crop.cropId, crop.name])));
      setIsLoading(false);
    };

    void load();
  }, []);

  const filters = {
    crop: searchParams.get('crop') ?? '',
    stage: searchParams.get('stage') ?? '',
    bed: searchParams.get('bed') ?? '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
  };

  const cropOptions = useMemo(
    () =>
      Array.from(new Set(batches.map((batch) => batch.cropId)))
        .sort((left, right) => (cropNames[left] ?? left).localeCompare(cropNames[right] ?? right))
        .map((cropId) => ({ value: cropId, label: cropNames[cropId] ?? cropId })),
    [batches, cropNames],
  );

  const stageOptions = useMemo(
    () => Array.from(new Set(batches.map((batch) => batch.stage))).sort(),
    [batches],
  );

  const bedOptions = useMemo(
    () =>
      Array.from(
        new Set(
          batches
            .map((batch) => getDerivedBedId(batch))
            .filter((bedId): bedId is string => Boolean(bedId)),
        ),
      ).sort(),
    [batches],
  );

  const filteredBatches = useMemo(
    () =>
      batches.filter((batch) => {
        const derivedBedId = getDerivedBedId(batch);
        const batchDate = batch.startedAt.slice(0, 10);

        if (filters.crop && batch.cropId !== filters.crop) {
          return false;
        }

        if (filters.stage && batch.stage !== filters.stage) {
          return false;
        }

        if (filters.bed && derivedBedId !== filters.bed) {
          return false;
        }

        if (filters.from && batchDate < filters.from) {
          return false;
        }

        if (filters.to && batchDate > filters.to) {
          return false;
        }

        return true;
      }),
    [batches, filters],
  );

  const updateFilter = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams);

    if (value) {
      next.set(name, value);
    } else {
      next.delete(name);
    }

    setSearchParams(next, { replace: true });
  };

  return (
    <section className="batches-page">
      <h2>Batches</h2>

      <div className="batch-filters">
        <label>
          Crop
          <select value={filters.crop} onChange={(event) => updateFilter('crop', event.target.value)}>
            <option value="">All</option>
            {cropOptions.map((crop) => (
              <option key={crop.value} value={crop.value}>
                {crop.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Stage
          <select value={filters.stage} onChange={(event) => updateFilter('stage', event.target.value)}>
            <option value="">All</option>
            {stageOptions.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </label>

        <label>
          Bed
          <select value={filters.bed} onChange={(event) => updateFilter('bed', event.target.value)}>
            <option value="">All</option>
            {bedOptions.map((bedId) => (
              <option key={bedId} value={bedId}>
                {bedId}
              </option>
            ))}
          </select>
        </label>

        <label>
          From
          <input type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} />
        </label>

        <label>
          To
          <input type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} />
        </label>
      </div>

      {isLoading ? <p className="batch-empty-state">Loading batches…</p> : null}

      {!isLoading ? (
        <ul className="batch-list">
          {filteredBatches.map((batch) => (
            <li key={batch.batchId}>
              <Link to={`/batches/${batch.batchId}`} className="batch-item-link">
                <div>
                  <p className="batch-item-title">{cropNames[batch.cropId] ?? batch.cropId}</p>
                  <p className="batch-item-meta">
                    Batch {batch.batchId} · Bed {getDerivedBedId(batch) ?? 'Unassigned'} · Started{' '}
                    {batch.startedAt.slice(0, 10)}
                  </p>
                </div>
                <span className="batch-stage-badge">{batch.stage}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {!isLoading && filteredBatches.length === 0 ? (
        <p className="batch-empty-state">No batches match these filters.</p>
      ) : null}
    </section>
  );
}

function BatchDetailPage() {
  const { batchId } = useParams();

  return <p>Batch detail: {batchId}</p>;
}

function NutritionPage() {
  return <p>Nutrition</p>;
}

type DataPageProps = {
  showDevResetButton: boolean;
  onResetToGoldenDataset: () => void;
};

function DataPage({ showDevResetButton, onResetToGoldenDataset }: DataPageProps) {
  return (
    <>
      <p>Data</p>
      {showDevResetButton ? (
        <button type="button" onClick={onResetToGoldenDataset}>
          Reset to golden dataset
        </button>
      ) : null}
    </>
  );
}

function App() {
  const [storageError, setStorageError] = useState<string | null>(null);
  const [isInitializingStorage, setIsInitializingStorage] = useState(true);
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const isDevResetEnabled =
    env?.VITE_ENABLE_DEV_RESET === 'true' || processEnv?.VITE_ENABLE_DEV_RESET === 'true';
  const isTestEnvironment = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);

  const initializeStorage = useCallback(async () => {
    setIsInitializingStorage(true);
    setStorageError(null);

    try {
      await initializeAppStateStorage();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to initialize local data storage.';
      setStorageError(message);
    } finally {
      setIsInitializingStorage(false);
    }
  }, []);

  useEffect(() => {
    void initializeStorage();
  }, [initializeStorage]);

  const handleReset = useCallback(async () => {
    setIsInitializingStorage(true);

    try {
      await resetToGoldenDataset();
      await initializeStorage();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to reset local data storage.';
      setStorageError(message);
      setIsInitializingStorage(false);
    }
  }, [initializeStorage]);

  if (isInitializingStorage && !isTestEnvironment) {
    return (
      <div className="storage-error-screen" role="status" aria-live="polite">
        <h1>Starting SurvivalGarden…</h1>
        <p>Preparing local data storage.</p>
      </div>
    );
  }

  if (storageError) {
    return (
      <div className="storage-error-screen" role="alert">
        <h1>Local storage unavailable</h1>
        <p>{storageError}</p>
        <p>Try again, or reset local data if migration is blocked or corrupted.</p>
        <div className="storage-error-actions">
          <button type="button" onClick={() => void initializeStorage()}>
            Retry
          </button>
          <button type="button" onClick={() => void handleReset()}>
            Reset to golden dataset
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>SurvivalGarden</h1>
      </header>

      <main className="app-content">
        <Routes>
          <Route path="/" element={<Navigate to="/beds" replace />} />
          <Route path="/beds" element={<BedsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/batches" element={<BatchesPage />} />
          <Route path="/batches/:batchId" element={<BatchDetailPage />} />
          <Route path="/nutrition" element={<NutritionPage />} />
          <Route
            path="/data"
            element={
              <DataPage
                showDevResetButton={isDevResetEnabled}
                onResetToGoldenDataset={() => {
                  void handleReset();
                }}
              />
            }
          />
          <Route path="*" element={<Navigate to="/beds" replace />} />
        </Routes>
      </main>

      <nav className="tab-nav" aria-label="Primary">
        <NavLink to="/beds">Beds</NavLink>
        <NavLink to="/calendar">Calendar</NavLink>
        <NavLink to="/batches">Batches</NavLink>
        <NavLink to="/nutrition">Nutrition</NavLink>
        <NavLink to="/data">Data</NavLink>
      </nav>
    </div>
  );
}

export default App;
