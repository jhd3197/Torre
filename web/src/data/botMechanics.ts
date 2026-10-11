// Custom bot mechanics: a bot can do more than play. Each entry below gives a bot (by id) a list of
// events: when one of its moments comes (the game starts, it moves, it captures, it gives check, the
// game ends), the event may play a sound, say a line in the bot's bubble, or shake the board, and
// a bot can set the board's mood for the whole game. Everything is data: adding a bot's mechanics
// needs no change to the play page.
//
//   on        the moment: start | botMove | yourMove | botCapture | yourCapture | botCheck | yourCheck
//             | botWins | youWin | draw
//   chance    0..1, how often the event fires when its moment comes (default always)
//   every     fire on every Nth time the moment comes (3: the 3rd, 6th, 9th...)
//   fromMove  only from this move number on
//   once      fire one time per game at most
//   sound     { synth: 'whistle' | 'bones' | 'wind' | 'toll' } or { file: 'audio/<bot>/<name>.mp3' }
//             (a file under web/public), with `volume` 0..1 or 'stalk' (see stalkVolume)
//   say       a line shown in the bot's bubble (translated like the bot's other words)
//   shake     shake the board for a moment
//
// The first event that fires for a moment wins, so list the rarer, more specific ones first.
import { translatable } from '../i18n/content';
import type { SynthCue } from '../hooks/useSounds';
import type { BoardState, Color } from '../types';

export type BotMoment = 'start' | 'botMove' | 'yourMove' | 'botCapture' | 'yourCapture' | 'botCheck' | 'yourCheck'
  | 'botWins' | 'youWin' | 'draw';

export interface BotCue { synth?: SynthCue; file?: string; volume?: number | 'stalk' }

export interface BotEvent {
  on: BotMoment;
  chance?: number;
  every?: number;
  fromMove?: number;
  once?: boolean;
  sound?: BotCue;
  say?: string;
  shake?: boolean;
}

export interface BotMechanics {
  events: BotEvent[];
  /** The board's mood for the whole game. */
  ambience?: 'night';
}

/**
 * El Silbón, from the Venezuelan plains: a tall wanderer with a sack of bones, known by his
 * whistle (do, re, mi, fa, sol, la, si). The legend says that when the whistle sounds close he is
 * far away, and when it sounds far he is right beside you. So here: his whistle grows fainter the
 * more of his pieces close in on your king.
 */
const EL_SILBON: BotMechanics = {
  ambience: 'night',
  events: [
    { on: 'start', sound: { synth: 'whistle', volume: 0.9 }, say: 'Do, re, mi, fa, sol, la, si... did you hear that?' },
    { on: 'botCheck', sound: { synth: 'whistle', volume: 0.12 }, say: 'The whistle sounds far away... so I must be close.', shake: true },
    { on: 'botCapture', chance: 0.6, sound: { synth: 'bones' }, say: 'One more bone for the sack.' },
    { on: 'botMove', fromMove: 6, every: 3, sound: { synth: 'whistle', volume: 'stalk' } },
    { on: 'yourCapture', chance: 0.3, sound: { synth: 'wind' }, say: 'The plains are wide. I can wait.' },
    { on: 'botWins', sound: { synth: 'whistle', volume: 0.08 }, say: 'You heard me far away. I was right behind you.' },
    { on: 'youWin', sound: { synth: 'toll' }, say: 'Dawn comes. I go back to the plains... for now.' },
  ],
};

/** By bot id: the slug of the bot's name, where an accented letter splits ('El Silbón' is 'el-silbo-n'). */
export const BOT_MECHANICS: Record<string, BotMechanics> = { 'el-silbo-n': EL_SILBON };

// Each line is translatable (content.json botMechanics.<bot>.<event index>.say).
for (const [id, mechanics] of Object.entries(BOT_MECHANICS)) {
  mechanics.events.forEach((event, i) => translatable(event, `botMechanics.${id}.${i}`, ['say']));
}

export const mechanicsFor = (botId?: string) => (botId ? BOT_MECHANICS[botId] : undefined);

/** The moments a move makes, most specific first: a check or a capture, then the plain move. */
export function momentsOf(san: string, byBot: boolean): BotMoment[] {
  const side = byBot ? 'bot' : 'your';
  const out: BotMoment[] = [];
  if (/[+#]/.test(san)) out.push(byBot ? 'botCheck' : 'yourCheck');
  if (san.includes('x')) out.push(byBot ? 'botCapture' : 'yourCapture');
  out.push(side === 'bot' ? 'botMove' : 'yourMove');
  return out;
}

/** Per-game state the events need: how often each moment came, which `once` events have fired. */
export interface MechanicsState { seen: Partial<Record<BotMoment, number>>; fired: number[] }
export const freshState = (): MechanicsState => ({ seen: {}, fired: [] });

/**
 * The event that fires now, if any, for the moments that just came (most specific first), at
 * `moveNumber`. Updates `state`: every moment is counted, whether or not anything fires for it.
 */
export function fire(mechanics: BotMechanics, moments: BotMoment[], moveNumber: number, state: MechanicsState,
  random: () => number = Math.random): BotEvent | null {
  for (const moment of moments) state.seen[moment] = (state.seen[moment] ?? 0) + 1;
  for (const moment of moments) {
    for (const [i, event] of mechanics.events.entries()) {
      if (event.on !== moment) continue;
      if (event.once && state.fired.includes(i)) continue;
      if (event.fromMove && moveNumber < event.fromMove) continue;
      if (event.every && (state.seen[moment] ?? 0) % event.every !== 0) continue;
      if (event.chance !== undefined && random() >= event.chance) continue;
      state.fired.push(i);
      return event;
    }
  }
  return null;
}

/**
 * How loud a 'stalk' cue plays: loud while the bot's pieces are far from your king, faint once
 * they close in (El Silbón's legend). Counts the bot's attacks on your king and the squares around
 * it, from the board's square control.
 */
export function stalkVolume(board: BoardState, you: Color): number {
  const king = Object.entries(board.pieces).find(([, piece]) => piece === (you === 'white' ? 'K' : 'k'))?.[0];
  if (!king) return 1;
  const file = king.charCodeAt(0), rank = Number(king[1]);
  const bot: Color = you === 'white' ? 'black' : 'white';
  let pressure = 0;
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      const square = `${String.fromCharCode(file + df)}${rank + dr}`;
      pressure += board.control?.[square]?.[bot]?.length ?? 0;
    }
  }
  // No pressure: a whistle in your ear (far away). Six attacks or more near your king: barely heard.
  return Math.max(0.08, 1 - pressure / 6);
}
