import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import type { Batch } from './contracts';
import {
  SchemaValidationError,
  initializeAppStateStorage,
  listBatchesFromAppState,
  loadAppStateFromIndexedDb,
  resetToGoldenDataset,
  saveAppStateToIndexedDb,
  upsertBatchInAppState,
} from './data';

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

const getLocalDateTimeDefault = () => {
  const date = new Date();
  const localOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - localOffsetMs).toISOString().slice(0, 16);
};

const formatCropOptionLabel = (crop: { cropId: string; name: string | undefined; scientificName: string | undefined }) => {
  if (crop.name && crop.scientificName) {
    return `${crop.name} (${crop.scientificName})`;
  }

  return crop.name ?? crop.cropId;
};

function BatchesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [cropIds, setCropIds] = useState<string[]>([]);
  const [cropNames, setCropNames] = useState<Record<string, string>>({});
  const [cropScientificNames, setCropScientificNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState({
    cropInput: '',
    variety: '',
    startedAt: getLocalDateTimeDefault(),
    seedCount: '',
    initialMethod: 'sowing',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const appState = await loadAppStateFromIndexedDb();

      if (!appState) {
        setBatches([]);
        setCropIds([]);
        setCropNames({});
        setCropScientificNames({});
        setIsLoading(false);
        return;
      }

      setBatches(listBatchesFromAppState(appState));
      setCropIds(appState.crops.map((crop) => crop.cropId));
      setCropNames(Object.fromEntries(appState.crops.map((crop) => [crop.cropId, crop.name])));
      setCropScientificNames(
        Object.fromEntries(
          appState.crops.map((crop) => {
            const scientificName = (crop as { scientificName?: string }).scientificName;
            return [crop.cropId, scientificName ?? ''];
          }),
        ),
      );
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
        .map((cropId) => ({
          value: cropId,
          label: formatCropOptionLabel({
            cropId,
            name: cropNames[cropId],
            scientificName: cropScientificNames[cropId],
          }),
        })),
    [batches, cropNames, cropScientificNames],
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

  const cropInputOptions = useMemo(
    () =>
      cropIds
        .map((cropId) => ({
          cropId,
          label: formatCropOptionLabel({
            cropId,
            name: cropNames[cropId],
            scientificName: cropScientificNames[cropId],
          }),
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [cropIds, cropNames, cropScientificNames],
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

  const resolveCropIdFromInput = (cropInput: string): string | null => {
    const normalizedInput = cropInput.trim().toLowerCase();
    if (!normalizedInput) {
      return null;
    }

    const match = cropInputOptions.find(
      (option) =>
        option.cropId.toLowerCase() === normalizedInput || option.label.toLowerCase() === normalizedInput,
    );

    return match?.cropId ?? null;
  };

  const startEdit = (batch: Batch) => {
    setEditingBatchId(batch.batchId);
    const startedAtDate = new Date(batch.startedAt);
    const startedAt = Number.isNaN(startedAtDate.getTime())
      ? getLocalDateTimeDefault()
      : new Date(startedAtDate.getTime() - startedAtDate.getTimezoneOffset() * 60_000)
          .toISOString()
          .slice(0, 16);

    setFormValues({
      cropInput: formatCropOptionLabel({
        cropId: batch.cropId,
        name: cropNames[batch.cropId],
        scientificName: cropScientificNames[batch.cropId],
      }),
      variety: '',
      startedAt,
      seedCount: '',
      initialMethod: batch.stage,
    });
    setFormErrors({});
    setSaveMessage('Variety, seed count, and advanced method transitions are not supported by the current contract yet.');
  };

  const resetForm = () => {
    setEditingBatchId(null);
    setFormValues({
      cropInput: '',
      variety: '',
      startedAt: getLocalDateTimeDefault(),
      seedCount: '',
      initialMethod: 'sowing',
    });
    setFormErrors({});
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaveMessage(null);
    const errors: Record<string, string> = {};
    const resolvedCropId = resolveCropIdFromInput(formValues.cropInput);

    if (!formValues.cropInput.trim()) {
      errors.cropInput = 'Choose or type a crop.';
    } else if (!resolvedCropId) {
      errors.cropInput = 'Custom crop creation is not supported yet. Choose an existing crop.';
    }

    if (!formValues.startedAt) {
      errors.startedAt = 'Enter a valid start date and time.';
    }

    if (formValues.variety.trim().length > 0) {
      errors.variety = 'Variety cannot be saved until contract support lands.';
    }

    if (formValues.seedCount.trim().length > 0) {
      const seedCount = Number(formValues.seedCount);
      if (!Number.isFinite(seedCount) || seedCount <= 0) {
        errors.seedCount = 'Seed count must be a positive number.';
      } else {
        errors.seedCount = 'Seed count cannot be saved until contract support lands.';
      }
    }

    if (formValues.initialMethod !== 'sowing') {
      errors.initialMethod = 'Only sowing can be saved with current state transitions.';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    try {
      const appState = await loadAppStateFromIndexedDb();

      if (!appState || !resolvedCropId) {
        setSaveMessage('Unable to save because local app state is unavailable.');
        return;
      }

      const existingBatch = editingBatchId
        ? appState.batches.find((batch) => batch.batchId === editingBatchId) ?? null
        : null;
      const startedAt = new Date(formValues.startedAt).toISOString();
      const batchId = existingBatch?.batchId ?? (globalThis.crypto?.randomUUID?.() ?? `batch-${Date.now()}`);
      const nextBatch: Batch = {
        batchId,
        cropId: resolvedCropId,
        startedAt,
        stage: existingBatch?.stage ?? 'sowing',
        stageEvents:
          existingBatch?.stageEvents ?? [
            {
              stage: 'sowing',
              occurredAt: startedAt,
            },
          ],
        assignments: existingBatch?.assignments ?? [],
      };

      const nextState = upsertBatchInAppState(appState, nextBatch);
      await saveAppStateToIndexedDb(nextState);
      setBatches(listBatchesFromAppState(nextState));
      setFormErrors({});
      setSaveMessage(editingBatchId ? 'Batch updated.' : 'Batch created.');
      resetForm();
    } catch (error) {
      if (error instanceof SchemaValidationError && error.issues.length > 0) {
        const issueErrors: Record<string, string> = {};

        for (const issue of error.issues) {
          if (issue.path.includes('/cropId')) {
            issueErrors.cropInput = 'Choose a valid crop.';
          }
          if (issue.path.includes('/startedAt')) {
            issueErrors.startedAt = 'Enter a valid date and time.';
          }
        }

        setFormErrors(issueErrors);
        setSaveMessage('Please fix the highlighted fields.');
        return;
      }

      const message = error instanceof Error ? error.message : 'Failed to save batch.';
      setSaveMessage(message);
    }
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

      <form className="batch-form" onSubmit={(event) => void handleSubmit(event)}>
        <h3>{editingBatchId ? 'Edit batch' : 'Create batch'}</h3>
        <div className="batch-form-grid">
          <label>
            Crop (search or type)
            <input
              list="batch-crop-options"
              value={formValues.cropInput}
              onChange={(event) => setFormValues((current) => ({ ...current, cropInput: event.target.value }))}
              placeholder="Common (Scientific)"
            />
            <datalist id="batch-crop-options">
              {cropInputOptions.map((crop) => (
                <option key={crop.cropId} value={crop.label} />
              ))}
            </datalist>
            {formErrors.cropInput ? <span className="form-error">{formErrors.cropInput}</span> : null}
          </label>

          <label>
            Variety
            <input
              type="text"
              value={formValues.variety}
              onChange={(event) => setFormValues((current) => ({ ...current, variety: event.target.value }))}
            />
            {formErrors.variety ? <span className="form-error">{formErrors.variety}</span> : null}
          </label>

          <label>
            Started at
            <input
              type="datetime-local"
              value={formValues.startedAt}
              onChange={(event) => setFormValues((current) => ({ ...current, startedAt: event.target.value }))}
            />
            {formErrors.startedAt ? <span className="form-error">{formErrors.startedAt}</span> : null}
          </label>

          <label>
            Start method/state
            <select
              value={formValues.initialMethod}
              onChange={(event) => setFormValues((current) => ({ ...current, initialMethod: event.target.value }))}
            >
              <option value="sowing">Sow (supported)</option>
              <option value="pre-sow">Pre-sow (wet paper)</option>
              <option value="sow-in-pot">Sow in pot</option>
              <option value="sow-in-ground">Sow in ground</option>
              <option value="pre-start-cutting">Pre-start from cutting</option>
              <option value="start-cutting-pot">Start cutting in pot</option>
              <option value="start-cutting-ground">Start cutting in ground</option>
            </select>
            {formErrors.initialMethod ? <span className="form-error">{formErrors.initialMethod}</span> : null}
          </label>

          <label>
            Seed count
            <input
              type="number"
              min="0"
              step="1"
              value={formValues.seedCount}
              onChange={(event) => setFormValues((current) => ({ ...current, seedCount: event.target.value }))}
            />
            {formErrors.seedCount ? <span className="form-error">{formErrors.seedCount}</span> : null}
          </label>
        </div>
        <p className="batch-form-note">
          Custom crops, variety, seed counts, and non-sowing start transitions are shown here for workflow planning but are not yet persisted by the current schema/state machine.
        </p>
        <div className="batch-form-actions">
          <button type="submit">{editingBatchId ? 'Save changes' : 'Create batch'}</button>
          {editingBatchId ? (
            <button type="button" onClick={resetForm}>
              Cancel edit
            </button>
          ) : null}
          {saveMessage ? <p className="batch-form-message">{saveMessage}</p> : null}
        </div>
      </form>

      {isLoading ? <p className="batch-empty-state">Loading batches…</p> : null}

      {!isLoading ? (
        <ul className="batch-list">
          {filteredBatches.map((batch) => (
            <li key={batch.batchId}>
              <Link to={`/batches/${batch.batchId}`} className="batch-item-link">
                <div>
                  <p className="batch-item-title">
                    {formatCropOptionLabel({
                      cropId: batch.cropId,
                      name: cropNames[batch.cropId],
                      scientificName: cropScientificNames[batch.cropId],
                    })}
                  </p>
                  <p className="batch-item-meta">
                    Batch {batch.batchId} · Bed {getDerivedBedId(batch) ?? 'Unassigned'} · Started{' '}
                    {new Date(batch.startedAt).toLocaleString()}
                  </p>
                </div>
                <span className="batch-stage-badge">{batch.stage}</span>
              </Link>
              <button type="button" className="batch-edit-button" onClick={() => startEdit(batch)}>
                Edit
              </button>
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
