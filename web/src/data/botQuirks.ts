// Bot quirks: the bots whose descriptions promise a habit play it (torre/analysis/bot_style.py).
// The server swaps the engine's move for one that fits the quirk when that costs little at the bot's
// rating, so a beginner's habit shows often and a master's only when it is nearly free.
//
//   quirk    doublePush | knights | rimKnights | mirror | aggressive | trades | castle | fortress
//            | earlyQueen | pawnStorm | develop
//   chance   0..1, how often the quirk is tried (the server's default when absent)
//   opening  the bot's own first moves (SAN) by colour, tried in order while legal
//
// A character without a quirk of its own leans a little on its style numbers: a very aggressive
// one goes for captures and checks now and then, a very passive one for trades.
import type { Bot } from './bots';

export type Quirk = 'doublePush' | 'knights' | 'rimKnights' | 'mirror' | 'aggressive' | 'trades' | 'castle' | 'fortress'
  | 'earlyQueen' | 'pawnStorm' | 'develop';
export interface BotStyle { quirk?: Quirk; chance?: number; opening?: { white?: string[]; black?: string[] } }

/** By bot id. Each matches the habit in the bot's description (characters.ts). */
export const BOT_QUIRKS: Record<string, BotStyle> = {
  // "Plays e4 every game and is still figuring out what comes after."
  'diego-santos': { opening: { white: ['e4'], black: ['e5'] } },
  // "Pushes every pawn two squares because it feels faster."
  'pip-pawnworth': { quirk: 'doublePush', chance: 0.8 },
  // "Just learned how the knight moves and uses it every single turn."
  'kwame-jr': { quirk: 'knights', chance: 0.8 },
  // "Answers your move with the mirror of it for as long as the board allows."
  'mila-the-mimic': { quirk: 'mirror', chance: 1 },
  // "Loves castling so much she has tried to do it twice."
  'poppy-lane': { quirk: 'castle', chance: 1 },
  // "Develops her queen on move two and hopes for the best."
  'alon-luz': { quirk: 'earlyQueen', chance: 0.9, opening: { white: ['e4', 'Qh5'], black: ['e5', 'Qh4'] } },
  // "Explores every corner of the board, especially the edges." (rim knights)
  'ollie-peak': { quirk: 'rimKnights' },
  // "Brave but forgetful: attacks with gusto."
  'molly-finch': { quirk: 'aggressive' },
  // "Climbs the board with her pawns, one rank at a time."
  'lena-ridge': { quirk: 'pawnStorm', chance: 0.5 },
  // "Brings everything to the kingside and laughs when it works."
  'zuri-bello': { quirk: 'aggressive' },
  // "Narrates every move to an imaginary chat. Chat says sac the rook."
  'finn-stream': { quirk: 'aggressive' },
  // "Castles early, trades when unsure."
  'marcus-moss': { quirk: 'castle', chance: 1, opening: { white: ['e4', 'Nf3', 'Bc4'], black: ['e5', 'Nc6', 'Bc5'] } },
  // "Her knights dance: hop, hop, fork."
  'imani-ross': { quirk: 'knights', chance: 0.5 },
  // "Packs light: trades pieces early and travels into the endgame."
  'paloma-sol': { quirk: 'trades', chance: 0.8 },
  // "Lives for forks. Will manoeuvre a knight for six moves to reach one."
  'knight-owl': { quirk: 'knights', chance: 0.5 },
  // "Sacrifices a pawn in the first six moves, every single game, on principle."
  'gambit-gloria': { quirk: 'aggressive', opening: { white: ['e4', 'f4'], black: ['e5', 'f5'] } },
  // "Refuses to push a pawn past the fourth rank."
  'iron-wall-ivo': { quirk: 'fortress', chance: 1 },
  // "Trades into the ending at the first chance and squeezes from there."
  'zugzwang-zoya': { quirk: 'trades', chance: 0.8 },
  // "Dramatic, romantic chess full of twists and sacrifices."
  'esperanza-gil': { quirk: 'aggressive', chance: 0.5 },
  // "Punishes every slow developing move you make." (and never makes one)
  'tempo-tarik': { quirk: 'develop', chance: 0.7 },
  // "Counts every exchange. If the numbers say trade, he trades."
  'sora-tanaka': { quirk: 'trades', chance: 0.7 },
  // "The Ruy Lopez, the Queen's Gambit, and a long think before every capture."
  'uncle-ray': { opening: { white: ['e4', 'Nf3', 'Bb5'], black: ['e5', 'Nc6'] } },
  // "Knows every trap in the London System."
  'big-tunde': { opening: { white: ['d4', 'Bf4', 'e3', 'Nf3', 'c3', 'Bd3', 'Nbd2'] } },
  // "Graceful knight hops, hula style."
  'leilani-kai': { quirk: 'knights', chance: 0.6 },
  // "Says prost to every capture, especially her own." (loves trades)
  'greta-wiesn': { quirk: 'trades', chance: 0.7 },
  // "Races downhill toward your king with no brakes."
  'misha-lyzhi': { quirk: 'aggressive' },
  // "Cheers her pawns down the board ... for every single push."
  'peyton-spirit': { quirk: 'pawnStorm', chance: 0.5 },
};

/** A light lean from the style numbers, for characters without a quirk of their own (one object
 *  each, so a page can depend on the style it gets). */
const LEAN_CHANCE = 0.25;
const LEAN_AGGRESSIVE: BotStyle = { quirk: 'aggressive', chance: LEAN_CHANCE };
const LEAN_TRADES: BotStyle = { quirk: 'trades', chance: LEAN_CHANCE };

/** The style a bot plays with (sent with each of its moves), or none. */
export function styleFor(bot: Pick<Bot, 'id' | 'style' | 'avatar' | 'coach'> | undefined): BotStyle | undefined {
  if (!bot?.avatar || bot.coach) return undefined;
  const own = BOT_QUIRKS[bot.id];
  if (own) return own;
  const [aggression] = bot.style;
  if (aggression >= 80) return LEAN_AGGRESSIVE;
  if (aggression <= 22) return LEAN_TRADES;
  return undefined;
}
