import { createSemanticAdapter } from './semantic-adapter.mjs';

export function createTypescriptAdapter(baseUrl) {
  return createSemanticAdapter('typescript', baseUrl);
}
