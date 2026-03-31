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
const allowlistPath = path.resolve(repoRoot, args.get('--allowlist') ?? 'fixtures/equivalence/allowlist.v1.json');
const tsBaseUrl = (args.get('--tsBaseUrl') ?? process.env.TS_BASE_URL ?? '').replace(/\/$/, '');
const dotnetBaseUrl = (args.get('--dotnetBaseUrl') ?? process.env.DOTNET_BASE_URL ?? '').replace(/\/$/, '');
const outputPath = path.resolve(repoRoot, args.get('--out') ?? 'artifacts/equivalence-report.json');

if (!tsBaseUrl || !dotnetBaseUrl) {
  console.error('Missing TS_BASE_URL or DOTNET_BASE_URL.');
  console.error('Example: node scripts/equivalence/run-equivalence.mjs --tsBaseUrl=http://localhost:5174 --dotnetBaseUrl=http://localhost:5050');
  process.exit(2);
}

const scenariosDoc = JSON.parse(await readFile(scenarioPath, 'utf8'));
const allowlistDoc = JSON.parse(await readFile(allowlistPath, 'utf8'));
const fixturePath = path.resolve(repoRoot, scenariosDoc.resetFixture ?? 'fixtures/golden/trier-v1.json');
const resetFixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const todayIsoDate = new Date().toISOString().slice(0, 10);

const { compiledAllowlistEntries, allowlistValidationErrors } = compileAllowlist(allowlistDoc, todayIsoDate);

const runtimes = [
  createTypescriptAdapter(tsBaseUrl),
  createDotnetAdapter(dotnetBaseUrl),
];

const report = {
  generatedAtUtc: new Date().toISOString(),
  scenariosFile: path.relative(repoRoot, scenarioPath),
  allowlistFile: path.relative(repoRoot, allowlistPath),
  fixture: path.relative(repoRoot, fixturePath),
  summary: {
    blocked: 0,
    allowed: 0,
    allowlistValidationErrors: allowlistValidationErrors.length,
  },
  allowlistValidationErrors,
  mismatches: [],
  scenarios: [],
};

const NON_SEMANTIC_KEYS = new Set([
  '__v',
  '_etag',
  '_rid',
  '_self',
  '_attachments',
  '_ts',
  'etag',
  'rowVersion',
  'lastModifiedAt',
  'lastModifiedAtUtc',
  'lastModifiedBy',
  'updatedAt',
  'updatedAtUtc',
  'createdAt',
  'createdAtUtc',
  'createdBy',
  'metadata',
]);

const ALIAS_TO_CANONICAL_FIELD = {
  cultivarID: 'cultivarId',
  cropID: 'cropId',
  speciesID: 'speciesId',
  segmentID: 'segmentId',
  bedID: 'bedId',
  pathID: 'pathId',
  batchID: 'batchId',
  planID: 'planId',
  plantingPlanId: 'planId',
  seedInventoryId: 'seedInventoryItemId',
};

for (const scenario of scenariosDoc.scenarios ?? []) {
  const runResults = {};

  for (const runtime of runtimes) {
    await runtime.resetState(resetFixture);

    const stepObservations = [];
    for (const step of scenario.steps ?? []) {
      stepObservations.push(await runStep(runtime, step));
    }

    const finalState = await runtime.loadFinalState();
    assertSuccessfulResponse(runtime.name, 'loadFinalState', finalState);
    const finalStateRaw = canonicalize(finalState.body);
    const finalStateProjected = projectFinalState(finalStateRaw);
    runResults[runtime.name] = {
      stepObservations,
      finalStateRaw,
      finalStateProjected,
    };
  }

  const scenarioMismatches = [];
  compareStepObservations(`scenario:${scenario.id}:stepObservations`, runResults.typescript.stepObservations, runResults.dotnet.stepObservations, scenarioMismatches);
  compareValues(
    `scenario:${scenario.id}:finalState`,
    runResults.typescript.finalStateProjected,
    runResults.dotnet.finalStateProjected,
    scenarioMismatches,
  );

  const classifiedMismatches = scenarioMismatches.map((mismatch) =>
    classifyMismatch(mismatch, scenario.id, compiledAllowlistEntries),
  );

  report.scenarios.push({
    id: scenario.id,
    name: scenario.name,
    steps: scenario.steps?.length ?? 0,
    snapshots: {
      typescript: {
        raw: runResults.typescript.finalStateRaw,
        projected: runResults.typescript.finalStateProjected,
      },
      dotnet: {
        raw: runResults.dotnet.finalStateRaw,
        projected: runResults.dotnet.finalStateProjected,
      },
    },
    mismatches: classifiedMismatches,
  });

  report.mismatches.push(...classifiedMismatches);
}

report.summary.blocked = report.mismatches.filter((mismatch) => mismatch.classification === 'blocked').length;
report.summary.allowed = report.mismatches.filter((mismatch) => mismatch.classification === 'allowed').length;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (allowlistValidationErrors.length > 0) {
  console.error(`Allowlist validation errors: ${allowlistValidationErrors.length}`);
  for (const error of allowlistValidationErrors.slice(0, 20)) {
    console.error(`- ${error}`);
  }
}

if (report.summary.blocked > 0) {
  console.error(`Blocked equivalence mismatches: ${report.summary.blocked}`);
  for (const mismatch of report.mismatches.filter((item) => item.classification === 'blocked').slice(0, 20)) {
    console.error(`- [${mismatch.scenarioId}] ${mismatch.path}: ${mismatch.reason}`);
  }
}

if (allowlistValidationErrors.length > 0 || report.summary.blocked > 0) {
  process.exit(1);
}

console.log(`Equivalence suite passed (${report.scenarios.length} scenarios).`);
if (report.summary.allowed > 0) {
  console.log(`Allowed mismatches (tracked debt): ${report.summary.allowed}`);
}
console.log(`Report written to ${path.relative(repoRoot, outputPath)}`);

function compileAllowlist(allowlist, todayDate) {
  const entries = Array.isArray(allowlist?.entries) ? allowlist.entries : [];
  const compiledAllowlistEntries = [];
  const validationErrors = [];

  for (const [index, entry] of entries.entries()) {
    const label = `entries[${index}]`;
    if (!entry || typeof entry !== 'object') {
      validationErrors.push(`${label}: must be an object`);
      continue;
    }

    if (typeof entry.scenarioId !== 'string' || entry.scenarioId.trim().length === 0) {
      validationErrors.push(`${label}: scenarioId is required`);
      continue;
    }

    if (typeof entry.owner !== 'string' || entry.owner.trim().length === 0) {
      validationErrors.push(`${label}: owner is required`);
      continue;
    }

    if (typeof entry.expiresOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expiresOn)) {
      validationErrors.push(`${label}: expiresOn must be an ISO date (YYYY-MM-DD)`);
      continue;
    }

    if (entry.expiresOn < todayDate) {
      validationErrors.push(`${label}: expired on ${entry.expiresOn}`);
      continue;
    }

    let pathRegex;
    let reasonRegex;
    try {
      pathRegex = new RegExp(entry.pathPattern);
    } catch (error) {
      validationErrors.push(`${label}: invalid pathPattern regex (${error.message})`);
      continue;
    }

    try {
      reasonRegex = new RegExp(entry.reasonPattern);
    } catch (error) {
      validationErrors.push(`${label}: invalid reasonPattern regex (${error.message})`);
      continue;
    }

    compiledAllowlistEntries.push({
      scenarioId: entry.scenarioId,
      owner: entry.owner,
      expiresOn: entry.expiresOn,
      pathPattern: entry.pathPattern,
      reasonPattern: entry.reasonPattern,
      pathRegex,
      reasonRegex,
    });
  }

  return { compiledAllowlistEntries, allowlistValidationErrors: validationErrors };
}

function classifyMismatch(mismatch, scenarioId, allowlistEntries) {
  const matchedEntry = allowlistEntries.find(
    (entry) =>
      entry.scenarioId === scenarioId && entry.pathRegex.test(mismatch.path) && entry.reasonRegex.test(mismatch.reason),
  );

  return {
    ...mismatch,
    scenarioId,
    classification: matchedEntry ? 'allowed' : 'blocked',
    allowlist: matchedEntry
      ? {
          pathPattern: matchedEntry.pathPattern,
          reasonPattern: matchedEntry.reasonPattern,
          scenarioId: matchedEntry.scenarioId,
          owner: matchedEntry.owner,
          expiresOn: matchedEntry.expiresOn,
        }
      : null,
  };
}

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
    observation: canonicalize(buildStepObservation(step, response)),
  };
}

function buildStepObservation(step, response) {
  switch (step.op) {
    case 'createSpecies':
    case 'createCrop':
    case 'createCultivar':
    case 'createSegment':
    case 'createBed':
    case 'createPath':
    case 'createSeedInventoryItem':
    case 'createCropPlan':
      return {
        createdEntityId: extractEntityId(step.input, response.body),
      };
    case 'createBatch':
      return {
        createdBatchId: extractEntityId(step.input, response.body),
      };
    case 'assignBatchToBed':
      return {
        assignmentPresent: hasAssignment(response.body, step.input?.bedId),
      };
    case 'listBatchesByBed':
      return {
        batchIds: collectBatchIds(response.body),
      };
    case 'validateBatch':
      return {
        issues: collectValidationIssues(response.body),
      };
    case 'reloadState':
      return {
        stateLoaded: response.body !== null && response.body !== undefined,
      };
    default:
      return {};
  }
}

function extractEntityId(input, body) {
  return (
    body?.id ??
    body?.cropId ??
    body?.batchId ??
    body?.segmentId ??
    body?.bedId ??
    body?.pathId ??
    body?.seedInventoryItemId ??
    body?.planId ??
    input?.id ??
    input?.batchId ??
    null
  );
}

function hasAssignment(body, bedId) {
  const assignments = Array.isArray(body?.assignments) ? body.assignments : [];
  return assignments.some((assignment) => assignment?.bedId === bedId);
}

function collectBatchIds(body) {
  const batches = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
  return batches
    .map((batch) => batch?.batchId ?? batch?.id ?? null)
    .filter((id) => id !== null)
    .sort((left, right) => left.localeCompare(right));
}

function collectValidationIssues(body) {
  const rawIssues = Array.isArray(body)
    ? body
    : Array.isArray(body?.issues)
      ? body.issues
      : Array.isArray(body?.errors)
        ? body.errors
        : [];

  return rawIssues
    .map((issue) => ({
      code: typeof issue?.code === 'string' ? issue.code : null,
      path: normalizeIssuePath(issue?.path ?? issue?.field ?? issue?.propertyPath ?? issue?.source?.pointer ?? ''),
      messageCategory: normalizeMessageCategory(issue?.message ?? issue?.error ?? issue?.title ?? ''),
    }))
    .sort(compareIssueTuples);
}

function normalizeIssuePath(pathLike) {
  if (Array.isArray(pathLike)) {
    return pathLike.map((segment) => String(segment)).join('.');
  }

  const raw = String(pathLike ?? '').trim();
  if (raw.length === 0) {
    return '$';
  }

  return raw
    .replace(/^\$\.?/, '')
    .replace(/^\//, '')
    .replace(/\//g, '.')
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\.+/g, '.')
    .replace(/^\./, '')
    .toLowerCase();
}

function normalizeMessageCategory(messageLike) {
  const message = String(messageLike ?? '').toLowerCase();

  if (message.includes('required') || message.includes('missing')) {
    return 'missing_required';
  }
  if (message.includes('not found') || message.includes('unknown')) {
    return 'not_found';
  }
  if (message.includes('invalid') || message.includes('must') || message.includes('format')) {
    return 'invalid_value';
  }
  if (message.includes('duplicate') || message.includes('already exists')) {
    return 'conflict';
  }
  if (message.includes('range') || message.includes('greater') || message.includes('less')) {
    return 'out_of_range';
  }

  return message.length === 0 ? 'unknown' : 'other';
}

function compareIssueTuples(left, right) {
  return `${left.code ?? ''}|${left.path}|${left.messageCategory}`.localeCompare(
    `${right.code ?? ''}|${right.path}|${right.messageCategory}`,
  );
}

function compareStepObservations(currentPath, left, right, mismatches) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    mismatches.push({ path: currentPath, reason: 'step observations must both be arrays' });
    return;
  }

  if (left.length !== right.length) {
    mismatches.push({ path: currentPath, reason: `array length mismatch (${left.length} !== ${right.length})` });
  }

  const count = Math.min(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    compareStepObservation(`${currentPath}[${index}]`, left[index], right[index], mismatches);
  }
}

function compareStepObservation(currentPath, leftStep, rightStep, mismatches) {
  if (leftStep.op !== rightStep.op) {
    mismatches.push({ path: `${currentPath}.op`, reason: `operation mismatch (${leftStep.op} !== ${rightStep.op})` });
    return;
  }

  if (leftStep.op === 'validateBatch') {
    compareValidationIssues(`${currentPath}.observation.issues`, leftStep.observation.issues, rightStep.observation.issues, mismatches);
    return;
  }

  compareValues(`${currentPath}.observation`, leftStep.observation, rightStep.observation, mismatches);
}

function compareValidationIssues(currentPath, leftIssues, rightIssues, mismatches) {
  if (!Array.isArray(leftIssues) || !Array.isArray(rightIssues)) {
    mismatches.push({ path: currentPath, reason: 'validation issues must both be arrays' });
    return;
  }

  const leftTuples = new Set(leftIssues.map((issue) => `${issue.code ?? ''}|${issue.path}|${issue.messageCategory}`));
  const rightTuples = new Set(rightIssues.map((issue) => `${issue.code ?? ''}|${issue.path}|${issue.messageCategory}`));

  for (const tuple of [...leftTuples].sort((a, b) => a.localeCompare(b))) {
    if (!rightTuples.has(tuple)) {
      mismatches.push({ path: currentPath, reason: `missing issue tuple in dotnet output (${tuple})` });
    }
  }

  for (const tuple of [...rightTuples].sort((a, b) => a.localeCompare(b))) {
    if (!leftTuples.has(tuple)) {
      mismatches.push({ path: currentPath, reason: `missing issue tuple in typescript output (${tuple})` });
    }
  }
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

function projectFinalState(value) {
  return projectNode(value);
}

function projectNode(value) {
  if (Array.isArray(value)) {
    const projectedItems = value.map((item) => projectNode(item));
    return sortEntityArray(projectedItems);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const projected = {};
  for (const [rawKey, rawChild] of Object.entries(value)) {
    if (isNonSemanticField(rawKey)) {
      continue;
    }

    const key = ALIAS_TO_CANONICAL_FIELD[rawKey] ?? rawKey;
    const child = projectNode(rawChild);

    // Treat null and missing as equivalent for default/optional fields.
    if (child === null || child === undefined) {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(projected, key)) {
      projected[key] = mergeAliasValues(projected[key], child);
      continue;
    }

    projected[key] = child;
  }

  return projected;
}

function isNonSemanticField(key) {
  if (NON_SEMANTIC_KEYS.has(key)) {
    return true;
  }

  return key.startsWith('_') || key.endsWith('Timestamp') || key.endsWith('Utc');
}

function mergeAliasValues(existing, incoming) {
  if (existing === incoming) {
    return existing;
  }

  if (Array.isArray(existing) && Array.isArray(incoming)) {
    const merged = [...existing, ...incoming];
    return sortEntityArray(merged);
  }

  return existing ?? incoming;
}

function sortEntityArray(items) {
  if (!items.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
    return items;
  }

  const stableSortKey = chooseStableSortKey(items);
  if (!stableSortKey) {
    return items;
  }

  return [...items].sort((left, right) => String(left[stableSortKey]).localeCompare(String(right[stableSortKey])));
}

function chooseStableSortKey(items) {
  const preferredKeys = ['id'];
  const objectKeys = new Set(items.flatMap((item) => Object.keys(item)));
  const idLikeKeys = [...objectKeys].filter((key) => key.toLowerCase().endsWith('id'));
  preferredKeys.push(...idLikeKeys.sort((left, right) => left.localeCompare(right)));

  for (const key of preferredKeys) {
    const allHavePrimitive = items.every((item) => {
      const value = item[key];
      return value !== null && value !== undefined && ['string', 'number', 'boolean'].includes(typeof value);
    });
    if (allHavePrimitive) {
      return key;
    }
  }

  return null;
}
