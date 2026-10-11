// Browser-local state. Every read and write tolerates private browsing or full storage.
import type { Color, Move } from '../types';
import type { MoveTiming } from '../hooks/useMoveTiming';

export const PLAY_SAVE_KEY = 'chess-jd-play-v1';

export const LEVELS = [1, 4, 10, 20] as const;

export interface PlaySave {
  initialFen: string;
  moves: Move[];
  /** Observed human thinking time, keyed to the full game's ply and UCI move. */
  timings?: MoveTiming[];
  playerColor: Color;
  level: number;
  result: string | null;
  /** The bot you are playing; Stockfish at `level` when absent. */
  botId?: string;
  /** The registry engine the bot plays with (engines.py id); Stockfish when absent. */
  engineId?: string;
  /** A model running on that engine (Maia on Lc0). */
  modelId?: string;
  /** The bot searches this many nodes per move (node-limited strength). */
  nodes?: number;
  /** A legend (masters.py id): opens from their own games, then the engine plays at `elo`. */
  masterId?: string;
  /** The bot's display name, for engine bots that have no static card. */
  botName?: string;
  /** Rating the bot plays at, for character bots. */
  elo?: number;
  /** You resigned; `result` holds the score. */
  resigned?: boolean;
  /** The stars for this game have been shown. */
  rewarded?: boolean;
  /** Identifies the game when it is recorded for awards. */
  gameId?: string;
  /** A rating for each phase instead of one: the bot plays the opening, middlegame and endgame at these. */
  phaseElo?: PhaseElo;
  /** Played with the coach beside you: hints, threats, and a word before a mistake. Practice: no stars. */
  coached?: boolean;
  /** Moves the coach let you take back. */
  takebacks?: number;
  /** The bot's own record of each of its moves: the phase, the rating it played at, and whether
   *  it was a deliberate random slip (for the after-game card). */
  botNotes?: BotNote[];
  /** The bot's figure for this game when it plays in an event costume. */
  outfit?: string;
  /** The event on when the game started: a win keeps the bot for it (lib/events). */
  event?: string;
  /** Where this game's stars go when not under `botId` (an event's bots keep their own). */
  starsKey?: string;
  /** The character the bot is dressed as for this game (El Silbón), shown instead of its name. */
  costume?: string;
}

export const PHASES = ['opening', 'middlegame', 'endgame'] as const;
export type Phase = typeof PHASES[number];
export type PhaseElo = Record<Phase, number>;
/** The ratings a phase can be set to (api_board.PHASE_ELO_RANGE). */
export const PHASE_ELO_RANGE = [250, 3200] as const;
export interface BotNote { ply: number; slip: boolean; phase?: Phase; elo?: number }

const validPhaseElo = (value: unknown): value is PhaseElo => !!value && typeof value === 'object'
  && PHASES.every(phase => Number.isInteger((value as Record<string, unknown>)[phase])
    && (value as PhaseElo)[phase] >= PHASE_ELO_RANGE[0] && (value as PhaseElo)[phase] <= PHASE_ELO_RANGE[1]);

function read<T>(storage: () => Storage, key: string): T | null {
  try { return JSON.parse(storage().getItem(key) ?? 'null') as T | null; } catch { return null; }
}

function write(storage: () => Storage, key: string, value: unknown) {
  try { storage().setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function loadPlay(): PlaySave | null {
  const saved = read<Partial<PlaySave> & { level?: number | string }>(() => localStorage, PLAY_SAVE_KEY);
  if (!saved || !Array.isArray(saved.moves)) return null;
  const level = Number(saved.level);
  return {
    initialFen: saved.initialFen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: saved.moves,
    ...(Array.isArray(saved.timings) ? { timings: saved.timings } : {}),
    playerColor: saved.playerColor === 'black' ? 'black' : 'white',
    level: (LEVELS as readonly number[]).includes(level) ? level : 4,
    result: saved.result ?? null,
    ...(typeof saved.botId === 'string' ? { botId: saved.botId } : {}),
    ...(typeof saved.engineId === 'string' ? { engineId: saved.engineId } : {}),
    ...(typeof saved.modelId === 'string' ? { modelId: saved.modelId } : {}),
    ...(Number.isInteger(saved.nodes) && Number(saved.nodes) > 0 ? { nodes: Number(saved.nodes) } : {}),
    ...(typeof saved.masterId === 'string' ? { masterId: saved.masterId } : {}),
    ...(typeof saved.botName === 'string' ? { botName: saved.botName } : {}),
    ...(Number.isFinite(saved.elo) ? { elo: Number(saved.elo) } : {}),
    ...(saved.resigned ? { resigned: true } : {}),
    ...(saved.rewarded ? { rewarded: true } : {}),
    ...(typeof saved.gameId === 'string' ? { gameId: saved.gameId } : {}),
    ...(validPhaseElo(saved.phaseElo) ? { phaseElo: saved.phaseElo } : {}),
    ...(saved.coached ? { coached: true } : {}),
    ...(Number.isInteger(saved.takebacks) && Number(saved.takebacks) > 0 ? { takebacks: Number(saved.takebacks) } : {}),
    ...(Array.isArray(saved.botNotes) ? { botNotes: saved.botNotes.filter(n => n && Number.isInteger(n.ply)) } : {}),
    ...(typeof saved.outfit === 'string' && saved.outfit.startsWith('art/') ? { outfit: saved.outfit } : {}),
    ...(typeof saved.event === 'string' ? { event: saved.event } : {}),
    ...(typeof saved.starsKey === 'string' ? { starsKey: saved.starsKey } : {}),
    ...(typeof saved.costume === 'string' ? { costume: saved.costume } : {}),
  };
}

export const savePlay = (save: PlaySave) => write(() => localStorage, PLAY_SAVE_KEY, save);

/** A saved game that is still in progress. */
export function resumablePlay(): PlaySave | null {
  const saved = loadPlay();
  return saved && !saved.result ? saved : null;
}
