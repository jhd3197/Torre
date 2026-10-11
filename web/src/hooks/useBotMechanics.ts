// Runs a custom bot's mechanics (data/botMechanics.ts) through a game on /play: each move, the
// game's start and its end are moments; an event that fires plays its cue, puts its line in the
// bot's bubble and can shake the board. The board's mood (body[data-ambience]) lasts the game.
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { fire, freshState, mechanicsFor, momentsOf, stalkVolume, type BotEvent, type MechanicsState } from '../data/botMechanics';
import { playCue } from './useSounds';
import { sideToMove, startPly } from '../lib/format';
import type { BoardState, Color, Move } from '../types';

const SHAKE_MS = 600;

export function useBotMechanics({ botId, gameKey, initialFen, moves, you, live, result }: {
  botId?: string; gameKey: string; initialFen: string; moves: Move[]; you: Color;
  /** The live board, once it shows the latest move (its square control places a 'stalk' cue). */
  live: BoardState | null; result: string | null;
}) {
  const mechanics = mechanicsFor(botId);
  const [line, setLine] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const state = useRef<MechanicsState>(freshState());
  const done = useRef(-1);

  const run = useEffectEvent((event: BotEvent | null, board: BoardState | null) => {
    if (!event) return;
    if (event.sound) {
      const volume = event.sound.volume === 'stalk' ? (board ? stalkVolume(board, you) : 1) : event.sound.volume ?? 1;
      playCue(event.sound, volume);
    }
    if (event.say) setLine(event.say);
    if (event.shake) setShake(true);
  });

  // A new game (or a take-back to the start) starts the bot's moments over, with its 'start'.
  useEffect(() => {
    state.current = freshState();
    // A game opened mid-way (a reload) carries on from its last move, without replaying it.
    done.current = moves.length || -1;
    setLine(null);
    if (mechanics && moves.length === 0 && !result) run(fire(mechanics, ['start'], 1, state.current), null);
    // Once per game: the moves are read when it starts, not followed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameKey, mechanics]);

  // Each new move, once the board shows it: whose it was decides the moments (a check or capture first).
  useEffect(() => {
    if (!mechanics || !live || result) return;
    const count = startPly(live.fen) - startPly(initialFen);
    if (count !== moves.length || count <= done.current || count === 0) {
      if (count < done.current) done.current = count;  // a take-back: those moves can come again
      return;
    }
    done.current = count;
    const last = moves[count - 1];
    const first = sideToMove(initialFen);
    const mover: Color = (count - 1) % 2 === 0 ? first : first === 'white' ? 'black' : 'white';
    run(fire(mechanics, momentsOf(last.san, mover !== you), Math.ceil((startPly(initialFen) + count) / 2), state.current), live);
  }, [live, moves, mechanics, initialFen, you, result]);

  // The end of the game: the bot's last word.
  useEffect(() => {
    if (!mechanics || !result) return;
    const won = (result === '1-0') === (you === 'white');
    run(fire(mechanics, [result === '1/2-1/2' ? 'draw' : won ? 'youWin' : 'botWins'], 0, state.current), null);
  }, [result, mechanics, you]);

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

  return { line, active: !!mechanics };
}
