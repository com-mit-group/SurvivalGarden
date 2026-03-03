import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import {
  initializeAppStateStorage,
  loadAppStateFromIndexedDb,
  resetToGoldenDataset,
  SchemaValidationError,
  serializeAppStateForExport,
} from './data';

vi.mock('./data', () => ({
  initializeAppStateStorage: vi.fn().mockResolvedValue(undefined),
  resetToGoldenDataset: vi.fn().mockResolvedValue(undefined),
  loadAppStateFromIndexedDb: vi.fn().mockResolvedValue(null),
  serializeAppStateForExport: vi.fn().mockReturnValue('{"schemaVersion":1}'),
  listBedsFromAppState: vi.fn().mockReturnValue([]),
  listBatchesFromAppState: vi.fn().mockReturnValue([]),
  listTasksFromAppState: vi.fn().mockReturnValue([]),
  SchemaValidationError: class extends Error {
    schemaName: string;
    issues: Array<{ path: string; message: string }>;

    constructor(schemaName: string, issues: Array<{ path: string; message: string }>) {
      super('Schema validation failed');
      this.name = 'SchemaValidationError';
      this.schemaName = schemaName;
      this.issues = issues;
    }
  },
}));

describe('App', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ENABLE_DEV_RESET', '');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('renders the app title and primary navigation', () => {
    render(
      <MemoryRouter initialEntries={['/beds']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'SurvivalGarden' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Beds' })).toBeInTheDocument();
  });

  it('hides dev reset action when flag is disabled', () => {
    render(
      <MemoryRouter initialEntries={['/data']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.queryByRole('button', { name: 'Reset to golden dataset' })).not.toBeInTheDocument();
  });

  it('shows dev reset action when flag is enabled and resets to golden dataset', () => {
    vi.stubEnv('VITE_ENABLE_DEV_RESET', 'true');

    render(
      <MemoryRouter initialEntries={['/data']}>
        <App />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset to golden dataset' }));

    expect(resetToGoldenDataset).toHaveBeenCalledTimes(1);
    expect(initializeAppStateStorage).toHaveBeenCalled();
  });

  it('exports JSON from current app state and triggers download', async () => {
    const mockAppState = {
      schemaVersion: 1,
      beds: [],
      crops: [],
      cropPlans: [],
      batches: [{ batchId: 'batch-1', photos: [{ id: 'photo-1', storageRef: 'photo-1', filename: 'leaf.jpg' }] }],
      seedInventory: [],
      tasks: [],
    };
    vi.mocked(loadAppStateFromIndexedDb).mockResolvedValue(mockAppState as never);

    render(
      <MemoryRouter initialEntries={['/data']}>
        <App />
      </MemoryRouter>
    );

    const appendChildSpy = vi.spyOn(document.body, 'appendChild');
    const removeChildSpy = vi.spyOn(document.body, 'removeChild');
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));

    await waitFor(() => {
      expect(serializeAppStateForExport).toHaveBeenCalledWith(mockAppState);
      expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText(/Export complete:/)).toBeInTheDocument();
    expect(appendChildSpy).not.toHaveBeenCalled();
    expect(removeChildSpy).not.toHaveBeenCalled();
  });

  it('blocks download and surfaces validation issues when export serialization fails', async () => {
    vi.mocked(loadAppStateFromIndexedDb).mockResolvedValue({ schemaVersion: 1 } as never);
    const validationError = new SchemaValidationError('appState', [
      { path: '/batches/0/photos/0/storageRef', message: 'must be string' },
    ]);
    vi.mocked(serializeAppStateForExport).mockImplementation(() => {
      throw validationError;
    });

    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={['/data']}>
        <App />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));

    await waitFor(() => {
      expect(screen.getByText(/Export failed:/)).toBeInTheDocument();
    });

    expect(anchorClickSpy).not.toHaveBeenCalled();
  });
});
