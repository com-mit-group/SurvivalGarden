import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS from 'openapi-typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, '../src/generated');
const contractsOutputFile = path.join(outputDir, 'contracts.ts');
const clientOutputFile = path.join(outputDir, 'api-client.ts');
const openApiUrl = process.env.BACKEND_OPENAPI_URL ?? 'http://localhost:5142/openapi/v1.json';
const requireBackendOpenApi = process.env.REQUIRE_BACKEND_OPENAPI === '1';
const expectedContractVersion = process.env.EXPECTED_CONTRACT_VERSION?.trim();

const fallbackContracts = await readFile(contractsOutputFile, 'utf8').catch(() => null);
const fallbackClient = await readFile(clientOutputFile, 'utf8').catch(() => null);
const shouldWriteClient = process.env.GENERATE_API_CLIENT === '1' || fallbackClient !== null;

const response = await fetch(openApiUrl).catch(() => null);
if (!response || !response.ok) {
  if (!requireBackendOpenApi && fallbackContracts) {
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
const contractVersion = typeof openApiInfo.version === 'string' ? openApiInfo.version.trim() : '';
const contractsPublication = openApiDocument?.['x-contracts'];
const persistedSchemaVersion = openApiDocument?.['x-persisted-schema-version'];

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

const contracts = await openapiTS(openApiDocument, {
  alphabetize: true,
  commentHeader: [
    '/**',
    ' * GENERATED FILE - DO NOT EDIT.',
    ` * Source: ${openApiUrl}`,
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
 * Source: ${openApiUrl}
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
await writeFile(contractsOutputFile, contracts, 'utf8');
if (shouldWriteClient) {
  await writeFile(clientOutputFile, client, 'utf8');
}
