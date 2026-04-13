const DEFAULT_MAX_DIFFS = 20;

type CanonicalJsonObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const normalizeForDiff = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForDiff(item));
  }

  if (isPlainObject(value)) {
    const normalizedEntries = Object.keys(value)
      .sort()
      .map((key) => [key, normalizeForDiff(value[key])] as const);
    return Object.fromEntries(normalizedEntries);
  }

  return value;
};

const formatValue = (value: unknown): string => JSON.stringify(normalizeForDiff(value));

export const summarizeParityDiffs = (
  expectedTs: CanonicalJsonObject,
  actualBackend: CanonicalJsonObject,
  maxDiffs: number = DEFAULT_MAX_DIFFS,
): string[] => {
  const diffs: string[] = [];
  let truncated = false;

  const pushDiff = (message: string): void => {
    if (diffs.length < maxDiffs) {
      diffs.push(message);
      return;
    }

    truncated = true;
  };

  const visit = (expectedValue: unknown, actualValue: unknown, path: string): void => {
    if (truncated) {
      return;
    }

    if (Object.is(expectedValue, actualValue)) {
      return;
    }

    if (Array.isArray(expectedValue) && Array.isArray(actualValue)) {
      if (expectedValue.length !== actualValue.length) {
        pushDiff(`${path}: expected length ${expectedValue.length}, actual length ${actualValue.length}`);
      }

      const maxLength = Math.max(expectedValue.length, actualValue.length);
      for (let index = 0; index < maxLength; index += 1) {
        visit(expectedValue[index], actualValue[index], `${path}[${index}]`);
        if (truncated) {
          return;
        }
      }
      return;
    }

    if (isPlainObject(expectedValue) && isPlainObject(actualValue)) {
      const keys = [...new Set([...Object.keys(expectedValue), ...Object.keys(actualValue)])].sort();
      for (const key of keys) {
        visit(expectedValue[key], actualValue[key], path === '$' ? `$.${key}` : `${path}.${key}`);
        if (truncated) {
          return;
        }
      }
      return;
    }

    pushDiff(`${path}: expected ${formatValue(expectedValue)}, actual ${formatValue(actualValue)}`);
  };

  visit(normalizeForDiff(expectedTs), normalizeForDiff(actualBackend), '$');

  if (truncated) {
    diffs.push(`...truncated after first ${maxDiffs} diffs`);
  }

  return diffs;
};
