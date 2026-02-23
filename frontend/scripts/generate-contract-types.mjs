import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(__dirname, '../src/contracts');
const outputDir = path.resolve(__dirname, '../src/generated');
const outputFile = path.join(outputDir, 'contracts.ts');
const schemaRefBase = 'https://survivalgarden/contracts/';

const toTypeName = (fileName) =>
  fileName
    .replace(/\.schema\.json$/, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const normalizeRefs = (value) => {
  if (Array.isArray(value)) {
    return value.map(normalizeRefs);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (key === '$ref' && typeof item === 'string' && item.startsWith(schemaRefBase)) {
          return [key, `./${item.slice(schemaRefBase.length)}`];
        }

        return [key, normalizeRefs(item)];
      }),
    );
  }

  return value;
};

const schemaFiles = (await readdir(contractsDir))
  .filter((file) => file.endsWith('.schema.json'))
  .sort((a, b) => a.localeCompare(b));

const sections = [];
for (const schemaFile of schemaFiles) {
  const schemaPath = path.join(contractsDir, schemaFile);
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));

  const content = await compile(normalizeRefs(schema), toTypeName(schemaFile), {
    bannerComment: '',
    cwd: contractsDir,
    strictIndexSignatures: true,
  });

  sections.push(content.trim());
}

const generated = `/**
 * GENERATED FILE - DO NOT EDIT.
 * Regenerate with \`pnpm --filter frontend gen:types\`.
 */

${sections.join('\n\n')}
`;

await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, generated, 'utf8');
