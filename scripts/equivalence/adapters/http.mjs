export async function api(baseUrl, method, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
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

export function assertSuccessfulResponse(runtimeName, operation, response) {
  if (response.status >= 200 && response.status < 300) {
    return;
  }

  const hint = response.status === 404 ? ' (check base URL points at backend API, not the frontend dev server)' : '';
  throw new Error(`${runtimeName} ${operation} failed with ${response.status}${hint}`);
}

export function canonicalize(value) {
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
