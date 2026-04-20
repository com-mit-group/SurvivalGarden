/**
 * GENERATED FILE - DO NOT EDIT.
 * Backend OpenAPI unavailable; generated fallback client shim.
 */

export type BackendApiPath = string;

export const backendApiFetch = async <T>(path: BackendApiPath, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(`Backend API request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
};
