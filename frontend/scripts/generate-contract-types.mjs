import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import { compile } from 'json-schema-to-typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(__dirname, '../src/contracts');
const outputDir = path.resolve(__dirname, '../src/generated');
const contractsOutputFile = path.join(outputDir, 'contracts.ts');
const openApiPathsOutputFile = path.join(outputDir, 'openapi-paths.ts');
const clientOutputFile = path.join(outputDir, 'api-client.ts');
const openApiUrl = process.env.BACKEND_OPENAPI_URL ?? 'http://localhost:5142/openapi/v1.json';
const isCi = process.env.CI === 'true' || process.env.CI === '1';
const requireBackendOpenApi = process.env.REQUIRE_BACKEND_OPENAPI === '1' || isCi;
const expectedContractVersion = process.env.EXPECTED_CONTRACT_VERSION?.trim();
const schemaRefBase = 'https://survivalgarden/contracts/';
const shouldWriteClient = true;

const componentFileAliases = new Map([
  ['CropType', 'crop.schema.json'],
  ['AppStateDto', 'app-state.schema.json'],
]);

const toTypeName = (fileName) =>
  fileName
    .replace(/\.schema\.json$/, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const toKebabCase = (value) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();

const toSchemaFileName = (componentName) => componentFileAliases.get(componentName) ?? `${toKebabCase(componentName)}.schema.json`;

const rewriteOpenApiRef = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  if (value.startsWith('#/components/schemas/')) {
    const componentName = value.slice('#/components/schemas/'.length);
    return `${schemaRefBase}${toSchemaFileName(componentName)}`;
  }

  return value;
};

const rewriteSchema = (value) => {
  if (Array.isArray(value)) {
    return value.map(rewriteSchema);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        if (key === 'nullable' && item === true) {
          return [];
        }

        if (key === '$ref') {
          return [[key, rewriteOpenApiRef(item)]];
        }

        return [[key, rewriteSchema(item)]];
      }),
    );
  }

  return value;
};

const normalizeSchemaUris = (value) => {
  if (Array.isArray(value)) {
    return value.map(normalizeSchemaUris);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if ((key === '$ref' || key === '$id') && typeof item === 'string' && item.startsWith(schemaRefBase)) {
          return [key, `./${item.slice(schemaRefBase.length)}`];
        }

        return [key, normalizeSchemaUris(item)];
      }),
    );
  }

  return value;
};

const fetchOpenApiDocument = async () => {
  const response = await fetch(openApiUrl).catch(() => null);
  if (!response?.ok) {
    const status = response ? response.status : 'unreachable';
    throw new Error(`Failed to fetch backend OpenAPI document (${status}): ${openApiUrl}`);
  }

  return response.json();
};

const openApiDocument = await fetchOpenApiDocument().catch((error) => {
  if (requireBackendOpenApi) {
    throw error;
  }

  throw new Error(
    `Backend OpenAPI is required to generate contracts for this repository. Original error: ${error.message}`,
  );
});

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
  throw new Error(`Backend OpenAPI document missing required x-contracts=backend-canonical marker: ${openApiUrl}`);
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

const componentSchemas = openApiDocument?.components?.schemas ?? {};
const schemaEntries = Object.entries(componentSchemas)
  .map(([componentName, schema]) => {
    const schemaFile = toSchemaFileName(componentName);
    const schemaDocument = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `${schemaRefBase}${schemaFile}`,
      ...rewriteSchema(schema),
    };

    return {
      componentName,
      schemaFile,
      schemaDocument,
    };
  })
  .sort((a, b) => a.schemaFile.localeCompare(b.schemaFile));

if (schemaEntries.length === 0) {
  throw new Error('Backend OpenAPI document did not include components.schemas for contract generation.');
}

await mkdir(contractsDir, { recursive: true });
for (const entry of schemaEntries) {
  const schemaPath = path.join(contractsDir, entry.schemaFile);
  await writeFile(schemaPath, `${JSON.stringify(entry.schemaDocument, null, 2)}\n`, 'utf8');
}

const sections = [];
for (const entry of schemaEntries) {
  const content = await compile(normalizeSchemaUris(entry.schemaDocument), toTypeName(entry.schemaFile), {
    bannerComment: '',
    cwd: contractsDir,
    strictIndexSignatures: true,
    $refOptions: {
      resolve: {
        http: false,
      },
    },
  });

  sections.push(content.trim());
}

const contracts = `/**
 * GENERATED FILE - DO NOT EDIT.
 * OpenAPI source: ${openApiUrl}
 * Contract version: ${contractVersion}
 * Persisted schemaVersion baseline: ${persistedSchemaVersion}
 * Regenerate with \`pnpm --filter frontend gen:types\`.
 */
${sections.join('\n\n')}
`;

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
const pathUnion = paths.length > 0 ? paths.map((value) => `  | '${value}'`).join('\n') : '  | never';

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
await writeFile(contractsOutputFile, contracts, 'utf8');
await writeFile(openApiPathsOutputFile, astToString(openApiPaths), 'utf8');
if (shouldWriteClient) {
  await writeFile(clientOutputFile, client, 'utf8');
}
