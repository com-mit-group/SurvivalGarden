import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import {
  initializeAppStateStorage,
  loadAppStateFromIndexedDb,
  parseImportedAppState,
  resetToGoldenDataset,
  saveAppStateToIndexedDb,
  SchemaValidationError,
  serializeAppStateForExport,
} from './data';

vi.mock('./data', () => ({
  initializeAppStateStorage: vi.fn().mockResolvedValue(undefined),
  resetToGoldenDataset: vi.fn().mockResolvedValue(undefined),
  loadAppStateFromIndexedDb: vi.fn().mockResolvedValue(null),
  parseImportedAppState: vi.fn(),
  saveAppStateToIndexedDb: vi.fn().mockResolvedValue(undefined),
  serializeAppStateForExport: vi.fn().mockReturnValue('{"schemaVersion":1}'),
  listBedsFromAppState: vi.fn().mockReturnValue([]),
  listBatchesFromAppState: vi.fn().mockReturnValue([]),
  listTasksFromAppState: vi.fn().mockReturnValue([]),
  SchemaValidationError: class extends Error {
    schemaName: string;
    issues: Array<{ schemaName: string; keyword: string; path: string; message: string }>;

    constructor(schemaName: string, issues: Array<{ schemaName: string; keyword: string; path: string; message: string }>) {
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
    if (typeof URL.createObjectURL === 'function') {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    } else {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: vi.fn().mockReturnValue('blob:test'),
      });
    }

    if (typeof URL.revokeObjectURL === 'function') {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    } else {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: vi.fn(),
      });
    }

    if (typeof File !== 'undefined' && typeof File.prototype.text !== 'function') {
      Object.defineProperty(File.prototype, 'text', {
        configurable: true,
        writable: true,
        value: vi.fn().mockResolvedValue(''),
      });
    }
  });

  afterEach(() => {
    cleanup();
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
      {
        schemaName: 'appState',
        keyword: 'type',
        path: '/batches/0/photos/0/storageRef',
        message: 'must be string',
      },
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

  it('shows import validation errors and does not persist invalid payloads', async () => {
    const validationError = new SchemaValidationError('appState', [
      {
        schemaName: 'appState',
        keyword: 'type',
        path: '/batches/0/photos/0/storageRef',
        message: 'must be string',
      },
    ]);
    vi.mocked(parseImportedAppState).mockImplementation(() => {
      throw validationError;
    });

    render(
      <MemoryRouter initialEntries={['/data']}>
        <App />
      </MemoryRouter>
    );

    const input = screen.getByLabelText('Import JSON');
    const file = new File(['{invalid'], 'bad.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Import failed. Fix the errors below and try again.')).toBeInTheDocument();
    });

    expect(screen.getByText(/\/batches\/0\/photos\/0\/storageRef/)).toBeInTheDocument();
    expect(saveAppStateToIndexedDb).not.toHaveBeenCalled();
  });

  it('requires replace confirmation before saving imported data', async () => {
    const importedState = { schemaVersion: 1, beds: [], crops: [], cropPlans: [], batches: [], seedInventoryItems: [], tasks: [] };
    vi.mocked(parseImportedAppState).mockReturnValue(importedState as never);

    render(
      <MemoryRouter initialEntries={['/data']}>
        <App />
      </MemoryRouter>
    );

    const input = screen.getByLabelText('Import JSON');
    const file = new File(['{"schemaVersion":1}'], 'good.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Import file is valid. Replace existing data?')).toBeInTheDocument();
    });

    expect(saveAppStateToIndexedDb).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Replace existing data' }));

    await waitFor(() => {
      expect(saveAppStateToIndexedDb).toHaveBeenCalledWith(importedState);
      expect(screen.getByText('Import complete. Existing data was replaced.')).toBeInTheDocument();
    });
  });
});
