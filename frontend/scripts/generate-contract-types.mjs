import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, '../src/generated');
const contractsOutputFile = path.join(outputDir, 'contracts.ts');
const openApiPathsOutputFile = path.join(outputDir, 'openapi-paths.ts');
const clientOutputFile = path.join(outputDir, 'api-client.ts');
const openApiUrl = process.env.BACKEND_OPENAPI_URL ?? 'http://localhost:5142/openapi/v1.json';
const isCi = process.env.CI === 'true' || process.env.CI === '1';
const requireBackendOpenApi = process.env.REQUIRE_BACKEND_OPENAPI === '1' || isCi;
const expectedContractVersion = process.env.EXPECTED_CONTRACT_VERSION?.trim();

const fallbackContracts = await readFile(contractsOutputFile, 'utf8').catch(() => null);
const fallbackOpenApiPaths = await readFile(openApiPathsOutputFile, 'utf8').catch(() => null);
const fallbackClient = await readFile(clientOutputFile, 'utf8').catch(() => null);
const shouldWriteClient = true;

const response = await fetch(openApiUrl).catch(() => null);
if (!response || !response.ok) {
  if (!requireBackendOpenApi && fallbackContracts) {
    if (!fallbackOpenApiPaths) {
      await mkdir(outputDir, { recursive: true });
      await writeFile(
        openApiPathsOutputFile,
        `/**
 * GENERATED FILE - DO NOT EDIT.
 * Backend OpenAPI unavailable; generated fallback OpenAPI paths shim.
 */

export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export type components = Record<string, never>;
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
`,
        'utf8',
      );
    }

    if (!fallbackClient && shouldWriteClient) {
      await mkdir(outputDir, { recursive: true });
      await writeFile(
        clientOutputFile,
        `/**
 * GENERATED FILE - DO NOT EDIT.
 * Backend OpenAPI unavailable; generated fallback client shim.
 */

export type BackendApiPath = string;

export const backendApiFetch = async <T>(path: BackendApiPath, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(\`Backend API request failed: \${response.status} \${response.statusText}\`);
  }

  return (await response.json()) as T;
};
`,
        'utf8',
      );
    }

    process.exit(0);
  }

  const status = response ? response.status : 'unreachable';
  throw new Error(`Failed to fetch backend OpenAPI document (${status}): ${openApiUrl}`);
}

const openApiDocument = await response.json();
const openApiInfo = openApiDocument?.info ?? {};
const openApiDescription = typeof openApiInfo.description === 'string' ? openApiInfo.description : '';
const contractVersion = typeof openApiInfo.version === 'string' ? openApiInfo.version.trim() : '';
const contractsPublication = openApiDocument?.['x-contracts'] ?? /contracts=([^;\s]+)/.exec(openApiDescription)?.[1];
const persistedSchemaVersionValue =
  openApiDocument?.['x-persisted-schema-version'] ?? /persistedSchemaVersion=([0-9]+)/.exec(openApiDescription)?.[1];
const persistedSchemaVersion = Number(persistedSchemaVersionValue);

if (!contractVersion) {
  throw new Error(`Backend OpenAPI document missing required info.version: ${openApiUrl}`);
}

if (contractsPublication !== 'backend-canonical') {
  throw new Error(
    `Backend OpenAPI document missing required x-contracts=backend-canonical marker: ${openApiUrl}`,
  );
}

if (!Number.isInteger(persistedSchemaVersion)) {
  throw new Error(
    `Backend OpenAPI document missing required integer x-persisted-schema-version marker: ${openApiUrl}`,
  );
}

if (expectedContractVersion && expectedContractVersion !== contractVersion) {
  throw new Error(
    `Backend contract version mismatch. Expected ${expectedContractVersion}, received ${contractVersion}`,
  );
}

if (!fallbackContracts) {
  throw new Error(
    'Missing generated contracts.ts. Generate backend *.schema.json artifacts and regenerate frontend contracts.',
  );
}

const openApiPaths = await openapiTS(openApiDocument, {
  alphabetize: true,
  commentHeader: [
    '/**',
    ' * GENERATED FILE - DO NOT EDIT.',
    ` * OpenAPI source: ${openApiUrl}`,
    ` * Contract version: ${contractVersion}`,
    ` * Persisted schemaVersion baseline: ${persistedSchemaVersion}`,
    ' * Regenerate with `pnpm --filter frontend gen:types`.',
    ' */',
  ].join('\n'),
});

const paths = Object.keys(openApiDocument.paths ?? {});
const pathUnion = paths.length > 0 ? paths.map((value) => `  | '${value}'`).join('\n') : "  | never";

const client = `/**
 * GENERATED FILE - DO NOT EDIT.
 * OpenAPI source: ${openApiUrl}
 * Contract version: ${contractVersion}
 * Persisted schemaVersion baseline: ${persistedSchemaVersion}
 * Regenerate with \`pnpm --filter frontend gen:types\`.
 */

export type BackendApiPath =
${pathUnion};

export const backendApiFetch = async <T>(
  path: BackendApiPath,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(\`Backend API request failed: \${response.status} \${response.statusText}\`);
  }

  return (await response.json()) as T;
};
`;

await mkdir(outputDir, { recursive: true });
if (!fallbackOpenApiPaths) {
  await writeFile(openApiPathsOutputFile, astToString(openApiPaths), 'utf8');
}
if (shouldWriteClient) {
  await writeFile(clientOutputFile, client, 'utf8');
}
