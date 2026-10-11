import { coachMood } from './CoachRook';
import voice from '../i18n/locales/en/voice.json';
import { resetVariety } from '../lib/commentary';

beforeEach(() => resetVariety(() => 0));
afterEach(() => resetVariety());

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const mood = (sans: string[], over: Partial<Parameters<typeof coachMood>[0]> = {}) => coachMood({
  initialFen: START, moves: sans.map(san => ({ uci: 'a2a3', san })), you: 'white', botName: 'Baron Blunder',
  thinking: false, reviewing: false, idle: false, ...over,
});

test('the rook cheers your captures, checks, castling and promotions', () => {
  expect(mood(['exd5']).pose).toBe('excited');
  expect(mood(['Qh5+']).pose).toBe('starry');
  expect(mood(['O-O']).pose).toBe('shield');
  expect(mood(['e8=Q']).pose).toBe('confetti');
  expect(mood(['e4']).pose).toBe('content');
});

test('the rook warns you about the bot’s captures and checks', () => {
  const lost = mood(['e4', 'Bxb2']);
  expect(voice.lostPiece).toContain(lost.line);
  expect(lost.spoken).toBe(true);
  expect(mood(['e4', 'Qh4+']).pose).toBe('panic');
  expect(mood(['e4', 'e5'], { idle: true }).pose).toBe('bored');
});

test('moves are attributed to the right side when you play Black', () => {
  expect(mood(['exd5'], { you: 'black' }).pose).toBe('shocked');
});

test('thinking and reviewing take priority', () => {
  expect(mood(['e4'], { thinking: true }).line).toBe('Baron Blunder is thinking…');
  expect(mood(['e4'], { reviewing: true }).pose).toBe('detective');
});

test('captures, checks and mate get a spoken quip; quiet moves stay quiet', () => {
  expect(voice.capture).toContain(mood(['exd5']).line);
  expect(voice.check).toContain(mood(['Qh5+']).line);
  const mate = mood(['Qxf7#']);
  expect(voice.mate).toContain(mate.line);
  expect(mate.pose).toBe('trophy');
  expect(mood(['e4']).spoken).toBeUndefined();
});

test('a capture names the piece it took, and calls a free one out', () => {
  expect(mood(['exd5'], { capture: { piece: 'knight', mover: 'white', free: true } }).line).toBe('Free knight! Om nom nom.');
  expect(mood(['e4', 'Bxb2'], { capture: { piece: 'pawn', mover: 'black', free: false } })).toMatchObject({ line: 'They took a pawn.', spoken: true });
  expect(mood(['e4', 'Nxe4'], { capture: { piece: 'pawn', mover: 'black', free: true } }).line).toBe('Oops, that pawn was hanging.');
});
