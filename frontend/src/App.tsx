import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { initializeAppStateStorage, resetToGoldenDataset } from './data';

function BedsPage() {
  return <p>Beds</p>;
}

function CalendarPage() {
  return <p>Calendar</p>;
}

function BatchesPage() {
  return <p>Batches</p>;
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
