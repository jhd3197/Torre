import { openingArt } from './art';

test('openings are matched by name, most specific first', () => {
  expect(openingArt('Indian / Trompowsky', 'A45')).toBe('art/openings/trompowsky.webp');
  expect(openingArt("King's Pawn: Uncommon", 'B00')).toBe('art/openings/kings-pawn.webp');
  expect(openingArt('Uncommon Openings', 'A00')).toBe('art/openings/uncommon.webp');
  expect(openingArt("Queen's Gambit Declined", 'D30')).toBe('art/openings/queens-gambit.webp');
  expect(openingArt('Pirc Defense', 'B07')).toBe('art/openings/pirc.webp');
});

test('an unnamed opening falls back to its ECO family', () => {
  expect(openingArt('A48', 'A48')).toBe('art/openings/queens-pawn.webp');
  expect(openingArt('D05', 'D05')).toBe('art/openings/colle.webp');
  expect(openingArt('C44', 'C44')).toBe('art/openings/kings-pawn.webp');
});

test('lessons find their art by slug, then by whole words', async () => {
  const { lessonArt } = await import('./art');
  expect(lessonArt('mikhail-tal')).toBe('art/history/tal.webp');
  expect(lessonArt('fischer-game-of-the-century')).toBe('art/history/fischer.webp');
  expect(lessonArt('fatal-pins')).toBe('art/badges/pin-color.webp'); // "tal" inside a word is not Tal
  expect(lessonArt('something-new')).toBe('art/badges/scholar-color.webp');
});

test('a series without its own art takes its champion or era', async () => {
  const { lessonArt } = await import('./art');
  expect(lessonArt('some-game', 'Judit Polgár')).toBe('art/history/polgar.webp');
  expect(lessonArt('hastings-1895', 'Great Tournaments')).toBe('art/history/romantic-era.webp');
  expect(lessonArt('the-rook', 'Rules of the game')).toBe('art/pieces/white-rook.webp');
});
