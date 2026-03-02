import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { initializeAppStateStorage, resetToGoldenDataset } from './data';

vi.mock('./data', () => ({
  initializeAppStateStorage: vi.fn().mockResolvedValue(undefined),
  resetToGoldenDataset: vi.fn().mockResolvedValue(undefined),
  loadAppStateFromIndexedDb: vi.fn().mockResolvedValue(null),
  listBedsFromAppState: vi.fn().mockReturnValue([]),
  listBatchesFromAppState: vi.fn().mockReturnValue([]),
}));

describe('App', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ENABLE_DEV_RESET', '');
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
});
