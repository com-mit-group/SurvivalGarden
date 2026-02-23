import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders the app title and foundation message', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'SurvivalGarden' })).toBeInTheDocument();
    expect(
      screen.getByText('Vite + React + TypeScript foundation is ready.')
    ).toBeInTheDocument();
  });
});
