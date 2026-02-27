import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { initializeAppStateStorage, resetToGoldenDataset } from './data';

vi.mock('./data', () => ({
  initializeAppStateStorage: vi.fn().mockResolvedValue(undefined),
  resetToGoldenDataset: vi.fn().mockResolvedValue(undefined),
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

  it('shows dev reset action when flag is enabled and resets to golden dataset', async () => {
    vi.stubEnv('VITE_ENABLE_DEV_RESET', 'true');
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/data']}>
        <App />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Reset to golden dataset' }));

    expect(resetToGoldenDataset).toHaveBeenCalledTimes(1);
    expect(initializeAppStateStorage).toHaveBeenCalled();
  });
});
