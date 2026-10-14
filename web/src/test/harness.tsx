// Renders the real routes in memory against a scripted fake of studio.py.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { preloadPages, routes } from '../App';
import { AppDataProvider } from '../state/AppData';
import { PromotionProvider } from '../state/Promotion';
import { resetMasters } from '../hooks/useMasters';
import type { AiView } from '../lib/ai';
import type { BoardState } from '../types';

// Pages are lazy chunks in the app; fetch them all before the file's tests so routes render at once.
beforeAll(() => preloadPages());

export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const START_PIECES: Record<string, string> = {};
'abcdefgh'.split('').forEach((file, i) => {
  START_PIECES[`${file}1`] = 'RNBQKBNR'[i]; START_PIECES[`${file}2`] = 'P';
  START_PIECES[`${file}7`] = 'p'; START_PIECES[`${file}8`] = 'rnbqkbnr'[i];
});

/** A board after `moves` (pieces are moved naively; legality is whatever the test says). */
export function boardAfter(moves: string[], legal?: string[]): BoardState {
  const pieces = { ...START_PIECES };
  for (const uci of moves) {
    const piece = pieces[uci.slice(0, 2)];
    delete pieces[uci.slice(0, 2)];
    if (piece) pieces[uci.slice(2, 4)] = piece;
  }
  const turn = moves.length % 2 ? 'black' : 'white';
  return {
    fen: `${moves.join('_') || 'start'} ${turn[0]} - - 0 1`, turn, pieces, check: null, result: null, termination: null,
    legal: legal ?? (turn === 'white' ? ['e2e4', 'd2d4', 'g1f3'] : ['e7e5', 'd7d5', 'g8f6']), plans: {}, control: {},
  };
}

type Handler = (body: Record<string, unknown> | undefined, path: string) => unknown;

/** The registry entry tests get by default: Stockfish, installed. */
export const STOCKFISH = {
  id: 'stockfish', name: 'Stockfish', version: null, type: 'nnue', protocol: 'uci',
  capabilities: { limit_strength: true, skill_level: true, multipv: true },
  strength_ccrl: 3650, license: 'GPL-3.0', repo_url: 'https://github.com/official-stockfish/Stockfish',
  description: 'The strongest open-source engine.', custom: false, installed: true, models: [],
};

/** A registry entry for an engine that is not installed. */
export const engineEntry = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  ...STOCKFISH, id, name, installed: false, strength_ccrl: 3500,
  capabilities: { limit_strength: false, skill_level: false, multipv: true },
  download: {
    windows: { url: `https://example.com/${id}-windows.exe`, archive: 'raw', size: 1048576, sha256: null, cpu: 'x86-64-v3 (AVX2)' },
    linux: { url: `https://example.com/${id}-linux`, archive: 'raw', size: 1048576, sha256: null, cpu: 'x86-64-v3 (AVX2)' },
    macos: { url: `https://example.com/${id}-macos`, archive: 'raw', size: 1048576, sha256: null, cpu: 'Apple silicon' },
  },
  ...extra,
});

/** Settings > AI's view (/api/ai): Prompture installed, Claude Code signed in, Ollama off, and two
 *  cloud services, one with a key. Tests change what they need. */
export const aiView = (extra: Partial<AiView> = {}): AiView => ({
  hosted: false,
  prompture: { installed: true, version: '1.13.11', install: { running: false, error: null, done: false } },
  desk: { running: false, version: null },
  providers: [
    { id: 'claude-code', name: 'Claude Code', kind: 'login', ready: true, detail: 'signed_in', url: 'https://claude.com/claude-code', key: null,
      models: [{ id: 'claude-code/default', name: 'Claude Code (its default)', provider: 'claude-code', released: '', efforts: [], cost: null },
        { id: 'claude-code/opus', name: 'Claude Code · Opus', provider: 'claude-code', released: '', efforts: [], cost: null }] },
    { id: 'ollama', name: 'Ollama', kind: 'local', ready: false, detail: 'not_running', url: 'https://ollama.com/download', key: null, models: [] },
    { id: 'claude', name: 'Anthropic Claude', kind: 'cloud', ready: true, detail: 'key_saved', url: 'https://console.anthropic.com/settings/keys',
      key: { hint: '…1234', source: 'saved' },
      models: [{ id: 'claude/claude-fable-5-1', name: 'Claude Fable 5.1', provider: 'claude', released: '2026-09-01', efforts: ['low', 'high', 'max'], cost: { input: 10, output: 50 } }] },
    { id: 'openai', name: 'OpenAI', kind: 'cloud', ready: false, detail: 'needs_key', url: 'https://platform.openai.com/api-keys', key: null,
      models: [{ id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', provider: 'openai', released: '2026-09-22', efforts: ['low', 'high'], cost: { input: 0.1, output: 0.5 } }] },
  ],
  settings: { model: null, features: {}, setup_seen: true },
  model: null, source: null,
  features: { coach: { model: null, source: null }, explain: { model: null, source: null } },
  models: {},
  ...extra,
});

export interface FakeServer { calls: { path: string; body?: Record<string, unknown> }[]; on: (path: string | RegExp, handler: Handler) => void }

export function fakeServer(): FakeServer {
  const handlers: [string | RegExp, Handler][] = [];
  const calls: FakeServer['calls'] = [];
  const server: FakeServer = { calls, on: (path, handler) => { handlers.unshift([path, handler]); } };
  // Defaults: an empty archive, no analysis running, positions from the move list.
  server.on('api/games', () => ({ games: [], engine: true }));
  server.on('api/insights', () => null);
  server.on('api/analysis', () => ({ running: false, total: 0, done: 0, failed: 0, current: null, error: null, remaining: 0, outdated: 0, engine: true }));
  server.on('api/position', body => boardAfter(body?.moves as string[]));
  server.on('api/engine', () => ({ lines: [{ cp: 34, mate: null, moves: ['e4', 'e5'], uci: ['e2e4', 'e7e5'], depth: 14 }], best: 'e2e4' }));
  server.on('api/engines', () => ({ engines: [STOCKFISH] }));
  server.on('api/masters', () => ({ masters: [], missing: [] }));
  server.on('api/arena', () => ({ running: false, match: null, recent: [] }));
  server.on('api/ai', () => aiView());
  server.on('api/ai/usage', () => ({ usage: [] }));
  server.on(/^api\/ai\/status/, () => ({ available: false, model: null, source: null, reason: 'no_model', setup_seen: true, hosted: false }));
  server.on('api/review', body => {
    if (body?.cachedOnly) return { plies: [] }; // nothing reviewed before, unless a test says so
    const moves = body?.moves as string[], from = Number(body?.from), to = Number(body?.to);
    return { plies: Array.from({ length: to - from + 1 }, (_, i) => ({
      ply: from + i, state: boardAfter(moves.slice(0, from + i)),
      lines: [{ cp: 34, mate: null, moves: ['e4', 'e5'], uci: ['e2e4', 'e7e5'], depth: 14 }], best: 'e2e4',
    })) };
  });

  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ path, body });
    const match = handlers.find(([pattern]) => typeof pattern === 'string' ? pattern === path : pattern.test(path));
    if (!match) return new Response(JSON.stringify({ error: `No fake for ${path}` }), { status: 404 });
    try {
      const result = await match[1](body, path);
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ error: (error as Error).message }), { status: 400 });
    }
  }));
  return server;
}

export function renderAt(path: string) {
  resetMasters();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AppDataProvider><PromotionProvider><RouterProvider router={router} /></PromotionProvider></AppDataProvider>,
  );
  return { ...view, router, location: () => router.state.location };
}

/** Play from -> to on the board by clicking. The board takes a piece only once it knows the legal moves
 *  (api/position), which can land after the pieces are drawn on a slow machine: click until the piece is
 *  selected, then its target. `piece` and `target` name the squares' buttons. */
export async function playMove(piece: RegExp | string, target: RegExp | string) {
  await screen.findByRole('button', { name: piece }, { timeout: 3000 });
  await waitFor(() => {
    const button = screen.getByRole('button', { name: piece });
    if (button.getAttribute('aria-pressed') !== 'true') fireEvent.click(button);
    expect(screen.getByRole('button', { name: piece })).toHaveAttribute('aria-pressed', 'true');
  });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: target })); });
}
