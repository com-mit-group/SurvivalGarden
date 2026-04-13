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
const cutoverCriteriaPath = path.resolve(repoRoot, args.get('--cutoverCriteria') ?? 'fixtures/equivalence/cutover-criteria.v1.json');
const tsBaseUrl = (args.get('--tsBaseUrl') ?? process.env.TS_BASE_URL ?? '').replace(/\/$/, '');
const dotnetBaseUrl = (args.get('--dotnetBaseUrl') ?? process.env.DOTNET_BASE_URL ?? '').replace(/\/$/, '');
const outputPath = path.resolve(repoRoot, args.get('--out') ?? 'artifacts/equivalence-report.json');
const rolloutReportPath = path.resolve(repoRoot, args.get('--rolloutOut') ?? 'artifacts/equivalence-rollout-report.json');
const flipWorkflows = parseCsvArg(args.get('--flipWorkflows'));

if (!tsBaseUrl || !dotnetBaseUrl) {
  console.error('Missing TS_BASE_URL or DOTNET_BASE_URL.');
  console.error('Example: node scripts/equivalence/run-equivalence.mjs --tsBaseUrl=http://localhost:5174 --dotnetBaseUrl=http://localhost:5050');
  process.exit(2);
}

const scenariosDoc = JSON.parse(await readFile(scenarioPath, 'utf8'));
const allowlistDoc = JSON.parse(await readFile(allowlistPath, 'utf8'));
const cutoverCriteriaDoc = JSON.parse(await readFile(cutoverCriteriaPath, 'utf8'));
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
    totalAssertions: 0,
    blockingFailures: 0,
    allowlistedDifferences: 0,
    suggestedNextAction: 'Review scenario-level mismatches for next steps.',
    blocked: 0,
    allowed: 0,
    allowlistValidationErrors: allowlistValidationErrors.length,
  },
  allowlistValidationErrors,
  allowedMismatches: [],
  blockingMismatches: [],
  mismatches: [],
  scenarios: [],
};

const rolloutReport = {
  generatedAtUtc: new Date().toISOString(),
  sourceMode: 'dual-path',
  scenarioFile: path.relative(repoRoot, scenarioPath),
  cutoverCriteriaFile: path.relative(repoRoot, cutoverCriteriaPath),
  outputReportFile: path.relative(repoRoot, outputPath),
  boundaries: [],
  workflows: {},
  summary: {
    totalBoundaries: 0,
    succeeded: 0,
    failed: 0,
    validationMismatches: 0,
    requestedCutoverWorkflows: flipWorkflows,
    blockedCutovers: [],
  },
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

  const stepObservationDiff = [];
  compareStepObservations(
    `scenario:${scenario.id}:stepObservations`,
    runResults.typescript.stepObservations,
    runResults.dotnet.stepObservations,
    stepObservationDiff,
  );

  const projectedStateDiff = [];
  compareValues(
    `scenario:${scenario.id}:finalState`,
    runResults.typescript.finalStateProjected,
    runResults.dotnet.finalStateProjected,
    projectedStateDiff,
  );

  const rawStateDiff = [];
  compareValues(`scenario:${scenario.id}:finalStateRaw`, runResults.typescript.finalStateRaw, runResults.dotnet.finalStateRaw, rawStateDiff);

  recordBoundaryOutcomes({
    rolloutReport,
    scenario,
    runResults,
    stepObservationDiff,
    projectedStateDiff,
  });

  const semanticMismatchCandidates = [...stepObservationDiff, ...projectedStateDiff];
  const classifiedSemanticMismatches = semanticMismatchCandidates.map((mismatch) =>
    classifyMismatch(mismatch, scenario.id, compiledAllowlistEntries),
  );
  const classifiedRawStateDiff = rawStateDiff.map((mismatch) => classifyMismatch(mismatch, scenario.id, compiledAllowlistEntries));

  const blockingMismatches = classifiedSemanticMismatches.filter((mismatch) => mismatch.classification === 'blocked');
  const allowedMismatches = classifiedSemanticMismatches.filter((mismatch) => mismatch.classification === 'allowed');

  report.scenarios.push({
    id: scenario.id,
    name: scenario.name,
    steps: scenario.steps?.length ?? 0,
    semanticAssertions: [
      {
        id: 'stepObservationsEquivalent',
        pass: stepObservationDiff.length === 0,
        failureCount: stepObservationDiff.length,
      },
      {
        id: 'projectedStateEquivalent',
        pass: projectedStateDiff.length === 0,
        failureCount: projectedStateDiff.length,
      },
    ],
    projectedStateDiff: classifiedSemanticMismatches.filter((mismatch) => mismatch.path.includes(':finalState')),
    rawStateDiff: classifiedRawStateDiff,
    blockingMismatches,
    allowedMismatches,
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
    mismatches: classifiedSemanticMismatches,
  });

  report.mismatches.push(...classifiedSemanticMismatches);
  report.blockingMismatches.push(...blockingMismatches);
  report.allowedMismatches.push(...allowedMismatches);
  report.summary.totalAssertions += 2;
}

report.summary.blocked = report.mismatches.filter((mismatch) => mismatch.classification === 'blocked').length;
report.summary.allowed = report.mismatches.filter((mismatch) => mismatch.classification === 'allowed').length;
report.summary.blockingFailures = report.summary.blocked;
report.summary.allowlistedDifferences = report.summary.allowed;
report.summary.suggestedNextAction =
  report.summary.blockingFailures > 0
    ? 'Investigate blocking mismatches in projectedStateDiff and semanticAssertions.'
    : report.summary.allowlistedDifferences > 0
      ? 'No blockers found; review allowlisted differences and retire debt where possible.'
      : 'No mismatches detected; proceed with cutover checks.';

rolloutReport.summary.totalBoundaries = rolloutReport.boundaries.length;
rolloutReport.summary.succeeded = rolloutReport.boundaries.filter((entry) => entry.success).length;
rolloutReport.summary.failed = rolloutReport.boundaries.filter((entry) => !entry.success).length;
rolloutReport.summary.validationMismatches = rolloutReport.boundaries.filter((entry) => entry.validationMismatch).length;
rolloutReport.workflows = evaluateWorkflowRollout(rolloutReport.boundaries, cutoverCriteriaDoc, flipWorkflows);
rolloutReport.summary.blockedCutovers = Object.values(rolloutReport.workflows)
  .filter((workflow) => workflow.cutoverRequested && !workflow.cutoverAllowed)
  .map((workflow) => workflow.workflow);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await mkdir(path.dirname(rolloutReportPath), { recursive: true });
await writeFile(rolloutReportPath, `${JSON.stringify(rolloutReport, null, 2)}\n`, 'utf8');

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
  logConsoleSummary(report);
  process.exit(1);
}

if (rolloutReport.summary.blockedCutovers.length > 0) {
  console.error(`Cutover blocked for workflows: ${rolloutReport.summary.blockedCutovers.join(', ')}`);
  process.exit(1);
}

logConsoleSummary(report);
console.log(`Equivalence suite passed (${report.scenarios.length} scenarios).`);
console.log(`Report written to ${path.relative(repoRoot, outputPath)}`);
console.log(`Rollout report written to ${path.relative(repoRoot, rolloutReportPath)}`);

function parseCsvArg(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function recordBoundaryOutcomes({ rolloutReport, scenario, runResults, stepObservationDiff, projectedStateDiff }) {
  const mismatchPaths = new Set([...stepObservationDiff, ...projectedStateDiff].map((mismatch) => mismatch.path));
  const stepCount = Math.min(runResults.typescript.stepObservations.length, runResults.dotnet.stepObservations.length);

  for (let index = 0; index < stepCount; index += 1) {
    const tsStep = runResults.typescript.stepObservations[index];
    const dotnetStep = runResults.dotnet.stepObservations[index];
    const boundaryPath = `scenario:${scenario.id}:stepObservations[${index}]`;
    const failed = [...mismatchPaths].some((path) => path.startsWith(boundaryPath));
    const workflow = mapOpToWorkflow(tsStep.op);
    const validationMismatch = tsStep.op === 'validateBatch' && failed;

    rolloutReport.boundaries.push({
      workflow,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      boundaryId: `${scenario.id}:step:${index}:${tsStep.op}`,
      boundaryType: 'step',
      operation: tsStep.op,
      sourceMode: 'dual-path',
      success: !failed,
      validationMismatch,
      timingMs: {
        typescript: tsStep.timingMs,
        dotnet: dotnetStep.timingMs,
      },
    });
  }

  const projectedFailed = [...mismatchPaths].some((path) => path.startsWith(`scenario:${scenario.id}:finalState`));
  rolloutReport.boundaries.push({
    workflow: inferScenarioWorkflow(rolloutReport.boundaries, scenario.id),
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    boundaryId: `${scenario.id}:finalState`,
    boundaryType: 'finalState',
    operation: 'finalStateProjection',
    sourceMode: 'dual-path',
    success: !projectedFailed,
    validationMismatch: false,
    timingMs: {
      typescript: null,
      dotnet: null,
    },
  });
}

function inferScenarioWorkflow(boundaries, scenarioId) {
  const matches = boundaries.filter((entry) => entry.scenarioId === scenarioId && entry.boundaryType === 'step');
  return matches.length > 0 ? matches[0].workflow : 'unknown';
}

function mapOpToWorkflow(op) {
  if (op === 'validateBatch' || op === 'createSeedInventoryItem') {
    return 'inventory';
  }

  if (op === 'createCropPlan') {
    return 'tasks';
  }

  if (op === 'createSpecies' || op === 'createCrop' || op === 'createCultivar') {
    return 'taxonomy';
  }

  if (op === 'createSegment' || op === 'createBed' || op === 'createPath') {
    return 'bedsSegments';
  }

  if (op === 'createBatch' || op === 'assignBatchToBed' || op === 'listBatchesByBed') {
    return 'batches';
  }

  return 'shared';
}

function evaluateWorkflowRollout(boundaries, cutoverCriteriaDoc, flipWorkflows) {
  const criteriaByWorkflow = cutoverCriteriaDoc?.workflows ?? {};
  const workflows = {};
  const seen = new Set([...Object.keys(criteriaByWorkflow), ...boundaries.map((entry) => entry.workflow), ...flipWorkflows]);

  for (const workflow of [...seen].sort((left, right) => left.localeCompare(right))) {
    const entries = boundaries.filter((entry) => entry.workflow === workflow && entry.boundaryType === 'step');
    const failures = entries.filter((entry) => !entry.success).length;
    const mismatchRate = entries.length > 0 ? failures / entries.length : 1;
    const validationMismatches = entries.filter((entry) => entry.validationMismatch).length;
    const criteria = criteriaByWorkflow[workflow] ?? {
      minRuns: 1,
      maxMismatchRate: 0,
      maxValidationMismatches: 0,
    };
    const minRunsMet = entries.length >= criteria.minRuns;
    const mismatchRateMet = mismatchRate <= criteria.maxMismatchRate;
    const validationMismatchMet = validationMismatches <= criteria.maxValidationMismatches;
    const cutoverAllowed = minRunsMet && mismatchRateMet && validationMismatchMet;

    workflows[workflow] = {
      workflow,
      sourceMode: 'dual-path',
      cutoverRequested: flipWorkflows.includes(workflow),
      cutoverAllowed,
      criteria,
      observed: {
        runs: entries.length,
        failures,
        mismatchRate,
        validationMismatches,
      },
      checks: {
        minRunsMet,
        mismatchRateMet,
        validationMismatchMet,
      },
    };
  }

  return workflows;
}

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
  const startedAt = Date.now();
  const response = await runtime.executeStep(step);
  const timingMs = Date.now() - startedAt;
  assertSuccessfulResponse(runtime.name, step.op, response);
  assertStepExpectations(step, response);
  return normalizeStepResult(step, response, timingMs);
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

function normalizeStepResult(step, response, timingMs) {
  return {
    op: step.op,
    timingMs,
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

function logConsoleSummary(reportDocument) {
  console.log('Equivalence summary:');
  console.log(`- total assertions: ${reportDocument.summary.totalAssertions}`);
  console.log(`- blocking failures: ${reportDocument.summary.blockingFailures}`);
  console.log(`- allowlisted differences: ${reportDocument.summary.allowlistedDifferences}`);
  console.log(`- suggested next action: ${reportDocument.summary.suggestedNextAction}`);
}
