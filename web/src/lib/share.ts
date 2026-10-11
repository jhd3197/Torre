// Share links. On torre.sh the gateway mints a public link to a game (or one of its moves) at
// auth/share; the link then goes to the system share sheet, or to the clipboard where there is
// none. Running on your own computer there is no gateway and no public URL, so sharing falls back
// to what the page did before (copying the PGN).

/** Why the gateway would not make a link: signed out, unknown game, too many links, or anything else. */
export type ShareFailure = 'signedOut' | 'notFound' | 'tooMany' | 'failed';

export class ShareError extends Error {
  constructor(readonly reason: ShareFailure) {
    super(reason);
    this.name = 'ShareError';
  }
}

const FAILURES: Record<number, ShareFailure> = { 401: 'signedOut', 403: 'signedOut', 404: 'notFound', 429: 'tooMany' };

/** Ask the gateway for a public link to `game`, opened at `ply` (null: the game as a whole). */
export async function requestShareLink(game: string, ply: number | null = null, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch('auth/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ game, ply }),
      signal,
    });
  } catch {
    throw new ShareError('failed');
  }
  if (!response.ok) throw new ShareError(FAILURES[response.status] ?? 'failed');
  const data = await response.json().catch(() => null) as { url?: unknown } | null;
  if (typeof data?.url !== 'string' || !data.url) throw new ShareError('failed');
  return data.url;
}

/** What happened to a link: the share sheet took it, it was copied, or the sheet was dismissed. */
export type Delivery = 'shared' | 'copied' | 'dismissed';

/** Hand `url` to the system share sheet where there is one, else copy it. Throws when it cannot copy. */
export async function deliverLink(url: string, title: string, text: string): Promise<Delivery> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const data = { title, text, url };
  if (nav?.share && (!nav.canShare || nav.canShare(data))) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (error) {
      // Closing the sheet is a choice, not a failure; anything else falls through to the clipboard.
      if ((error as Error)?.name === 'AbortError') return 'dismissed';
    }
  }
  await nav!.clipboard.writeText(url);
  return 'copied';
}

export interface ShareRequest {
  /** The game's id in this studio. */
  game: string;
  /** The move to open the link on, or null for the whole game. */
  ply?: number | null;
  /** The share sheet's title and line of text. */
  title: string;
  text: string;
}

export interface ShareDeps {
  /** Whether the app runs behind the torre.sh gateway (useHostedAccount is not null). */
  hosted: boolean;
  /** What sharing means without a gateway: the page's own copy (the PGN). */
  fallback: () => void | Promise<void>;
  toast: (message: string) => void;
  /** The toast lines, already translated. */
  messages: { copied: string; failed: Record<ShareFailure, string> };
}

/** Share a game or a move: a link when hosted, the fallback otherwise. Never throws; it toasts. */
export async function shareGame(request: ShareRequest, deps: ShareDeps): Promise<Delivery | 'fallback' | 'failed'> {
  if (!deps.hosted) {
    await deps.fallback();
    return 'fallback';
  }
  let url: string;
  try {
    url = await requestShareLink(request.game, request.ply ?? null);
  } catch (error) {
    deps.toast(deps.messages.failed[error instanceof ShareError ? error.reason : 'failed']);
    return 'failed';
  }
  try {
    const delivery = await deliverLink(url, request.title, request.text);
    if (delivery === 'copied') deps.toast(deps.messages.copied);
    return delivery;
  } catch {
    deps.toast(deps.messages.failed.failed);
    return 'failed';
  }
}
