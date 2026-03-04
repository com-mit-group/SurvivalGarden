import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import type { Batch, Bed, Task } from './contracts';
import {
  generateOperationalTasks,
  SchemaValidationError,
  initializeAppStateStorage,
  listBedsFromAppState,
  listBatchesFromAppState,
  listTasksFromAppState,
  loadAppStateFromIndexedDb,
  loadPhotoBlobFromIndexedDb,
  resetToGoldenDataset,
  parseImportedAppState,
  saveAppStateToIndexedDb,
  savePhotoBlobToIndexedDb,
  serializeAppStateForExport,
  upsertGeneratedTasksInAppState,
  upsertTaskInAppState,
  upsertBatchInAppState,
  upsertBedInAppState,
  getActiveBedAssignment,
  assignBatchToBed,
  moveBatch,
  removeBatchFromBed,
} from './data';
import { applyStageEvent, canTransition } from './domain';

type BatchPhoto = {
  id: string;
  storageRef: string;
  capturedAt?: string;
  contentType?: string;
  filename?: string;
  caption?: string;
};

type BatchWithPhotos = Batch & { photos?: BatchPhoto[] };

function BedsPage() {
  const [beds, setBeds] = useState<Bed[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const appState = await loadAppStateFromIndexedDb();

      if (!appState) {
        setBeds([]);
        setBatches([]);
        setIsLoading(false);
        return;
      }

      setBeds([...listBedsFromAppState(appState)].sort((left, right) => left.bedId.localeCompare(right.bedId)));
      setBatches(listBatchesFromAppState(appState));
      setIsLoading(false);
    };

    void load();
  }, []);

  const activeBatchCountByBedId = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const batch of batches) {
      const bedId = getDerivedBedId(batch);
      if (!bedId) {
        continue;
      }

      counts[bedId] = (counts[bedId] ?? 0) + 1;
    }

    return counts;
  }, [batches]);

  return (
    <section className="beds-page">
      <h2>Beds</h2>
      {isLoading ? <p className="beds-empty-state">Loading beds…</p> : null}
      {!isLoading ? (
        <div className="beds-grid">
          {beds.map((bed) => (
            <Link key={bed.bedId} to={`/beds/${bed.bedId}`} className="bed-card-link">
              <article className="bed-card">
                <p className="bed-card-id">{bed.bedId}</p>
                <h3>{bed.name}</h3>
                <p className="bed-card-meta">Garden {bed.gardenId}</p>
                <p className="bed-card-meta">Active batches: {activeBatchCountByBedId[bed.bedId] ?? 0}</p>
              </article>
            </Link>
          ))}
        </div>
      ) : null}
      {!isLoading && beds.length === 0 ? <p className="beds-empty-state">No beds found.</p> : null}
    </section>
  );
}

function BedDetailPage() {
  const { bedId } = useParams();
  const [bed, setBed] = useState<Bed | null>(null);
  const [allBeds, setAllBeds] = useState<Bed[]>([]);
  const [notes, setNotes] = useState('');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [candidateBatches, setCandidateBatches] = useState<Batch[]>([]);
  const [cropNames, setCropNames] = useState<Record<string, string>>({});
  const [cropScientificNames, setCropScientificNames] = useState<Record<string, string>>({});
  const [assignBatchId, setAssignBatchId] = useState('');
  const [assignDate, setAssignDate] = useState(getLocalDateTimeDefault());
  const [assignMeta, setAssignMeta] = useState('');
  const [includeEndedFailed, setIncludeEndedFailed] = useState(false);
  const [isAssigningBatch, setIsAssigningBatch] = useState(false);
  const [assignBatchMessage, setAssignBatchMessage] = useState<string | null>(null);
  const [expandedActionBatchId, setExpandedActionBatchId] = useState<string | null>(null);
  const [moveTargetBedByBatchId, setMoveTargetBedByBatchId] = useState<Record<string, string>>({});
  const [moveDateByBatchId, setMoveDateByBatchId] = useState<Record<string, string>>({});
  const [moveMetaByBatchId, setMoveMetaByBatchId] = useState<Record<string, string>>({});
  const [moveMessageByBatchId, setMoveMessageByBatchId] = useState<Record<string, string>>({});
  const [removeDateByBatchId, setRemoveDateByBatchId] = useState<Record<string, string>>({});
  const [removeConfirmByBatchId, setRemoveConfirmByBatchId] = useState<Record<string, boolean>>({});
  const [removeMessageByBatchId, setRemoveMessageByBatchId] = useState<Record<string, string>>({});
  const [savingActionBatchId, setSavingActionBatchId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!bedId) {
        setBed(null);
        setAllBeds([]);
        setBatches([]);
        setCandidateBatches([]);
        setIsLoading(false);
        return;
      }

      const appState = await loadAppStateFromIndexedDb();
      if (!appState) {
        setBed(null);
        setAllBeds([]);
        setBatches([]);
        setCandidateBatches([]);
        setCropNames({});
        setCropScientificNames({});
        setIsLoading(false);
        return;
      }

      setCropNames(Object.fromEntries(appState.crops.map((crop) => [crop.cropId, crop.name])));
      setCropScientificNames(
        Object.fromEntries(
          appState.crops.map((crop) => {
            const scientificName = (crop as { scientificName?: string }).scientificName;
            return [crop.cropId, scientificName ?? ''];
          }),
        ),
      );

      const todayIso = new Date().toISOString();

      const nextBed = listBedsFromAppState(appState).find((candidate) => candidate.bedId === bedId) ?? null;
      const nextAllBeds = listBedsFromAppState(appState).sort((left, right) => left.bedId.localeCompare(right.bedId));
      const allBatches = listBatchesFromAppState(appState);
      const relatedBatches = allBatches
        .filter((batch) => getActiveBedAssignment(batch, todayIso)?.bedId === bedId)
        .sort((left, right) => left.batchId.localeCompare(right.batchId));
      const eligibleBatches = allBatches
        .filter((batch) => {
          if (!includeEndedFailed && (batch.stage === 'ended' || batch.stage === 'failed')) {
            return false;
          }

          return !getActiveBedAssignment(batch, todayIso);
        })
        .sort((left, right) => left.batchId.localeCompare(right.batchId));

      setBed(nextBed);
      setAllBeds(nextAllBeds);
      setNotes(nextBed?.notes ?? '');
      setBatches(relatedBatches);
      setCandidateBatches(eligibleBatches);
      setAssignBatchId((current) => (current && eligibleBatches.some((batch) => batch.batchId === current) ? current : eligibleBatches[0]?.batchId ?? ''));
      setIsLoading(false);
    };

    void load();
  }, [bedId, includeEndedFailed]);

  const refreshBedBatches = useCallback(
    (nextState: Awaited<ReturnType<typeof loadAppStateFromIndexedDb>>) => {
      if (!nextState || !bedId) {
        return;
      }

      const nowIso = new Date().toISOString();
      const nextAllBatches = listBatchesFromAppState(nextState);
      const nextBatches = nextAllBatches
        .filter((batch) => getActiveBedAssignment(batch, nowIso)?.bedId === bedId)
        .sort((left, right) => left.batchId.localeCompare(right.batchId));
      const nextCandidates = nextAllBatches
        .filter((batch) => {
          if (!includeEndedFailed && (batch.stage === 'ended' || batch.stage === 'failed')) {
            return false;
          }

          return !getActiveBedAssignment(batch, nowIso);
        })
        .sort((left, right) => left.batchId.localeCompare(right.batchId));

      setBatches(nextBatches);
      setCandidateBatches(nextCandidates);
      setAssignBatchId((current) => (current && nextCandidates.some((batch) => batch.batchId === current) ? current : nextCandidates[0]?.batchId ?? ''));
      setAllBeds(listBedsFromAppState(nextState).sort((left, right) => left.bedId.localeCompare(right.bedId)));
    },
    [bedId, includeEndedFailed],
  );

  const handleAssignBatch = async () => {
    if (!bedId || !assignBatchId) {
      setAssignBatchMessage('Select a batch to assign.');
      return;
    }

    if (!assignDate) {
      setAssignBatchMessage('Enter a valid assignment date and time.');
      return;
    }

    setIsAssigningBatch(true);

    try {
      const appState = await loadAppStateFromIndexedDb();
      if (!appState) {
        setAssignBatchMessage('Unable to save because local app state is unavailable.');
        return;
      }

      const existingBatch = appState.batches.find((candidate) => candidate.batchId === assignBatchId);
      if (!existingBatch) {
        setAssignBatchMessage('Selected batch was not found.');
        return;
      }

      const assignedAt = new Date(assignDate).toISOString();
      const updatedBatch = assignBatchToBed(existingBatch, bedId, assignedAt);
      const nextState = upsertBatchInAppState(appState, updatedBatch);
      await saveAppStateToIndexedDb(nextState);

      refreshBedBatches(nextState);
      setAssignDate(getLocalDateTimeDefault());
      setAssignMeta('');
      setAssignBatchMessage(assignMeta ? `Batch assigned to ${bedId}. Meta: ${assignMeta}` : `Batch assigned to ${bedId}.`);
    } catch (error) {
      if (error instanceof Error && error.message === 'batch_assignment_overlap') {
        setAssignBatchMessage('Unable to assign batch: it already has an overlapping bed assignment for that date.');
      } else {
        setAssignBatchMessage(error instanceof Error ? error.message : 'Failed to assign batch to bed.');
      }
    } finally {
      setIsAssigningBatch(false);
    }
  };

  const handleMoveBatchFromBed = async (batch: Batch) => {
    const moveDateInput = moveDateByBatchId[batch.batchId] ?? getLocalDateTimeDefault();
    const targetBedId = moveTargetBedByBatchId[batch.batchId] ?? '';

    if (!targetBedId) {
      setMoveMessageByBatchId((current) => ({ ...current, [batch.batchId]: 'Select a target bed.' }));
      return;
    }

    if (!moveDateInput) {
      setMoveMessageByBatchId((current) => ({ ...current, [batch.batchId]: 'Enter a valid move date and time.' }));
      return;
    }

    setSavingActionBatchId(batch.batchId);

    try {
      const appState = await loadAppStateFromIndexedDb();
      if (!appState) {
        setMoveMessageByBatchId((current) => ({ ...current, [batch.batchId]: 'Unable to save because local app state is unavailable.' }));
        return;
      }

      const existingBatch = appState.batches.find((candidate) => candidate.batchId === batch.batchId);
      if (!existingBatch) {
        setMoveMessageByBatchId((current) => ({ ...current, [batch.batchId]: 'Batch was not found.' }));
        return;
      }

      const moveDate = new Date(moveDateInput).toISOString();
      const movedBatch = moveBatch(existingBatch, targetBedId, moveDate);
      const nextState = upsertBatchInAppState(appState, movedBatch);
      await saveAppStateToIndexedDb(nextState);
      refreshBedBatches(nextState);
      setMoveDateByBatchId((current) => ({ ...current, [batch.batchId]: getLocalDateTimeDefault() }));
      setMoveMetaByBatchId((current) => ({ ...current, [batch.batchId]: '' }));
      setMoveMessageByBatchId((current) => ({
        ...current,
        [batch.batchId]: moveMetaByBatchId[batch.batchId]
          ? `Moved to ${targetBedId}. Meta: ${moveMetaByBatchId[batch.batchId]}`
          : `Moved to ${targetBedId}.`,
      }));
    } catch (error) {
      const nextMessage =
        error instanceof Error && error.message === 'batch_assignment_no_active'
          ? 'Move failed: batch has no active assignment at the selected date.'
          : error instanceof Error && error.message === 'batch_assignment_move_before_start'
            ? 'Move failed: move date is before the current assignment start.'
            : error instanceof Error
              ? error.message
              : 'Failed to move batch.';
      setMoveMessageByBatchId((current) => ({ ...current, [batch.batchId]: nextMessage }));
    } finally {
      setSavingActionBatchId(null);
    }
  };

  const handleRemoveBatchFromBed = async (batch: Batch) => {
    const isConfirmed = removeConfirmByBatchId[batch.batchId] ?? false;
    if (!isConfirmed) {
      setRemoveMessageByBatchId((current) => ({ ...current, [batch.batchId]: 'Check confirm before removing this batch from bed.' }));
      return;
    }

    const removeDateInput = removeDateByBatchId[batch.batchId] ?? getLocalDateTimeDefault();
    if (!removeDateInput) {
      setRemoveMessageByBatchId((current) => ({ ...current, [batch.batchId]: 'Enter a valid removal date and time.' }));
      return;
    }

    setSavingActionBatchId(batch.batchId);

    try {
      const appState = await loadAppStateFromIndexedDb();
      if (!appState) {
        setRemoveMessageByBatchId((current) => ({ ...current, [batch.batchId]: 'Unable to save because local app state is unavailable.' }));
        return;
      }

      const existingBatch = appState.batches.find((candidate) => candidate.batchId === batch.batchId);
      if (!existingBatch) {
        setRemoveMessageByBatchId((current) => ({ ...current, [batch.batchId]: 'Batch was not found.' }));
        return;
      }

      const endDate = new Date(removeDateInput).toISOString();
      const nextBatch = removeBatchFromBed(existingBatch, endDate);
      const nextState = upsertBatchInAppState(appState, nextBatch);
      await saveAppStateToIndexedDb(nextState);
      refreshBedBatches(nextState);
      setRemoveConfirmByBatchId((current) => ({ ...current, [batch.batchId]: false }));
      setRemoveDateByBatchId((current) => ({ ...current, [batch.batchId]: getLocalDateTimeDefault() }));
      setRemoveMessageByBatchId((current) => ({
        ...current,
        [batch.batchId]: nextBatch === existingBatch ? 'Batch is already unassigned for that date.' : 'Batch removed from bed.',
      }));
    } catch (error) {
      setRemoveMessageByBatchId((current) => ({
        ...current,
        [batch.batchId]: error instanceof Error ? error.message : 'Failed to remove batch from bed.',
      }));
    } finally {
      setSavingActionBatchId(null);
    }
  };

  useEffect(() => {
    if (!bed || !bedId) {
      return;
    }

    if ((bed.notes ?? '') === notes) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const persistNotes = async () => {
        const appState = await loadAppStateFromIndexedDb();
        if (!appState) {
          return;
        }

        const latestBed = listBedsFromAppState(appState).find((candidate) => candidate.bedId === bedId);
        if (!latestBed) {
          return;
        }

        const nextState = upsertBedInAppState(appState, {
          ...latestBed,
          notes,
          updatedAt: new Date().toISOString(),
        });

        await saveAppStateToIndexedDb(nextState);
        setBed((current) => (current && current.bedId === bedId ? { ...current, notes } : current));
      };

      void persistNotes();
    }, 600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [bed, bedId, notes]);

  if (isLoading) {
    return <p className="beds-empty-state">Loading bed…</p>;
  }

  if (!bed) {
    return (
      <section className="bed-detail-page">
        <h2>Bed not found</h2>
        <p className="beds-empty-state">No bed matches ID {bedId ?? 'unknown'}.</p>
        <Link to="/beds" className="bed-detail-back-link">
          ← Back to beds
        </Link>
      </section>
    );
  }

  return (
    <section className="bed-detail-page">
      <Link to="/beds" className="bed-detail-back-link">
        ← Back to beds
      </Link>
      <h2>{bed.name}</h2>
      <p className="bed-detail-meta">{bed.bedId} · Garden {bed.gardenId}</p>

      <article className="bed-detail-card">
        <h3>Details</h3>
        <p className="bed-detail-meta">Area: —</p>

        <label className="bed-detail-notes-label" htmlFor="bed-notes">
          Notes
        </label>
        <textarea
          id="bed-notes"
          className="bed-detail-notes-input"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Add bed notes..."
        />
      </article>

      <article className="bed-detail-card">
        <h3>Composition</h3>
        <p className="bed-detail-meta">Companions and succession notes will appear here.</p>
      </article>

      <article className="bed-detail-card">
        <h3>Active batches</h3>
        {batches.length === 0 ? (
          <p className="beds-empty-state">No active batches assigned to this bed.</p>
        ) : (
          <ul className="bed-detail-batch-list">
            {batches.map((batch) => (
              <li key={batch.batchId}>
                <div className="bed-detail-batch-head">
                  <Link to={`/batches/${batch.batchId}`}>
                    {formatCropOptionLabel({
                      cropId: batch.cropId,
                      name: cropNames[batch.cropId],
                      scientificName: cropScientificNames[batch.cropId],
                    }) || batch.cropId || batch.batchId}
                  </Link>
                  <span className="batch-stage-badge">{batch.stage}</span>
                  <button
                    type="button"
                    className="bed-detail-batch-action-toggle"
                    onClick={() => {
                      const nextExpandedId = expandedActionBatchId === batch.batchId ? null : batch.batchId;
                      setExpandedActionBatchId(nextExpandedId);
                      if (nextExpandedId !== batch.batchId) {
                        return;
                      }

                      const targetBeds = allBeds.filter((candidateBed) => candidateBed.bedId !== bedId);
                      setMoveTargetBedByBatchId((current) => ({ ...current, [batch.batchId]: current[batch.batchId] ?? targetBeds[0]?.bedId ?? '' }));
                      setMoveDateByBatchId((current) => ({ ...current, [batch.batchId]: current[batch.batchId] ?? getLocalDateTimeDefault() }));
                      setMoveMetaByBatchId((current) => ({ ...current, [batch.batchId]: current[batch.batchId] ?? '' }));
                      setRemoveDateByBatchId((current) => ({ ...current, [batch.batchId]: current[batch.batchId] ?? getLocalDateTimeDefault() }));
                    }}
                  >
                    {expandedActionBatchId === batch.batchId ? 'Hide actions' : 'Manage'}
                  </button>
                </div>
                {expandedActionBatchId === batch.batchId ? (
                  <div className="bed-detail-batch-action-panel">
                    <div className="batch-next-action-row">
                      <span className="batch-detail-pill">move</span>
                      <select
                        value={moveTargetBedByBatchId[batch.batchId] ?? ''}
                        onChange={(event) => setMoveTargetBedByBatchId((current) => ({ ...current, [batch.batchId]: event.target.value }))}
                        disabled={allBeds.filter((candidateBed) => candidateBed.bedId !== bedId).length === 0}
                      >
                        {allBeds.filter((candidateBed) => candidateBed.bedId !== bedId).length === 0 ? <option value="">No other beds</option> : null}
                        {allBeds
                          .filter((candidateBed) => candidateBed.bedId !== bedId)
                          .map((candidateBed) => (
                            <option key={candidateBed.bedId} value={candidateBed.bedId}>
                              {candidateBed.name} ({candidateBed.bedId})
                            </option>
                          ))}
                      </select>
                      <input
                        type="datetime-local"
                        value={moveDateByBatchId[batch.batchId] ?? ''}
                        onChange={(event) => setMoveDateByBatchId((current) => ({ ...current, [batch.batchId]: event.target.value }))}
                      />
                      <input
                        type="text"
                        value={moveMetaByBatchId[batch.batchId] ?? ''}
                        onChange={(event) => setMoveMetaByBatchId((current) => ({ ...current, [batch.batchId]: event.target.value }))}
                        placeholder="Position / meta (optional)"
                      />
                      <button
                        type="button"
                        onClick={() => void handleMoveBatchFromBed(batch)}
                        disabled={savingActionBatchId === batch.batchId || allBeds.filter((candidateBed) => candidateBed.bedId !== bedId).length === 0}
                      >
                        Move
                      </button>
                    </div>
                    {moveMessageByBatchId[batch.batchId] ? <p className="batch-stage-warning">{moveMessageByBatchId[batch.batchId]}</p> : null}
                    <div className="batch-next-action-row">
                      <span className="batch-detail-pill">remove</span>
                      <label className="bed-detail-meta">
                        <input
                          type="checkbox"
                          checked={removeConfirmByBatchId[batch.batchId] ?? false}
                          onChange={(event) => setRemoveConfirmByBatchId((current) => ({ ...current, [batch.batchId]: event.target.checked }))}
                        />{' '}
                        Confirm
                      </label>
                      <input
                        type="datetime-local"
                        value={removeDateByBatchId[batch.batchId] ?? ''}
                        onChange={(event) => setRemoveDateByBatchId((current) => ({ ...current, [batch.batchId]: event.target.value }))}
                      />
                      <button type="button" onClick={() => void handleRemoveBatchFromBed(batch)} disabled={savingActionBatchId === batch.batchId}>
                        Remove
                      </button>
                    </div>
                    {removeMessageByBatchId[batch.batchId] ? <p className="batch-stage-warning">{removeMessageByBatchId[batch.batchId]}</p> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className="batch-next-actions">
          <div className="batch-next-action-row">
            <span className="batch-detail-pill">assign</span>
            <select value={assignBatchId} onChange={(event) => setAssignBatchId(event.target.value)} disabled={candidateBatches.length === 0}>
              {candidateBatches.length === 0 ? <option value="">No eligible batches</option> : null}
              {candidateBatches.map((batch) => (
                <option key={batch.batchId} value={batch.batchId}>
                  {formatCropOptionLabel({
                    cropId: batch.cropId,
                    name: cropNames[batch.cropId],
                    scientificName: cropScientificNames[batch.cropId],
                  }) || batch.batchId}
                </option>
              ))}
            </select>
            <input type="datetime-local" value={assignDate} onChange={(event) => setAssignDate(event.target.value)} />
            <input
              type="text"
              value={assignMeta}
              onChange={(event) => setAssignMeta(event.target.value)}
              placeholder="Position / meta (optional)"
            />
            <button type="button" onClick={() => void handleAssignBatch()} disabled={!assignBatchId || isAssigningBatch || candidateBatches.length === 0}>
              Assign
            </button>
          </div>
          <label className="bed-detail-meta">
            <input
              type="checkbox"
              checked={includeEndedFailed}
              onChange={(event) => setIncludeEndedFailed(event.target.checked)}
            />{' '}
            Include ended/failed
          </label>
          {assignBatchMessage ? <p className="batch-stage-warning">{assignBatchMessage}</p> : null}
        </div>
      </article>
    </section>
  );
}

function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [bedNames, setBedNames] = useState<Record<string, string>>({});
  const [cropNames, setCropNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [isRegeneratingTasks, setIsRegeneratingTasks] = useState(false);
  const [regenerationSummary, setRegenerationSummary] = useState<{ added: number; updated: number; unchanged: number } | null>(null);
  const [regenerationError, setRegenerationError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const appState = await loadAppStateFromIndexedDb();

      if (!appState) {
        setTasks([]);
        setBedNames({});
        setCropNames({});
        setIsLoading(false);
        return;
      }

      setTasks(listTasksFromAppState(appState));
      setBedNames(Object.fromEntries(appState.beds.map((bed) => [bed.bedId, bed.name])));
      setCropNames(Object.fromEntries(appState.crops.map((crop) => [crop.cropId, crop.name])));
      setIsLoading(false);
    };

    void load();
  }, []);

  const filters = {
    days: searchParams.get('days') ?? '30',
    bed: searchParams.get('bed') ?? '',
    crop: searchParams.get('crop') ?? '',
    status: searchParams.get('status') ?? '',
    type: searchParams.get('type') ?? '',
    overdue: searchParams.get('overdue') === '1',
  };

  const updateFilter = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams);

    if (value) {
      next.set(name, value);
    } else {
      next.delete(name);
    }

    setSearchParams(next, { replace: true });
  };

  const localToday = useMemo(() => {
    const today = new Date();
    const localOffsetMs = today.getTimezoneOffset() * 60_000;
    return new Date(today.getTime() - localOffsetMs).toISOString().slice(0, 10);
  }, []);

  const rangeEnd = useMemo(() => {
    const startDate = new Date(`${localToday}T00:00:00`);
    startDate.setDate(startDate.getDate() + Number(filters.days));
    const localOffsetMs = startDate.getTimezoneOffset() * 60_000;
    return new Date(startDate.getTime() - localOffsetMs).toISOString().slice(0, 10);
  }, [filters.days, localToday]);

  const bedOptions = useMemo(
    () =>
      Array.from(new Set(tasks.map((task) => task.bedId).filter(Boolean)))
        .sort((left, right) => (bedNames[left] ?? left).localeCompare(bedNames[right] ?? right))
        .map((bedId) => ({ value: bedId, label: bedNames[bedId] ?? bedId })),
    [bedNames, tasks],
  );

  const cropOptions = useMemo(
    () =>
      Array.from(new Set(tasks.map((task) => task.cropId).filter(Boolean)))
        .sort((left, right) => (cropNames[left] ?? left).localeCompare(cropNames[right] ?? right))
        .map((cropId) => ({ value: cropId, label: cropNames[cropId] ?? cropId })),
    [cropNames, tasks],
  );

  const statusOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.status).filter(Boolean))).sort(),
    [tasks],
  );

  const typeOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.type).filter(Boolean))).sort(),
    [tasks],
  );

  const filteredTasks = useMemo(
    () =>
      tasks
        .filter((task) => {
          const inWindow = task.date >= localToday && task.date <= rangeEnd;
          const isOverdue = task.date < localToday;

          if (!inWindow && !(filters.overdue && isOverdue)) {
            return false;
          }

          if (filters.bed && task.bedId !== filters.bed) {
            return false;
          }

          if (filters.crop && task.cropId !== filters.crop) {
            return false;
          }

          if (filters.status && task.status !== filters.status) {
            return false;
          }

          if (filters.type && task.type !== filters.type) {
            return false;
          }

          return true;
        })
        .sort((left, right) => {
          if (left.date !== right.date) {
            return left.date.localeCompare(right.date);
          }

          return left.id.localeCompare(right.id);
        }),
    [filters.bed, filters.crop, filters.overdue, filters.status, filters.type, localToday, rangeEnd, tasks],
  );

  const handleToggleTaskStatus = async (task: Task) => {
    if (savingTaskId) {
      return;
    }

    setSavingTaskId(task.id);

    try {
      const appState = await loadAppStateFromIndexedDb();
      if (!appState) {
        return;
      }

      const doneStatuses = new Set(['done', 'completed']);
      const isDone = doneStatuses.has(task.status.toLowerCase());
      const updatedTask = { ...task, status: isDone ? 'pending' : 'done' };
      const nextState = upsertTaskInAppState(appState, updatedTask);
      await saveAppStateToIndexedDb(nextState);
      setTasks((current) => current.map((entry) => (entry.id === updatedTask.id ? updatedTask : entry)));
    } finally {
      setSavingTaskId(null);
    }
  };

  const handleRegenerateTasks = async () => {
    if (isRegeneratingTasks) {
      return;
    }

    setIsRegeneratingTasks(true);
    setRegenerationSummary(null);
    setRegenerationError(null);

    try {
      const appState = await loadAppStateFromIndexedDb();
      if (!appState) {
        setRegenerationError('Unable to regenerate tasks because local app state is unavailable.');
        return;
      }

      const tasksBeforeBySourceKey = new Map(listTasksFromAppState(appState).map((task) => [task.sourceKey, task]));
      const generatedTasks = generateOperationalTasks(appState);
      const nextState = upsertGeneratedTasksInAppState(appState, generatedTasks);
      const tasksAfter = listTasksFromAppState(nextState);
      const tasksAfterBySourceKey = new Map(tasksAfter.map((task) => [task.sourceKey, task]));

      let added = 0;
      let updated = 0;
      let unchanged = 0;
      const processedSourceKeys = new Set<string>();

      for (const generatedTask of generatedTasks) {
        if (processedSourceKeys.has(generatedTask.sourceKey)) {
          continue;
        }

        processedSourceKeys.add(generatedTask.sourceKey);
        const beforeTask = tasksBeforeBySourceKey.get(generatedTask.sourceKey);
        const afterTask = tasksAfterBySourceKey.get(generatedTask.sourceKey);

        if (!beforeTask && afterTask) {
          added += 1;
          continue;
        }

        if (!beforeTask || !afterTask) {
          continue;
        }

        if (JSON.stringify(beforeTask) === JSON.stringify(afterTask)) {
          unchanged += 1;
        } else {
          updated += 1;
        }
      }

      await saveAppStateToIndexedDb(nextState);
      setTasks(tasksAfter);
      setRegenerationSummary({ added, updated, unchanged });
    } catch (error) {
      if (error instanceof SchemaValidationError && error.issues.length > 0) {
        setRegenerationError(`${error.message}: ${error.issues.map((issue) => issue.path || issue.message).join('; ')}`);
      } else {
        setRegenerationError(error instanceof Error ? error.message : 'Failed to regenerate tasks.');
      }
    } finally {
      setIsRegeneratingTasks(false);
    }
  };

  return (
    <section className="calendar-page">
      <h2>Calendar</h2>
      <div className="calendar-range-toggle" role="group" aria-label="Date window">
        {[7, 30, 90].map((days) => (
          <button
            key={days}
            type="button"
            className={filters.days === String(days) ? 'active' : ''}
            onClick={() => updateFilter('days', String(days))}
          >
            {days} days
          </button>
        ))}
        <label>
          <input
            type="checkbox"
            checked={filters.overdue}
            onChange={(event) => updateFilter('overdue', event.target.checked ? '1' : '')}
          />{' '}
          Show past due
        </label>
        <button type="button" onClick={() => void handleRegenerateTasks()} disabled={isRegeneratingTasks}>
          {isRegeneratingTasks ? 'Regenerating…' : 'Regenerate tasks'}
        </button>
      </div>

      {regenerationSummary ? (
        <p className="batch-stage-warning">
          Regenerated tasks — Added: {regenerationSummary.added}, Updated: {regenerationSummary.updated}, Unchanged:{' '}
          {regenerationSummary.unchanged}
        </p>
      ) : null}
      {regenerationError ? <p className="batch-stage-warning">Regeneration failed: {regenerationError}</p> : null}

      <div className="calendar-filters">
        <label>
          Bed
          <select value={filters.bed} onChange={(event) => updateFilter('bed', event.target.value)}>
            <option value="">All beds</option>
            {bedOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Crop
          <select value={filters.crop} onChange={(event) => updateFilter('crop', event.target.value)}>
            <option value="">All crops</option>
            {cropOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">All statuses</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Task type
          <select value={filters.type} onChange={(event) => updateFilter('type', event.target.value)}>
            <option value="">All types</option>
            {typeOptions.map((taskType) => (
              <option key={taskType} value={taskType}>
                {taskType}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLoading ? <p className="batch-empty-state">Loading tasks…</p> : null}

      {!isLoading ? (
        <ul className="task-list">
          {filteredTasks.map((task) => {
            const isDone = ['done', 'completed'].includes(task.status.toLowerCase());
            const isOverdue = task.date < localToday && !isDone;

            return (
              <li key={task.id} className={`task-row${isOverdue ? ' is-overdue' : ''}`}>
                <div className="task-row-main">
                  <p className="task-row-date">{task.date}</p>
                  <div className="task-row-badges">
                    <span className="task-type-badge">{task.type.replace(/[-_]/g, ' ')}</span>
                    <span className={`task-status-badge${isDone ? ' is-done' : ''}`}>{task.status}</span>
                  </div>
                  <p className="task-row-meta">
                    Bed: {(bedNames[task.bedId] ?? task.bedId) || '—'} · Crop: {(cropNames[task.cropId] ?? task.cropId) || '—'}
                  </p>
                  {task.batchId ? (
                    <p className="task-row-meta">
                      Batch: <Link to={`/batches/${task.batchId}`}>{task.batchId}</Link>
                    </p>
                  ) : null}
                </div>
                <button type="button" onClick={() => void handleToggleTaskStatus(task)} disabled={savingTaskId === task.id}>
                  {isDone ? 'Mark undone' : 'Mark done'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!isLoading && filteredTasks.length === 0 ? <p className="batch-empty-state">No tasks in this range.</p> : null}
    </section>
  );
}

const getDerivedBedId = (batch: Batch): string | null => getActiveBedAssignment(batch, new Date().toISOString())?.bedId ?? null;

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
  const [isLoading, setIsLoading] = useState(true);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [cropName, setCropName] = useState<string | null>(null);
  const [actionDates, setActionDates] = useState<Record<string, string>>({});
  const [stageActionMessage, setStageActionMessage] = useState<string | null>(null);
  const [removeFromBedDate, setRemoveFromBedDate] = useState(getLocalDateTimeDefault());
  const [removeFromBedMessage, setRemoveFromBedMessage] = useState<string | null>(null);
  const [isSavingRemoveFromBed, setIsSavingRemoveFromBed] = useState(false);
  const [isSavingStageAction, setIsSavingStageAction] = useState(false);
  const [photoActionMessage, setPhotoActionMessage] = useState<string | null>(null);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [expandedPhotoIds, setExpandedPhotoIds] = useState<Record<string, boolean>>({});
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      if (!batchId) {
        setBatch(null);
        setCropName(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const appState = await loadAppStateFromIndexedDb();

      if (!appState) {
        setBatch(null);
        setCropName(null);
        setIsLoading(false);
        return;
      }

      const nextBatch = appState.batches.find((candidate) => candidate.batchId === batchId) ?? null;
      setBatch(nextBatch);

      if (!nextBatch) {
        setCropName(null);
        setIsLoading(false);
        return;
      }

      const crop = appState.crops.find((candidate) => candidate.cropId === nextBatch.cropId);
      setCropName(crop?.name ?? null);
      const dateDefault = getLocalDateTimeDefault();
      setActionDates({
        transplant: dateDefault,
        harvest: dateDefault,
        failed: dateDefault,
        ended: dateDefault,
      });
      setStageActionMessage(null);
      setRemoveFromBedDate(dateDefault);
      setRemoveFromBedMessage(null);
      setPhotoActionMessage(null);
      setExpandedPhotoIds({});
      setIsLoading(false);
    };

    void load();
  }, [batchId]);

  const orderedStageEvents = useMemo(() => {
    if (!batch) {
      return [];
    }

    return batch.stageEvents
      .map((event, index) => ({ event, index }))
      .sort((left, right) => {
        const timestampCompare = left.event.occurredAt.localeCompare(right.event.occurredAt);
        if (timestampCompare !== 0) {
          return timestampCompare;
        }

        return left.index - right.index;
      })
      .map(({ event }) => event);
  }, [batch]);

  const assignmentHistory = useMemo(() => {
    if (!batch) {
      return [];
    }

    return [...batch.assignments].sort((left, right) => left.assignedAt.localeCompare(right.assignedAt));
  }, [batch]);

  const nextStageActions = useMemo(() => {
    if (!batch) {
      return [];
    }

    return ['transplant', 'harvest', 'failed', 'ended'].filter((stage) => canTransition(batch.stage, stage));
  }, [batch]);

  const orderedPhotos = useMemo(() => {
    if (!batch) {
      return [];
    }

    const photos = ((batch as BatchWithPhotos).photos ?? []).map((photo, index) => ({ photo, index }));
    return photos
      .sort((left, right) => {
        const leftTime = left.photo.capturedAt ? Date.parse(left.photo.capturedAt) : NaN;
        const rightTime = right.photo.capturedAt ? Date.parse(right.photo.capturedAt) : NaN;
        const leftValid = Number.isFinite(leftTime);
        const rightValid = Number.isFinite(rightTime);

        if (leftValid && rightValid && leftTime !== rightTime) {
          return leftTime - rightTime;
        }

        if (leftValid !== rightValid) {
          return leftValid ? -1 : 1;
        }

        return left.index - right.index;
      })
      .map(({ photo }) => photo);
  }, [batch]);

  const latestStageEventAt = useMemo(() => {
    if (!batch || batch.stageEvents.length === 0) {
      return null;
    }

    return batch.stageEvents.reduce(
      (latest, event) => (event.occurredAt > latest ? event.occurredAt : latest),
      batch.stageEvents[0]!.occurredAt,
    );
  }, [batch]);

  const handleStageAction = async (nextStage: string) => {
    if (!batch || !batchId) {
      return;
    }

    const inputValue = actionDates[nextStage] ?? getLocalDateTimeDefault();
    if (!inputValue) {
      setStageActionMessage('Enter a valid date and time before applying a stage action.');
      return;
    }

    const occurredAt = new Date(inputValue).toISOString();
    const transition = applyStageEvent(batch, { stage: nextStage, occurredAt });
    if (!transition.ok) {
      setStageActionMessage(`Unable to apply stage event: ${transition.reason}.`);
      return;
    }

    setIsSavingStageAction(true);

    try {
      const appState = await loadAppStateFromIndexedDb();
      if (!appState) {
        setStageActionMessage('Unable to save because local app state is unavailable.');
        return;
      }

      const nextState = upsertBatchInAppState(appState, transition.batch);
      await saveAppStateToIndexedDb(nextState);
      const refreshedBatch = nextState.batches.find((candidate) => candidate.batchId === batchId) ?? null;
      setBatch(refreshedBatch);
      const dateDefault = getLocalDateTimeDefault();
      setActionDates({
        transplant: dateDefault,
        harvest: dateDefault,
        failed: dateDefault,
        ended: dateDefault,
      });

      if (latestStageEventAt && occurredAt < latestStageEventAt) {
        setStageActionMessage('Warning: this stage event is earlier than newer timeline events and was saved retroactively.');
      } else {
        setStageActionMessage(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save stage action.';
      setStageActionMessage(message);
    } finally {
      setIsSavingStageAction(false);
    }
  };


  const handleRemoveFromBed = async () => {
    if (!batch || !batchId) {
      return;
    }

    if (!removeFromBedDate) {
      setRemoveFromBedMessage('Enter a valid date and time before removing from bed.');
      return;
    }

    const endDate = new Date(removeFromBedDate).toISOString();
    const nextBatch = removeBatchFromBed(batch, endDate);

    setIsSavingRemoveFromBed(true);

    try {
      const appState = await loadAppStateFromIndexedDb();
      if (!appState) {
        setRemoveFromBedMessage('Unable to save because local app state is unavailable.');
        return;
      }

      const nextState = upsertBatchInAppState(appState, nextBatch);
      await saveAppStateToIndexedDb(nextState);
      const refreshedBatch = nextState.batches.find((candidate) => candidate.batchId === batchId) ?? null;
      setBatch(refreshedBatch);
      setRemoveFromBedMessage(nextBatch === batch ? 'Batch is already unassigned for that date.' : 'Batch removed from bed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove batch from bed.';
      setRemoveFromBedMessage(message);
    } finally {
      setIsSavingRemoveFromBed(false);
    }
  };

  const saveBatchPhotos = async (nextPhotos: BatchPhoto[]) => {
    if (!batchId || !batch) {
      return;
    }

    const appState = await loadAppStateFromIndexedDb();
    if (!appState) {
      setPhotoActionMessage('Unable to save because local app state is unavailable.');
      return;
    }

    const nextBatch: BatchWithPhotos = { ...(batch as BatchWithPhotos), photos: nextPhotos };
    const nextState = upsertBatchInAppState(appState, nextBatch as Batch);
    await saveAppStateToIndexedDb(nextState);
    const refreshedBatch = nextState.batches.find((candidate) => candidate.batchId === batchId) ?? null;
    setBatch(refreshedBatch);
  };

  const handlePhotoUpload = async (event: FormEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];

    if (!file || !batch) {
      return;
    }

    const fileNameLower = file.name.toLowerCase();
    const mimeLower = file.type.toLowerCase();
    const looksLikeImage = mimeLower.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(file.name);

    if (!looksLikeImage) {
      setPhotoActionMessage('Please choose an image file.');
      input.value = '';
      return;
    }

    const photoId = `photo-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const isLikelyUnsupported = mimeLower.includes('heic') || mimeLower.includes('heif') || /\.(heic|heif)$/i.test(fileNameLower);
    const nextPhoto: BatchPhoto = {
      id: photoId,
      storageRef: photoId,
      ...(file.type ? { contentType: file.type } : {}),
      filename: file.name,
      capturedAt: new Date().toISOString(),
      caption: file.name,
    };

    setIsSavingPhoto(true);
    try {
      await savePhotoBlobToIndexedDb(photoId, file);
      const nextPhotos = [...((batch as BatchWithPhotos).photos ?? []), nextPhoto];
      await saveBatchPhotos(nextPhotos);
      setPhotoActionMessage(
        isLikelyUnsupported
          ? 'Photo saved. HEIC/HEIF preview may be unavailable in this browser.'
          : 'Photo saved.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save photo.';
      setPhotoActionMessage(message);
    } finally {
      input.value = '';
      setIsSavingPhoto(false);
    }
  };

  const handleCaptionChange = async (photoId: string, caption: string) => {
    if (!batch) {
      return;
    }

    const currentPhotos = (batch as BatchWithPhotos).photos ?? [];
    const nextPhotos = currentPhotos.map((photo) => (photo.id === photoId ? { ...photo, caption } : photo));
    try {
      await saveBatchPhotos(nextPhotos);
      setPhotoActionMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save caption.';
      setPhotoActionMessage(message);
    }
  };

  const togglePhotoExpanded = (photoId: string, expanded: boolean) => {
    setExpandedPhotoIds((current) => ({ ...current, [photoId]: expanded }));
  };

  useEffect(() => {
    let isCancelled = false;

    const loadPreviews = async () => {
      for (const photo of orderedPhotos) {
        if (!expandedPhotoIds[photo.id] || photoPreviewUrls[photo.id]) {
          continue;
        }

        const contentTypeLower = (photo.contentType ?? '').toLowerCase();
        const fileNameLower = (photo.filename ?? '').toLowerCase();
        const unsupported = contentTypeLower.includes('heic') || contentTypeLower.includes('heif') || /\.(heic|heif)$/i.test(fileNameLower);
        if (unsupported) {
          continue;
        }

        const blob = await loadPhotoBlobFromIndexedDb(photo.storageRef);
        if (!blob || isCancelled) {
          continue;
        }

        const url = URL.createObjectURL(blob);
        if (isCancelled) {
          URL.revokeObjectURL(url);
          continue;
        }

        setPhotoPreviewUrls((current) => {
          if (current[photo.id]) {
            URL.revokeObjectURL(url);
            return current;
          }
          return { ...current, [photo.id]: url };
        });
      }
    };

    void loadPreviews();

    return () => {
      isCancelled = true;
    };
  }, [orderedPhotos, expandedPhotoIds, photoPreviewUrls]);

  useEffect(
    () => () => {
      Object.values(photoPreviewUrls).forEach((url) => URL.revokeObjectURL(url));
    },
    [photoPreviewUrls],
  );

  if (isLoading) {
    return <p className="batch-detail-empty">Loading batch…</p>;
  }

  if (!batch) {
    return (
      <section className="batch-detail-page">
        <h2>Batch not found</h2>
        <p className="batch-detail-empty">No batch matches ID {batchId ?? 'unknown'}.</p>
        <Link to="/batches" className="batch-detail-back-link">
          Back to batches
        </Link>
      </section>
    );
  }

  return (
    <section className="batch-detail-page">
      <Link to="/batches" className="batch-detail-back-link">
        ← Back to batches
      </Link>
      <h2>{cropName ?? batch.cropId}</h2>

      <div className="batch-detail-grid">
        <article className="batch-detail-card">
          <h3>Metadata</h3>
          <dl>
            <div>
              <dt>Batch ID</dt>
              <dd>{batch.batchId}</dd>
            </div>
            <div>
              <dt>Crop ID</dt>
              <dd>{batch.cropId}</dd>
            </div>
            <div>
              <dt>Stage</dt>
              <dd>{batch.stage}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{new Date(batch.startedAt).toLocaleString()}</dd>
            </div>
          </dl>
        </article>

        <article className="batch-detail-card">
          <h3>Counts</h3>
          <dl>
            <div>
              <dt>Stage events</dt>
              <dd>{batch.stageEvents.length}</dd>
            </div>
            <div>
              <dt>Assignments</dt>
              <dd>{batch.assignments.length}</dd>
            </div>
            <div>
              <dt>Current bed</dt>
              <dd>{getDerivedBedId(batch) ?? 'Unassigned'}</dd>
            </div>
          </dl>
        </article>
      </div>

      <article className="batch-detail-card">
        <h3>Next stage actions</h3>
        {nextStageActions.length === 0 ? (
          <p className="batch-detail-empty">No valid next transitions from {batch.stage}.</p>
        ) : (
          <div className="batch-next-actions">
            {nextStageActions.map((stage) => (
              <div key={stage} className="batch-next-action-row">
                <span className="batch-detail-pill">{stage}</span>
                <input
                  type="datetime-local"
                  value={actionDates[stage] ?? ''}
                  onChange={(event) =>
                    setActionDates((current) => ({
                      ...current,
                      [stage]: event.target.value,
                    }))
                  }
                />
                <button type="button" onClick={() => void handleStageAction(stage)} disabled={isSavingStageAction}>
                  Apply
                </button>
              </div>
            ))}
          </div>
        )}
        {stageActionMessage ? <p className="batch-stage-warning">{stageActionMessage}</p> : null}
      </article>

      <article className="batch-detail-card">
        <h3>Stage timeline</h3>
        {orderedStageEvents.length === 0 ? (
          <p className="batch-detail-empty">No stage events yet.</p>
        ) : (
          <ol className="batch-detail-list">
            {orderedStageEvents.map((event, index) => (
              <li key={`${event.occurredAt}-${event.stage}-${index}`}>
                <span className="batch-detail-pill">{event.stage}</span>
                <span>{new Date(event.occurredAt).toLocaleString()}</span>
              </li>
            ))}
          </ol>
        )}
      </article>

      <article className="batch-detail-card">
        <h3>Bed assignments</h3>
        <p className="batch-detail-current-bed">Current: {getDerivedBedId(batch) ?? 'Unassigned'}</p>
        <div className="batch-next-action-row">
          <span className="batch-detail-pill">remove</span>
          <input
            type="datetime-local"
            value={removeFromBedDate}
            onChange={(event) => setRemoveFromBedDate(event.target.value)}
          />
          <button type="button" onClick={() => void handleRemoveFromBed()} disabled={isSavingRemoveFromBed}>
            Remove from bed
          </button>
        </div>
        {removeFromBedMessage ? <p className="batch-stage-warning">{removeFromBedMessage}</p> : null}
        {assignmentHistory.length === 0 ? (
          <p className="batch-detail-empty">No bed assignment history.</p>
        ) : (
          <ol className="batch-detail-list">
            {assignmentHistory.map((assignment, index) => (
              <li key={`${assignment.assignedAt}-${assignment.bedId}-${index}`}>
                <span className="batch-detail-pill">{assignment.bedId}</span>
                <span>{new Date(assignment.assignedAt).toLocaleString()}</span>
              </li>
            ))}
          </ol>
        )}
      </article>

      <article className="batch-detail-card">
        <h3>Photos</h3>
        <label className="batch-photo-upload-row">
          <span>Add photo</span>
          <input type="file" accept="image/*,.heic,.heif" onChange={(event) => void handlePhotoUpload(event)} disabled={isSavingPhoto} />
        </label>
        {photoActionMessage ? <p className="batch-photo-message">{photoActionMessage}</p> : null}
        {orderedPhotos.length === 0 ? (
          <p className="batch-detail-empty">No photos yet.</p>
        ) : (
          <ol className="batch-photo-list">
            {orderedPhotos.map((photo, index) => {
              const contentTypeLower = (photo.contentType ?? '').toLowerCase();
              const fileNameLower = (photo.filename ?? '').toLowerCase();
              const unsupported = contentTypeLower.includes('heic') || contentTypeLower.includes('heif') || /\.(heic|heif)$/i.test(fileNameLower);
              const previewUrl = photoPreviewUrls[photo.id];

              return (
                <li key={photo.id} className="batch-photo-item">
                  <details onToggle={(event) => togglePhotoExpanded(photo.id, event.currentTarget.open)}>
                    <summary>
                      <span>{photo.filename ?? `Photo ${index + 1}`}</span>
                      <span>{photo.capturedAt ? new Date(photo.capturedAt).toLocaleString() : 'No date'}</span>
                    </summary>
                    <div className="batch-photo-content">
                      {unsupported ? (
                        <p className="batch-photo-unsupported">Preview unavailable for HEIC/HEIF on this browser.</p>
                      ) : previewUrl ? (
                        <img src={previewUrl} alt={photo.caption || photo.filename || `Batch photo ${index + 1}`} loading="lazy" />
                      ) : (
                        <p className="batch-detail-empty">Expand to load preview…</p>
                      )}
                      <label>
                        Caption
                        <input
                          type="text"
                          value={photo.caption ?? ''}
                          onChange={(event) => {
                            const caption = event.target.value;
                            setBatch((current) => {
                              if (!current) {
                                return current;
                              }
                              const currentPhotos = ((current as BatchWithPhotos).photos ?? []).map((candidate) =>
                                candidate.id === photo.id ? { ...candidate, caption } : candidate,
                              );
                              return { ...(current as BatchWithPhotos), photos: currentPhotos } as Batch;
                            });
                          }}
                          onBlur={(event) => void handleCaptionChange(photo.id, event.target.value)}
                        />
                      </label>
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </article>
    </section>
  );
}

function NutritionPage() {
  return <p>Nutrition</p>;
}

type DataPageProps = {
  showDevResetButton: boolean;
  onResetToGoldenDataset: () => void;
};

function DataPage({ showDevResetButton, onResetToGoldenDataset }: DataPageProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<Array<{ path: string; message: string }>>([]);
  const [pendingImportState, setPendingImportState] = useState<unknown | null>(null);

  const mapImportError = useCallback((error: unknown): Array<{ path: string; message: string }> => {
    if (error instanceof SchemaValidationError && error.issues.length > 0) {
      return error.issues.map((issue) => ({
        path: issue.path || '/',
        message: issue.message,
      }));
    }

    if (error instanceof SyntaxError) {
      return [{ path: '/', message: error.message }];
    }

    return [{ path: '/', message: error instanceof Error ? error.message : 'Unknown import error.' }];
  }, []);

  const handleExportJson = useCallback(async () => {
    if (isExporting) {
      return;
    }

    setIsExporting(true);
    setExportMessage(null);

    try {
      const appState = await loadAppStateFromIndexedDb();
      if (!appState) {
        setExportMessage('Export failed: local app state is unavailable.');
        return;
      }

      const json = serializeAppStateForExport(appState);
      const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
      const fileName = `survival-garden-export-${timestamp}.json`;
      const exportBlob = new Blob([json], { type: 'application/json' });
      const objectUrl = URL.createObjectURL(exportBlob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(objectUrl);
      setExportMessage(`Export complete: ${fileName}`);
    } catch (error) {
      if (error instanceof SchemaValidationError && error.issues.length > 0) {
        const issueSummary = error.issues
          .slice(0, 5)
          .map((issue) => issue.path || issue.message)
          .join('; ');
        setExportMessage(`Export failed: ${error.message}: ${issueSummary}`);
      } else {
        setExportMessage(`Export failed: ${error instanceof Error ? error.message : 'Unknown error.'}`);
      }
    } finally {
      setIsExporting(false);
    }
  }, [isExporting]);

  const handleImportJson = useCallback(async (event: FormEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';

    if (!file || isImporting) {
      return;
    }

    setIsImporting(true);
    setImportMessage(null);
    setImportErrors([]);
    setPendingImportState(null);

    try {
      const payload = await file.text();
      const parsedState = parseImportedAppState(payload);
      setPendingImportState(parsedState);
      setImportMessage('Import file is valid. Replace existing data?');
    } catch (error) {
      setImportMessage('Import failed. Fix the errors below and try again.');
      setImportErrors(mapImportError(error));
    } finally {
      setIsImporting(false);
    }
  }, [isImporting, mapImportError]);

  const handleConfirmReplace = useCallback(async () => {
    if (!pendingImportState || isImporting) {
      return;
    }

    setIsImporting(true);
    setImportMessage(null);
    setImportErrors([]);

    try {
      await saveAppStateToIndexedDb(pendingImportState);
      setPendingImportState(null);
      setImportMessage('Import complete. Existing data was replaced.');
    } catch (error) {
      setImportMessage('Import failed while saving.');
      setImportErrors(mapImportError(error));
    } finally {
      setIsImporting(false);
    }
  }, [isImporting, mapImportError, pendingImportState]);

  return (
    <>
      <p>Data</p>
      <button type="button" onClick={() => void handleExportJson()} disabled={isExporting}>
        {isExporting ? 'Exporting JSON…' : 'Export JSON'}
      </button>
      {exportMessage ? <p>{exportMessage}</p> : null}
      <label>
        Import JSON
        <input type="file" accept="application/json,.json" onChange={(event) => void handleImportJson(event)} disabled={isImporting} />
      </label>
      {pendingImportState ? (
        <button type="button" onClick={() => void handleConfirmReplace()} disabled={isImporting}>
          {isImporting ? 'Replacing data…' : 'Replace existing data'}
        </button>
      ) : null}
      {importMessage ? <p>{importMessage}</p> : null}
      {importErrors.length > 0 ? (
        <ul>
          {importErrors.map((error, index) => (
            <li key={`${error.path}-${index}`}>
              <code>{error.path}</code>: {error.message}
            </li>
          ))}
        </ul>
      ) : null}
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
          <Route path="/beds/:bedId" element={<BedDetailPage />} />
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
