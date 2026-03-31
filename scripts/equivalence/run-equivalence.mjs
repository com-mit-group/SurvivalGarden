#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createTypescriptAdapter } from './adapters/typescript.mjs';
import { createDotnetAdapter } from './adapters/dotnet.mjs';
import { assertSuccessfulResponse, canonicalize } from './adapters/http.mjs';

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
  createTypescriptAdapter(tsBaseUrl),
  createDotnetAdapter(dotnetBaseUrl),
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
    await runtime.resetState(resetFixture);

    const stepResults = [];
    for (const step of scenario.steps ?? []) {
      stepResults.push(await runStep(runtime, step));
    }

    const finalState = await runtime.loadFinalState();
    assertSuccessfulResponse(runtime.name, 'loadFinalState', finalState);
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
  const response = await runtime.executeStep(step);
  assertSuccessfulResponse(runtime.name, step.op, response);
  assertStepExpectations(step, response);
  return normalizeStepResult(step, response);
}

function assertStepExpectations(step, response) {
  if (!step.expect) {
    return;
  }

  if (typeof step.expect.status === 'number' && response.status !== step.expect.status) {
    throw new Error(`Expected ${step.op} to return ${step.expect.status} but got ${response.status}`);
  }

  if (step.expect.bodyIncludes !== undefined && !containsStructure(response.body, step.expect.bodyIncludes)) {
    throw new Error(`Expected ${step.op} response body to include ${JSON.stringify(step.expect.bodyIncludes)}`);
  }
}

function containsStructure(actual, expected) {
  if (expected === null || typeof expected !== 'object') {
    return actual === expected;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length < expected.length) {
      return false;
    }

    return expected.every((expectedItem, index) => containsStructure(actual[index], expectedItem));
  }

  if (!actual || typeof actual !== 'object') {
    return false;
  }

  return Object.entries(expected).every(([key, expectedValue]) => containsStructure(actual[key], expectedValue));
}

function normalizeStepResult(step, response) {
  return {
    op: step.op,
    input: canonicalize(step.input ?? null),
    status: response.status,
    body: canonicalize(response.body),
  };
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
