import { describe, expect, it, vi } from 'vitest';
import {
  SchemaValidationError,
  assertValid,
  parseImportedAppState,
  serializeAppStateForExport,
  saveAppStateToStorage,
  getBedFromAppState,
  listBedsFromAppState,
  upsertBedInAppState,
} from '..';

const goldenFixtures = import.meta.glob('../../../../fixtures/golden/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

const pathSegmentWildcard = '*';
const nonRoundtrippedPaths = ['/photos/*/blob', '/photos/*/blobBase64'];

const pathMatches = (path: string, pattern: string): boolean => {
  const pathParts = path.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);

  if (pathParts.length !== patternParts.length) {
    return false;
  }

  return patternParts.every(
    (patternPart, index) => patternPart === pathSegmentWildcard || patternPart === pathParts[index],
  );
};


const validBed = {
  bedId: 'bed-1',
  gardenId: 'garden-1',
  name: 'Bed 1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
};

const validAppState = {
  schemaVersion: 1,
  beds: [validBed],
  crops: [],
  cropPlans: [],
  tasks: [],
  seedInventoryItems: [],
  settings: {
    settingsId: 'settings-1',
    locale: 'de-DE',
    timezone: 'Europe/Berlin',
    units: {
      temperature: 'celsius',
      yield: 'metric',
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
};

const canonicalizeForComparison = (value: unknown, path = '/'): unknown => {
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalizeForComparison(item, `${path}${path.endsWith('/') ? '' : '/'}${index}`));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => {
          const keyPath = `${path}${path.endsWith('/') ? '' : '/'}${key}`;
          return !nonRoundtrippedPaths.some((pattern) => pathMatches(keyPath, pattern));
        })
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => {
          const keyPath = `${path}${path.endsWith('/') ? '' : '/'}${key}`;
          return [key, canonicalizeForComparison(nestedValue, keyPath)];
        }),
    );
  }

  return value;
};

describe('assertValid', () => {
  it('throws normalized validation issues for invalid appState payloads', () => {
    expect(() => assertValid('appState', { schemaVersion: 0 })).toThrowError(
      SchemaValidationError,
    );

    try {
      assertValid('appState', { schemaVersion: 0 });
    } catch (error) {
      const validationError = error as SchemaValidationError;
      expect(validationError.schemaName).toBe('appState');
      expect(validationError.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            schemaName: 'appState',
            path: '/schemaVersion',
            keyword: 'minimum',
          }),
          expect.objectContaining({
            schemaName: 'appState',
            path: '/',
            keyword: 'required',
            message: expect.stringContaining("must have required property 'beds'"),
          }),
        ]),
      );
    }
  });

  it('throws readable error paths for nested contracts', () => {
    expect(() =>
      assertValid('bed', {
        bedId: 'bed-1',
        gardenId: 'garden-1',
        name: 'Bed 1',
        createdAt: 'not-a-date',
        updatedAt: '2024-01-01T00:00:00Z',
      }),
    ).toThrowError(SchemaValidationError);

    try {
      assertValid('bed', {
        bedId: 'bed-1',
        gardenId: 'garden-1',
        name: 'Bed 1',
        createdAt: 'not-a-date',
        updatedAt: '2024-01-01T00:00:00Z',
      });
    } catch (error) {
      const validationError = error as SchemaValidationError;
      expect(validationError.schemaName).toBe('bed');
      expect(validationError.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            schemaName: 'bed',
            path: '/createdAt',
            keyword: 'pattern',
          }),
        ]),
      );
    }
  });
});

describe('data boundary validation', () => {
  it('rejects invalid imported app state JSON payloads', () => {
    expect(() => parseImportedAppState('{"schemaVersion":0}')).toThrowError(
      SchemaValidationError,
    );
  });

  it('rejects invalid app state before storage persistence', () => {
    const setItem = vi.fn();
    const storage = { setItem };

    expect(() => saveAppStateToStorage(storage, 'survival-garden', { schemaVersion: 0 })).toThrowError(
      SchemaValidationError,
    );
    expect(setItem).not.toHaveBeenCalled();
  });

  it('roundtrips golden fixtures through export/import/export losslessly', () => {
    const fixturePaths = Object.keys(goldenFixtures).sort();
    expect(fixturePaths.length).toBeGreaterThan(0);

    for (const fixturePath of fixturePaths) {
      const fixture = goldenFixtures[fixturePath];
      const firstExport = serializeAppStateForExport(fixture);
      const imported = parseImportedAppState(firstExport);
      const secondExport = serializeAppStateForExport(imported);

      expect(canonicalizeForComparison(JSON.parse(secondExport))).toEqual(
        canonicalizeForComparison(JSON.parse(firstExport)),
      );
    }
  });

  it('preserves photo metadata in roundtrip while excluding blob payload paths by design', () => {
    const fixture = goldenFixtures['../../../../fixtures/golden/trier-v1.json'];
    const exported = serializeAppStateForExport(fixture);
    const imported = parseImportedAppState(exported);

    expect(canonicalizeForComparison(imported)).toEqual(canonicalizeForComparison(JSON.parse(exported)));
  });
});


describe('bed repository boundary helpers', () => {
  it('rejects invalid bed payloads on create/update via upsert', () => {
    expect(() => upsertBedInAppState(validAppState, null)).toThrowError(SchemaValidationError);
    expect(() =>
      upsertBedInAppState(validAppState, {
        ...validBed,
        createdAt: 'invalid-date',
      }),
    ).toThrowError(SchemaValidationError);
  });

  it('returns typed beds from read paths and normalizes missing records to null', () => {
    expect(getBedFromAppState(validAppState, validBed.bedId)).toEqual(validBed);
    expect(getBedFromAppState(validAppState, 'missing-bed')).toBeNull();
    expect(listBedsFromAppState(validAppState)).toEqual([validBed]);
  });
});
