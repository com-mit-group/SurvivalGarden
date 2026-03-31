#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split('=');
    return [key, value ?? 'true'];
  }),
);

const scenarioPath = path.resolve(repoRoot, args.get('--scenarios') ?? 'fixtures/equivalence/equivalence-scenarios.v1.json');
const tsBaseUrl = (args.get('--tsBaseUrl') ?? process.env.TS_BASE_URL ?? '').replace(/\/$/, '');
const dotnetBaseUrl = (args.get('--dotnetBaseUrl') ?? process.env.DOTNET_BASE_URL ?? '').replace(/\/$/, '');
const outputPath = path.resolve(repoRoot, args.get('--out') ?? 'artifacts/equivalence-report.json');

if (!tsBaseUrl || !dotnetBaseUrl) {
  console.error('Missing TS_BASE_URL or DOTNET_BASE_URL.');
  console.error('Example: node scripts/equivalence/run-equivalence.mjs --tsBaseUrl=http://localhost:5174 --dotnetBaseUrl=http://localhost:5050');
  process.exit(2);
}

const scenariosDoc = JSON.parse(await readFile(scenarioPath, 'utf8'));
const fixturePath = path.resolve(repoRoot, scenariosDoc.resetFixture ?? 'fixtures/golden/trier-v1.json');
const resetFixture = JSON.parse(await readFile(fixturePath, 'utf8'));

const runtimes = [
  { name: 'typescript', baseUrl: tsBaseUrl },
  { name: 'dotnet', baseUrl: dotnetBaseUrl },
];

const report = {
  generatedAtUtc: new Date().toISOString(),
  scenariosFile: path.relative(repoRoot, scenarioPath),
  fixture: path.relative(repoRoot, fixturePath),
  mismatches: [],
  scenarios: [],
};

for (const scenario of scenariosDoc.scenarios ?? []) {
  const runResults = {};

  for (const runtime of runtimes) {
    const resetResponse = await api(runtime, 'PUT', '/api/app-state', resetFixture);
    assertSuccessfulResponse(runtime, 'PUT /api/app-state', resetResponse);

    const stepResults = [];
    for (const step of scenario.steps ?? []) {
      stepResults.push(await runStep(runtime, step));
    }

    const finalState = await api(runtime, 'GET', '/api/app-state');
    assertSuccessfulResponse(runtime, 'GET /api/app-state', finalState);
    runResults[runtime.name] = {
      stepResults,
      finalState: canonicalize(finalState.body),
    };
  }

  const scenarioMismatches = [];
  compareValues(`scenario:${scenario.id}:stepResults`, runResults.typescript.stepResults, runResults.dotnet.stepResults, scenarioMismatches);
  compareValues(`scenario:${scenario.id}:finalState`, runResults.typescript.finalState, runResults.dotnet.finalState, scenarioMismatches);

  report.scenarios.push({
    id: scenario.id,
    name: scenario.name,
    steps: scenario.steps?.length ?? 0,
    mismatches: scenarioMismatches,
  });

  report.mismatches.push(...scenarioMismatches);
}

const { writeFile, mkdir } = await import('node:fs/promises');
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (report.mismatches.length > 0) {
  console.error(`Equivalence mismatches: ${report.mismatches.length}`);
  for (const mismatch of report.mismatches.slice(0, 20)) {
    console.error(`- ${mismatch.path}: ${mismatch.reason}`);
  }
  process.exit(1);
}

console.log(`Equivalence suite passed (${report.scenarios.length} scenarios).`);
console.log(`Report written to ${path.relative(repoRoot, outputPath)}`);

async function runStep(runtime, step) {
  const { action } = step;
  let response;

  switch (action) {
    case 'upsert': {
      response = await api(runtime, 'PUT', resolveEndpoint(runtime, step, `/api/${step.collection}/${step.id}`), step.payload);
      break;
    }
    case 'delete': {
      response = await api(runtime, 'DELETE', resolveEndpoint(runtime, step, `/api/${step.collection}/${step.id}`));
      break;
    }
    case 'get': {
      response = await api(runtime, 'GET', resolveEndpoint(runtime, step, `/api/${step.collection}/${step.id}`));
      break;
    }
    case 'list': {
      const query = new URLSearchParams(step.query ?? {}).toString();
      response = await api(runtime, 'GET', resolveEndpoint(runtime, step, `/api/${step.collection}${query ? `?${query}` : ''}`));
      break;
    }
    case 'validate': {
      response = await api(runtime, 'POST', resolveEndpoint(runtime, step, `/api/validate/${step.collection}`), step.payload);
      break;
    }
    case 'saveAppState': {
      response = await api(runtime, 'PUT', resolveEndpoint(runtime, step, '/api/app-state'), step.payload);
      break;
    }
    case 'loadAppState': {
      response = await api(runtime, 'GET', resolveEndpoint(runtime, step, '/api/app-state'));
      break;
    }
    default:
      throw new Error(`Unsupported action: ${action}`);
  }

  assertSuccessfulResponse(runtime, `${action}${step.collection ? ` ${step.collection}` : ''}`, response);
  return normalizeStepResult(step, response);
}

function normalizeStepResult(step, response) {
  return {
    id: step.id ?? null,
    action: step.action,
    collection: step.collection ?? null,
    statusClass: `${Math.floor(response.status / 100)}xx`,
    body: step.action === 'validate' ? normalizeValidationBody(response.body) : null,
  };
}

async function api(runtime, method, endpoint, body) {
  const response = await fetch(`${runtime.baseUrl}${endpoint}`, {
    method,
    headers: {
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  return {
    status: response.status,
    body: payload,
  };
}


function assertSuccessfulResponse(runtime, operation, response) {
  if (response.status >= 200 && response.status < 300) {
    return;
  }

  const hint = response.status === 404 ? ' (check base URL points at backend API, not the frontend dev server)' : '';
  throw new Error(`${runtime.name} ${operation} failed with ${response.status}${hint}`);
}


function resolveEndpoint(runtime, step, fallbackEndpoint) {
  if (step.endpointByRuntime && step.endpointByRuntime[runtime.name]) {
    return step.endpointByRuntime[runtime.name];
  }

  return fallbackEndpoint;
}

function normalizeValidationBody(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  return canonicalize({
    ok: body.ok === true,
    issues: Array.isArray(body.issues)
      ? body.issues.map((issue) => ({ path: issue?.path ?? null, message: issue?.message ?? null }))
      : [],
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, inner]) => [key, canonicalize(inner)]),
    );
  }

  return value;
}

function compareValues(currentPath, left, right, mismatches) {
  if (typeof left !== typeof right) {
    mismatches.push({ path: currentPath, reason: `type mismatch (${typeof left} !== ${typeof right})` });
    return;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      mismatches.push({ path: currentPath, reason: `array length mismatch (${left.length} !== ${right.length})` });
    }

    const count = Math.min(left.length, right.length);
    for (let index = 0; index < count; index += 1) {
      compareValues(`${currentPath}[${index}]`, left[index], right[index], mismatches);
    }

    return;
  }

  if (left && typeof left === 'object' && right && typeof right === 'object') {
    const leftKeys = new Set(Object.keys(left));
    const rightKeys = new Set(Object.keys(right));
    const allKeys = [...new Set([...leftKeys, ...rightKeys])].sort((a, b) => a.localeCompare(b));

    for (const key of allKeys) {
      if (!leftKeys.has(key)) {
        mismatches.push({ path: `${currentPath}.${key}`, reason: 'missing from typescript output' });
        continue;
      }
      if (!rightKeys.has(key)) {
        mismatches.push({ path: `${currentPath}.${key}`, reason: 'missing from dotnet output' });
        continue;
      }

      compareValues(`${currentPath}.${key}`, left[key], right[key], mismatches);
    }

    return;
  }

  if (left !== right) {
    mismatches.push({ path: currentPath, reason: `value mismatch (${JSON.stringify(left)} !== ${JSON.stringify(right)})` });
  }
}
