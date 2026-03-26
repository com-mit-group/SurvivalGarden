import type { AppState, Settings } from '../../contracts';
import { assertValid } from '../validation';

const normalizeSettingsCandidate = (value: unknown): unknown => value ?? {};

const buildDefaultSettings = (): Settings => {
  const now = new Date().toISOString();

  return assertValid('settings', {
    settingsId: 'settings-default',
    locale: 'de-DE',
    timezone: 'Europe/Berlin',
    weekStartsOn: 'monday',
    units: {
      temperature: 'celsius',
      yield: 'metric',
    },
    createdAt: now,
    updatedAt: now,
  });
};

export const getSettingsFromAppState = (appState: unknown): Settings => {
  const state = assertValid('appState', appState);
  return assertValid('settings', normalizeSettingsCandidate(state.settings));
};

export const saveSettingsInAppState = (appState: unknown, settings: unknown): AppState => {
  const state = assertValid('appState', appState);
  const validSettings = assertValid('settings', normalizeSettingsCandidate(settings));

  return assertValid('appState', {
    ...state,
    settings: validSettings,
  });
};

export const getSettingsOrDefault = (settings: unknown): Settings => {
  try {
    return assertValid('settings', normalizeSettingsCandidate(settings));
  } catch {
    return buildDefaultSettings();
  }
};
