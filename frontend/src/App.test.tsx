import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

describe('App', () => {
  it('renders the app title and primary navigation', () => {
    render(
      <MemoryRouter initialEntries={['/beds']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'SurvivalGarden' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Beds' })).toBeInTheDocument();
  });
});
