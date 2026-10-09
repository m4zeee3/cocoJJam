import { API_URL } from '@/constants/config';

/** No connection, or the server didn't answer in time (UC-11.2 alt, 11.5). */
export class OfflineError extends Error {}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const apiConfigured = () => API_URL.length > 0;

/** JSON request to the sync backend with a timeout; throws OfflineError when unreachable. */
export async function api<T>(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  if (!apiConfigured()) throw new OfflineError('Sync server not set (EXPO_PUBLIC_API_URL).');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch {
    throw new OfflineError("Can't reach the server.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail as string, () => res.statusText);
    throw new HttpError(res.status, detail || `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
