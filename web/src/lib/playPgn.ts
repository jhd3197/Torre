// A game against a bot as PGN text, for copying out of the app (to Lichess, a friend, a forum).
import { START_FEN, sideToMove } from './format';
import type { PlaySave } from './storage';

const tag = (name: string, value: string) => `[${name} "${value.replace(/["\\]/g, '')}"]`;

export function playPgn(game: PlaySave, you: string, botName: string, date = new Date()): string {
  const white = game.playerColor === 'white' ? you : botName;
  const black = game.playerColor === 'white' ? botName : you;
  const result = game.result ?? '*';
  const day = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  const tags = [tag('Event', 'Torre bot game'), tag('Site', 'Torre'), tag('Date', day), tag('White', white), tag('Black', black), tag('Result', result)];
  if (game.initialFen !== START_FEN) tags.push(tag('SetUp', '1'), tag('FEN', game.initialFen));
  // Move numbers follow the start position: a game from a Black-to-move FEN opens with "N...".
  const [, , , , , full] = game.initialFen.split(' ');
  let number = Number(full) || 1;
  let whiteToMove = sideToMove(game.initialFen) === 'white';
  const words: string[] = [];
  game.moves.forEach((move, i) => {
    if (whiteToMove) words.push(`${number}.`);
    else if (i === 0) words.push(`${number}...`);
    words.push(move.san);
    if (!whiteToMove) number++;
    whiteToMove = !whiteToMove;
  });
  words.push(result);
  return `${tags.join('\n')}\n\n${words.join(' ')}\n`;
}
