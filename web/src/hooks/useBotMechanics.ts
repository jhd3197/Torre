// Runs a bot's voice through a game on /play. A custom bot's mechanics (data/botMechanics.ts) come
// first: each move, the game's start and its end are moments; an event that fires plays its cue,
// puts its line in the bot's bubble and can shake the board, and the board's mood
// (body[data-ambience]) lasts the game. When none fires, a character bot chats in its voice
// (data/botChatter.ts): a check, a capture, your blunder or strong move, a big piece lost, the end.
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { fire, freshState, mechanicsFor, momentsOf, stalkVolume, type BotEvent, type MechanicsState } from '../data/botMechanics';
import { chatFor, chatLine, chatMoments, freshChat, swingOf, type ChatState, type Voice } from '../data/botChatter';
import { playCue } from './useSounds';
import { sideToMove, startPly } from '../lib/format';
import { botChatter } from '../lib/settings';
import type { BotNote } from '../lib/storage';
import type { BoardState, Color, Move } from '../types';

const SHAKE_MS = 600;
/** A line stays in the bubble for this many plies, unless another replaces it (the last word stays). */
export const LINE_PLIES = 4;

export function useBotMechanics({ botId, bot, gameKey, initialFen, moves, notes, you, live, result }: {
  /** Whose mechanics: the bot's id, or the character it is dressed as (Bot.costumeId). */
  botId?: string;
  /** The character's voice, for its chatter. */
  bot?: { voice?: Voice };
  gameKey: string; initialFen: string; moves: Move[]; you: Color;
  /** The bot's notes on its moves: their reads tell how your moves changed the game. */
  notes?: BotNote[];
  /** The live board, once it shows the latest move (its square control places a 'stalk' cue). */
  live: BoardState | null; result: string | null;
}) {
  const mechanics = mechanicsFor(botId);
  const voice = bot?.voice;
  const chatty = botChatter.use() && !!voice;
  const active = !!mechanics || chatty;
  const [line, setLine] = useState<{ text: string; at: number } | null>(null);
  const [shake, setShake] = useState(false);
  const state = useRef<MechanicsState>(freshState());
  const chat = useRef<ChatState>(freshChat());
  const done = useRef(-1);
  // The board after each move, by move count: what a capture took is read off the one before it.
  const boards = useRef(new Map<number, BoardState>());

  const run = useEffectEvent((event: BotEvent | null, board: BoardState | null, at: number) => {
    if (!event) return false;
    if (event.sound) {
      const volume = event.sound.volume === 'stalk' ? (board ? stalkVolume(board, you) : 1) : event.sound.volume ?? 1;
      playCue(event.sound, volume);
    }
    if (event.say) setLine({ text: event.say, at });
    if (event.shake) setShake(true);
    return true;
  });
  const say = useEffectEvent((text: string | undefined, at: number) => { if (text) setLine({ text, at }); });

  // A new game (or a take-back to the start) starts the bot's moments over, with its 'start'.
  useEffect(() => {
    state.current = freshState();
    chat.current = freshChat();
    boards.current.clear();
    // A game opened mid-way (a reload) carries on from its last move, without replaying it.
    done.current = moves.length || -1;
    setLine(null);
    if (mechanics && moves.length === 0 && !result) run(fire(mechanics, ['start'], 1, state.current), null, 0);
    // Once per game: the moves are read when it starts, not followed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameKey, mechanics]);

  // Each new move, once the board shows it: whose it was decides the moments (a check or capture first).
  useEffect(() => {
    if (!active || !live || result) return;
    const count = startPly(live.fen) - startPly(initialFen);
    if (count !== moves.length) return;
    boards.current.set(count, live);
    if (count <= done.current || count === 0) {
      if (count < done.current) {
        // A take-back: those moves can come again, on boards of their own.
        done.current = count;
        for (const ply of boards.current.keys()) if (ply > count) boards.current.delete(ply);
      }
      return;
    }
    done.current = count;
    const last = moves[count - 1];
    const first = sideToMove(initialFen);
    const mover: Color = (count - 1) % 2 === 0 ? first : first === 'white' ? 'black' : 'white';
    const byBot = mover !== you;
    if (mechanics && run(fire(mechanics, momentsOf(last.san, byBot), Math.ceil((startPly(initialFen) + count) / 2), state.current), live, count)) return;
    if (!chatty || !voice) return;
    const note = byBot ? notes?.find(n => n.ply === count) : undefined;
    const previous = byBot ? notes?.find(n => n.ply === count - 2) : undefined;
    const moment = chatFor(chatMoments({ san: last.san, uci: last.uci, byBot, swing: swingOf(previous?.after, note?.before),
      before: boards.current.get(count - 1) }), count, chat.current);
    if (moment) say(chatLine(voice, moment, count), count);
  }, [live, moves, notes, mechanics, chatty, active, voice, initialFen, you, result]);

  // The end of the game: the bot's last word.
  useEffect(() => {
    if (!active || !result) return;
    const won = (result === '1-0') === (you === 'white');
    const draw = result === '1/2-1/2';
    const at = moves.length;
    if (mechanics && run(fire(mechanics, [draw ? 'draw' : won ? 'youWin' : 'botWins'], 0, state.current), null, at)) return;
    // A win or a loss has the bot's own line in the result card; a draw gets one in its voice.
    if (chatty && voice && draw) say(chatLine(voice, 'draw', at), at);
    // The last word is said once, when the result comes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, mechanics, chatty, you]);

  useEffect(() => {
    if (!shake) return;
    const timer = setTimeout(() => setShake(false), SHAKE_MS);
    return () => clearTimeout(timer);
  }, [shake]);

  // The board's mood and the shake live on the body, so the board needs no wrapper.
  useEffect(() => {
    if (!mechanics?.ambience) return;
    document.body.dataset.ambience = mechanics.ambience;
    return () => { delete document.body.dataset.ambience; };
  }, [mechanics]);
  useEffect(() => {
    if (shake) document.body.dataset.shake = '1';
    else delete document.body.dataset.shake;
  }, [shake]);

  const shown = line && (result || moves.length - line.at <= LINE_PLIES) ? line.text : null;
  return { line: shown, active };
}
