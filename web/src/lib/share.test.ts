import { deliverLink, requestShareLink, shareGame, ShareError, type ShareDeps } from './share';

const reply = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

function deps(extra: Partial<ShareDeps> = {}) {
  return {
    hosted: true, fallback: vi.fn(), toast: vi.fn(),
    messages: { copied: 'copied', failed: { signedOut: 'sign in', notFound: 'unknown', tooMany: 'slow down', failed: 'failed' } },
    ...extra,
  };
}

function clipboard() {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText }, share: undefined, canShare: undefined });
  return writeText;
}

test('asks the gateway for a link with the game and the move', async () => {
  const fetch = reply(200, { url: 'https://torre.sh/g/abc' });
  vi.stubGlobal('fetch', fetch);
  await expect(requestShareLink('g1', 12)).resolves.toBe('https://torre.sh/g/abc');
  const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe('auth/share');
  expect(init.method).toBe('POST');
  expect(init.credentials).toBe('include');
  expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  expect(JSON.parse(String(init.body))).toEqual({ game: 'g1', ply: 12 });
});

test.each([[401, 'signedOut'], [404, 'notFound'], [429, 'tooMany'], [500, 'failed']])('a %i reads as %s', async (status, reason) => {
  vi.stubGlobal('fetch', reply(status));
  await expect(requestShareLink('g1')).rejects.toEqual(new ShareError(reason as ShareError['reason']));
});

test('uses the share sheet when there is one, and a dismissed sheet is not an error', async () => {
  const share = vi.fn(async () => {});
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, share, clipboard: { writeText } });
  await expect(deliverLink('https://torre.sh/g/x', 'T', 'text')).resolves.toBe('shared');
  expect(share).toHaveBeenCalledWith({ title: 'T', text: 'text', url: 'https://torre.sh/g/x' });
  share.mockRejectedValueOnce(Object.assign(new Error('closed'), { name: 'AbortError' }));
  await expect(deliverLink('https://torre.sh/g/x', 'T', 'text')).resolves.toBe('dismissed');
  expect(writeText).not.toHaveBeenCalled();
});

test('hosted without a share sheet, the link is copied with a toast', async () => {
  vi.stubGlobal('fetch', reply(200, { url: 'https://torre.sh/g/abc' }));
  const writeText = clipboard();
  const d = deps();
  await expect(shareGame({ game: 'g1', ply: null, title: 'T', text: 'x' }, d)).resolves.toBe('copied');
  expect(writeText).toHaveBeenCalledWith('https://torre.sh/g/abc');
  expect(d.toast).toHaveBeenCalledWith('copied');
  expect(d.fallback).not.toHaveBeenCalled();
});

test('a refused link toasts why and copies nothing', async () => {
  vi.stubGlobal('fetch', reply(429));
  const writeText = clipboard();
  const d = deps();
  await expect(shareGame({ game: 'g1', title: 'T', text: 'x' }, d)).resolves.toBe('failed');
  expect(d.toast).toHaveBeenCalledWith('slow down');
  expect(writeText).not.toHaveBeenCalled();
});

test('on your own computer sharing is the fallback, with no request', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const d = deps({ hosted: false });
  await expect(shareGame({ game: 'g1', title: 'T', text: 'x' }, d)).resolves.toBe('fallback');
  expect(d.fallback).toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
