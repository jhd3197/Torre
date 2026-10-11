// All requests use relative URLs so the app also works under a proxy prefix (Vela's /apps/chess/).
import i18n from '../i18n';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** The language the server should answer in (lesson text, puzzle themes, awards, errors). */
const lang = () => i18n.language || 'en';

export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = body === undefined
    ? { signal, headers: { 'X-Lang': lang() } }
    : { method: 'POST', signal, body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'X-Chess-Studio': '1', 'X-Lang': lang() } };
  const response = await fetch(path, init);
  let data: unknown = null;
  try { data = await response.json(); } catch { /* empty or non-JSON body */ }
  if (!response.ok) {
    const message = (data as { error?: string } | null)?.error ?? 'Something went wrong. Please try again.';
    throw new ApiError(message, response.status);
  }
  return data as T;
}
