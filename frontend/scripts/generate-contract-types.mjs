import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS from 'openapi-typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, '../src/generated');
const contractsOutputFile = path.join(outputDir, 'contracts.ts');
const clientOutputFile = path.join(outputDir, 'api-client.ts');
const openApiUrl = process.env.BACKEND_OPENAPI_URL ?? 'http://localhost:5142/openapi/v1.json';

const response = await fetch(openApiUrl);
if (!response.ok) {
  throw new Error(`Failed to fetch backend OpenAPI document (${response.status}): ${openApiUrl}`);
}

const openApiDocument = await response.json();

const contracts = await openapiTS(openApiDocument, {
  alphabetize: true,
  commentHeader: [
    '/**',
    ' * GENERATED FILE - DO NOT EDIT.',
    ` * Source: ${openApiUrl}`,
    ' * Regenerate with `pnpm --filter frontend gen:types`.',
    ' */',
  ].join('\n'),
});

const paths = Object.keys(openApiDocument.paths ?? {});
const pathUnion = paths.length > 0 ? paths.map((value) => `  | '${value}'`).join('\n') : "  | never";

const client = `/**
 * GENERATED FILE - DO NOT EDIT.
 * Source: ${openApiUrl}
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
await writeFile(clientOutputFile, client, 'utf8');
