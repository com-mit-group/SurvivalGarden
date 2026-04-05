import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldUseCanonicalBackendPath, shouldUseTypescriptRollbackShim } from '../workflowAdapter';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('repository workflow routing gates', () => {
  it('keeps beds/taxonomy/inventory canonical routing disabled in typescript mode', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'typescript');
    vi.stubEnv('VITE_ROUTE_BEDS_SEGMENTS_TO_BACKEND', 'true');
    vi.stubEnv('VITE_ROUTE_TAXONOMY_TO_BACKEND', 'true');
    vi.stubEnv('VITE_ROUTE_INVENTORY_TO_BACKEND', 'true');

    expect(shouldUseCanonicalBackendPath('bedsSegments')).toBe(false);
    expect(shouldUseCanonicalBackendPath('taxonomy')).toBe(false);
    expect(shouldUseCanonicalBackendPath('inventory')).toBe(false);
  });

  it('supports feature-flag routing in backend mode for repository workflows', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
    vi.stubEnv('VITE_ROUTE_BEDS_SEGMENTS_TO_BACKEND', 'true');
    vi.stubEnv('VITE_ROUTE_TAXONOMY_TO_BACKEND', 'false');
    vi.stubEnv('VITE_ROUTE_INVENTORY_TO_BACKEND', 'true');

    expect(shouldUseCanonicalBackendPath('bedsSegments')).toBe(true);
    expect(shouldUseCanonicalBackendPath('taxonomy')).toBe(false);
    expect(shouldUseCanonicalBackendPath('inventory')).toBe(true);
  });

  it('promotes parity-accepted repository workflows to canonical', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
    vi.stubEnv('VITE_PARITY_ACCEPTED_WORKFLOWS', 'bedsSegments,taxonomy,inventory');

    expect(shouldUseCanonicalBackendPath('bedsSegments')).toBe(true);
    expect(shouldUseCanonicalBackendPath('taxonomy')).toBe(true);
    expect(shouldUseCanonicalBackendPath('inventory')).toBe(true);
  });

  it('allows selectively re-enabling rollback shims by repository workflow', () => {
    vi.stubEnv('VITE_FRONTEND_MODE', 'backend');
    vi.stubEnv('VITE_PARITY_ACCEPTED_WORKFLOWS', 'bedsSegments,taxonomy,inventory');
    vi.stubEnv('VITE_ENABLE_TYPESCRIPT_ROLLBACK_SHIMS', 'true');
    vi.stubEnv('VITE_TYPESCRIPT_ROLLBACK_WORKFLOWS', 'taxonomy');

    expect(shouldUseTypescriptRollbackShim('bedsSegments')).toBe(false);
    expect(shouldUseTypescriptRollbackShim('taxonomy')).toBe(true);
    expect(shouldUseTypescriptRollbackShim('inventory')).toBe(false);
  });
});
