import { createSemanticAdapter } from './semantic-adapter.mjs';

export function createDotnetAdapter(baseUrl) {
  return createSemanticAdapter('dotnet', baseUrl);
}
