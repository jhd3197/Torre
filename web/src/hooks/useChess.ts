// Server-backed chess state. Results are cached per position so stepping through a game is instant.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { BoardState, BookHit, EngineResult, Move } from '../types';
import type { Phase, PhaseElo } from '../lib/storage';
import type { AnalysisDepth } from '../lib/settings';
import type { BotStyle } from '../data/botQuirks';

const positionCache = new Map<string, BoardState>();
const engineCache = new Map<string, EngineResult>();
const CACHE_LIMIT = 1000; // a long game is ~200 positions

const keyOf = (initialFen: string, moves: string[]) => `${initialFen}|${moves.join(',')}`;
/** A move list as one comparable string, and back: effects depend on the string, not a fresh array. */
const joinMoves = (moves: Move[]) => moves.map(m => m.uci).join(',');
const splitMoves = (line: string) => (line ? line.split(',') : []);
/** Engine lines are per engine: the same position reviewed by two engines differs. */
const engineKeyOf = (engineId: string, initialFen: string, moves: string[]) => `${engineId}|${keyOf(initialFen, moves)}`;

function remember<T>(cache: Map<string, T>, key: string, value: T) {
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

export function fetchPosition(initialFen: string, moves: string[], signal?: AbortSignal): Promise<BoardState> {
  const key = keyOf(initialFen, moves);
  const cached = positionCache.get(key);
  if (cached) return Promise.resolve(cached);
  return api<BoardState>('api/position', { initialFen, moves }, signal).then(board => {
    remember(positionCache, key, board);
    return board;
  });
}

/** Board state after `moves`. Keeps showing the previous board while the next one loads. */
export function usePosition(initialFen: string, moves: Move[], enabled = true) {
  const line = joinMoves(moves);
  const key = keyOf(initialFen, splitMoves(line));
  const [state, setState] = useState<{ key: string; board: BoardState | null; error: string | null }>(
    () => ({ key, board: positionCache.get(key) ?? null, error: null }));

  useEffect(() => {
    if (!enabled) return;
    const cached = positionCache.get(key);
    if (cached) { setState({ key, board: cached, error: null }); return; }
    const controller = new AbortController();
    fetchPosition(initialFen, splitMoves(line), controller.signal)
      .then(board => setState({ key, board, error: null }))
      .catch(error => { if (!controller.signal.aborted) setState(s => ({ ...s, key, error: (error as Error).message })); });
    return () => controller.abort();
  }, [key, initialFen, line, enabled]);

  if (!enabled) return { board: null, current: false, error: null };
  return { board: state.board, current: state.key === key && !!state.board, error: state.error };
}

export type EngineStatus = 'off' | 'pending' | 'ready' | 'error';

/**
 * Engine lines for a position, requested automatically after a short pause
 * so quickly stepping through moves does not queue a request per move.
 */
export function useEngine(initialFen: string, moves: Move[], enabled: boolean, delay = 250, engineId = 'stockfish', depth: AnalysisDepth = 'normal') {
  const line = joinMoves(moves);
  // Lines from a quick or deep search are kept apart; the normal search shares the review's cache.
  const key = engineKeyOf(engineId, initialFen, splitMoves(line)) + (depth === 'normal' ? '' : `|${depth}`);
  const [state, setState] = useState<{ key: string; result: EngineResult | null; status: EngineStatus; error?: string }>(
    { key: '', result: null, status: 'off' });

  useEffect(() => {
    if (!enabled) { setState({ key, result: null, status: 'off' }); return; }
    const cached = engineCache.get(key);
    if (cached) { setState({ key, result: cached, status: 'ready' }); return; }
    setState({ key, result: null, status: 'pending' });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<EngineResult>('api/engine', { initialFen, moves: splitMoves(line), engineId, ...(depth === 'normal' ? {} : { depth }) }, controller.signal)
        .then(result => { remember(engineCache, key, result); setState({ key, result, status: 'ready' }); })
        .catch(error => { if (!controller.signal.aborted) setState({ key, result: null, status: 'error', error: (error as Error).message }); });
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, initialFen, line, engineId, enabled, delay, depth]);

  // Never show lines computed for a different position.
  return state.key === key ? state : { key, result: null, status: enabled ? 'pending' as const : 'off' as const };
}

/** Whether every position from ply `from` to `to` already has its board and engine lines. */
export function isReviewed(initialFen: string, moves: Move[], from: number, to: number, engineId = 'stockfish') {
  const ucis = moves.map(m => m.uci);
  for (let ply = from; ply <= to; ply++) {
    const key = keyOf(initialFen, ucis.slice(0, ply));
    if (!positionCache.has(key) || !engineCache.has(engineKeyOf(engineId, initialFen, ucis.slice(0, ply)))) return false;
  }
  return true;
}

/** Analyze plies `from`..`to` in one request and cache them, so stepping there needs no server call.
 *  With `cachedOnly`, only positions the server has saved from an earlier review come back. */
export async function reviewPlies(initialFen: string, moves: Move[], from: number, to: number, signal?: AbortSignal, cachedOnly = false, engineId = 'stockfish') {
  const ucis = moves.map(m => m.uci);
  const { plies } = await api<{ plies: (EngineResult & { ply: number; state: BoardState })[] }>(
    'api/review', { initialFen, moves: ucis, from, to, engineId, ...(cachedOnly ? { cachedOnly } : {}) }, signal);
  for (const { ply, state, lines, best, grade } of plies) {
    const key = keyOf(initialFen, ucis.slice(0, ply));
    remember(positionCache, key, state);
    remember(engineCache, engineKeyOf(engineId, initialFen, ucis.slice(0, ply)), { lines, best, grade });
  }
}

/** Ask an engine to play a move: Stockfish at a skill level (0–20), a bot at `elo`,
 *  another engine at full strength, or a model (Maia) as itself. A legend (`masterId`)
 *  answers from their own games first; `book` says which game the move came from. */
/** A bot's reply: the move, the phase it was played in and the rating it played at, and whether it
 *  was a deliberate random slip. `phaseElo` sets a rating per phase instead of `elo`. */
export const botMove = (initialFen: string, moves: Move[], level: number, signal?: AbortSignal, elo?: number, engineId?: string, modelId?: string, masterId?: string, nodes?: number, phaseElo?: PhaseElo,
  extra: BotMoveExtra = {}) =>
  api<BotReply>('api/engine', { initialFen, moves: moves.map(m => m.uci), play: true, level,
    ...(elo ? { elo } : {}), ...(engineId ? { engineId } : {}), ...(modelId ? { modelId } : {}), ...(masterId ? { masterId } : {}), ...(nodes ? { nodes } : {}),
    ...(phaseElo ? { phaseElo } : {}), ...(extra.read ? { read: true } : {}), ...(extra.style ? { style: extra.style } : {}) }, signal);

/** What else a bot's move request asks for: `read`, the bot's view around its move (for its chatter);
 *  `style`, the character's quirk (data/botQuirks.ts). */
export interface BotMoveExtra { read?: boolean; style?: BotStyle }
/** `before`/`after`: with `read`, the bot's centipawns for the position it was left and after its move. */
export interface BotReply { best: string | null; book?: BookHit; phase?: Phase; elo?: number; slip?: boolean; before?: number; after?: number }

/** A move the coach talks about: the piece that plays it and the tactics it carries (motifs.py tags). */
export interface CoachMove { uci: string; san: string; piece: string; motifs: string[] }
/** POST /api/coach/hint: the best move here, and what the opponent threatens (with what it wins). */
export interface CoachHint { best: CoachMove | null; threat: (CoachMove & { gain: number }) | null }
export const coachHint = (initialFen: string, moves: Move[], signal?: AbortSignal) =>
  api<CoachHint>('api/coach/hint', { initialFen, moves: moves.map(m => m.uci) }, signal);
/** POST /api/coach/check: your move judged against the best one, before it is played. */
export const coachCheck = (initialFen: string, moves: Move[], move: string) =>
  api<MoveJudgement & { best: { uci: string; san: string } | null }>('api/coach/check', { initialFen, moves: moves.map(m => m.uci), move });

/** Validate and play a move on the server; returns the new state and its SAN. */
export const playMove = (initialFen: string, moves: Move[], uci: string, signal?: AbortSignal) =>
  api<BoardState & { san: string; uci: string }>('api/move', { initialFen, moves: moves.map(m => m.uci), move: uci }, signal);

/** Stockfish's view of a lesson move that is not the listed one: as good, or worse, with the line that answers it. */
export interface MoveJudgement {
  verdict: 'good' | 'worse'; loss: number; line: string[]; uci: string[];
  /** Mover-POV centipawns after the move and after the expected one (mate as ±10000). */
  cp?: number; expected_cp?: number;
  /** Tactics the answer sets up (motifs.py tags: fork, hangingPiece, mateIn1...). */
  motifs?: string[];
  /** Material the mover is down a few moves on, in pawns (0 or less). */
  material?: number;
}

export const judgeMove = (initialFen: string, moves: Move[], uci: string, expected: string) =>
  api<MoveJudgement>('api/judge', { initialFen, moves: moves.map(m => m.uci), move: uci, expected });

/** White-POV evaluation of each position the review has cached (index = ply), with the engine's best move there. */
export interface PlyEval { cp: number | null; mate: number | null; best: string | null; grade?: EngineResult['grade'] }

/** The board after `ply` moves, when the review (or stepping) has loaded it. */
export function cachedBoard(initialFen: string, moves: Move[], ply: number): BoardState | undefined {
  return positionCache.get(keyOf(initialFen, moves.slice(0, ply).map(m => m.uci)));
}

/** The review's engine result for the position after `ply` moves (its top lines), if it has one. */
export function reviewedResult(initialFen: string, moves: Move[], ply: number, engineId = 'stockfish'): EngineResult | null {
  return engineCache.get(engineKeyOf(engineId, initialFen, moves.slice(0, ply).map(m => m.uci))) ?? null;
}

export function reviewedEvals(initialFen: string, moves: Move[], engineId = 'stockfish'): (PlyEval | null)[] {
  const ucis = moves.map(m => m.uci);
  return Array.from({ length: moves.length + 1 }, (_, ply) => {
    const key = keyOf(initialFen, ucis.slice(0, ply));
    const result = engineCache.get(engineKeyOf(engineId, initialFen, ucis.slice(0, ply))), state = positionCache.get(key);
    if (!result || !state) return null;
    const top = result.lines[0];
    if (top) return { cp: top.mate == null ? top.cp : null, mate: top.mate ?? null, best: result.best, grade: result.grade };
    // A finished game has no lines: score the result itself.
    if (state.result === '1-0') return { cp: null, mate: 1, best: null, grade: result.grade };
    if (state.result === '0-1') return { cp: null, mate: -1, best: null, grade: result.grade };
    return state.result ? { cp: 0, mate: null, best: null, grade: result.grade } : null;
  });
}
