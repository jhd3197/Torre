// Every character bot talks during a game: a short line in its bubble when it gives check or takes
// a piece, when you take one of its big pieces, when you blunder or find a strong move, and at a
// draw. Writing lines for each of hundreds of bots is out of reach, so the lines come from a pool
// (locales/<lang>/chatter.json) in five voices, and each bot gets the voice its own data suggests:
// its tags and kind, else its rating and its style. A bot's own lines (botMechanics.ts, its win and
// lose lines) always come first; this is what it says the rest of the time.
//
// Small talk is rationed: a check or a capture gets a line at most every few moves and only some of
// the time; the big moments (a blunder, a strong move, a lost queen or rook, a draw) always do.
import i18n from '../i18n';
import type { BoardState } from '../types';

export const VOICES = ['cocky', 'friendly', 'nervous', 'grumpy', 'wise'] as const;
export type Voice = typeof VOICES[number];

export type ChatMoment = 'botCheck' | 'botCapture' | 'lostBig' | 'youBlunder' | 'youStrong' | 'draw';
/** Moments that always get a line; the others are small talk. */
const BIG: readonly ChatMoment[] = ['youBlunder', 'youStrong', 'lostBig', 'draw'];

/** Words in a bot's tags and kind that give its voice away, checked in this order. */
const VOICE_WORDS: [Voice, RegExp][] = [
  ['wise', /legend|master|professor|experience|universal|polished|flawless|classical|\bdeep\b|wisdom|sage|elder/i],
  ['cocky', /flashy|showy|showman|confident|cocky|trash|loud|all-in|all-attack|fearless|reckless|no brakes|gambit|sacrific|aggressive|tricks?\b|hustl|swagger|dribbles/i],
  ['grumpy', /fortress|grump|strict|tight|stubborn|squeeze|principles|disciplined|rigorous|defen[cs]|over-defends/i],
  ['nervous', /beginner|brand new|hangs pieces|nervous|shy|forgetful|distracted|self-critical|wandering|lost|messy|blunder/i],
  ['friendly', /cheerful|friendly|kind|fun|cozy|happy|jolly|easygoing|playful|relaxed|calm|sweet|lively|warm/i],
];

/**
 * The voice a character speaks in, from its data as written (English tags and kind): the first
 * voice its words match, else its rating and style decide (a strong bot is wise, an aggressive one
 * cocky, a very passive one grumpy, a very inaccurate one nervous, everyone else friendly).
 */
export function voiceFor(tags: readonly string[], kind: string, style: readonly [number, number, number], elo: number): Voice {
  const words = [...tags, kind].join(' · ');
  for (const [voice, pattern] of VOICE_WORDS) {
    // Wisdom needs the rating to back it: a 600 "master chef" is no sage.
    if (pattern.test(words) && (voice !== 'wise' || elo >= 1700)) return voice;
  }
  const [aggression, accuracy] = style;
  if (elo >= 2000) return 'wise';
  if (aggression >= 70) return 'cocky';
  if (aggression <= 30) return 'grumpy';
  if (accuracy <= 20) return 'nervous';
  return 'friendly';
}

/** Pieces whose loss is worth a word. */
const BIG_PIECES = new Set(['q', 'r']);

/**
 * The chatter moments a move makes, biggest first. `byBot`: whose move it was. `swing`: for the
 * bot's move, how many of the bot's centipawns your move before it gave (a blunder) or took away (a
 * strong move), when the bot read both positions. `before`: the board before the move, to name what
 * it took.
 */
export function chatMoments({ san, uci, byBot, swing, before }: {
  san: string; uci: string; byBot: boolean; swing?: number | null; before?: BoardState | null;
}): ChatMoment[] {
  const out: ChatMoment[] = [];
  if (byBot) {
    if (swing != null && swing >= BLUNDER_CP) out.push('youBlunder');
    else if (swing != null && swing <= -STRONG_CP) out.push('youStrong');
    // Mate ends the game: the bot's last word comes with the result.
    if (san.includes('+')) out.push('botCheck');
    if (san.includes('x')) out.push('botCapture');
  } else if (san.includes('x')) {
    const taken = before?.pieces[uci.slice(2, 4)]?.toLowerCase();
    if (taken && BIG_PIECES.has(taken)) out.push('lostBig');
  }
  return out;
}

/** Centipawns your move must hand the bot to count as a blunder, or take from it to count as strong. */
export const BLUNDER_CP = 250;
export const STRONG_CP = 200;
/** Past this the game is decided, and a swing says little about the move. */
const DECIDED_CP = 1000;

/**
 * How much your last move changed the bot's view, in its centipawns: its read of the position you
 * left (`before`, on its reply now) against its read after its own previous move (`after`). Null
 * when either is missing or the game was already decided.
 */
export function swingOf(previousAfter?: number, before?: number): number | null {
  if (previousAfter == null || before == null || Math.abs(previousAfter) >= DECIDED_CP) return null;
  return before - previousAfter;
}

/** Small talk waits this many plies after the bot's last line, and comes this often. */
export const CHAT_GAP = 6;
export const CHAT_CHANCE = 0.5;

export interface ChatState { last: number }
export const freshChat = (): ChatState => ({ last: -Infinity });

/** The moment the bot speaks up for now, if any, at ply `ply`: a big one always, small talk rationed. */
export function chatFor(moments: ChatMoment[], ply: number, state: ChatState, random: () => number = Math.random): ChatMoment | null {
  const big = moments.find(moment => BIG.includes(moment));
  const moment = big ?? (moments.length && ply - state.last >= CHAT_GAP && random() < CHAT_CHANCE ? moments[0] : null);
  if (moment) state.last = ply;
  return moment;
}

/** A line in `voice` for `moment` (chatter.json), varied by `seed` (the ply, so a reload says the same). */
export function chatLine(voice: Voice, moment: ChatMoment, seed: number): string {
  const lines = i18n.t(`chatter:${voice}.${moment}`, { returnObjects: true }) as unknown;
  return Array.isArray(lines) && lines.length ? String(lines[Math.abs(seed) % lines.length]) : '';
}
