import { clockFlag, clocksBefore, clockSummary, inTrouble } from './clock';

// A 3-minute game: White's clock after each move, then Black's (seconds left).
const moves = [
  { uci: 'e2e4', san: 'e4', clock: 178 }, { uci: 'e7e5', san: 'e5', clock: 170 },
  { uci: 'g1f3', san: 'Nf3', clock: 150 }, { uci: 'b8c6', san: 'Nc6', clock: 25 },
  { uci: 'f1c4', san: 'Bc4', clock: 140 }, { uci: 'g8f6', san: 'Nf6', clock: 20 },
];
const think = [2, 10, 28, 145, 10, 5];

test('the clock before each move is the mover’s clock after their last one', () => {
  expect(clocksBefore(moves, 180)).toEqual([180, 180, 178, 170, 150, 25]);
  expect(clocksBefore(moves, null)).toEqual([null, null, 178, 170, 150, 25]);
});

test('time trouble is under 10% of the start clock or under 30 seconds', () => {
  expect(inTrouble(29, null)).toBe(true);
  expect(inTrouble(30, null)).toBe(false);
  expect(inTrouble(50, 600)).toBe(true);
  expect(inTrouble(70, 600)).toBe(false);
});

test('each side’s average think, and the move its time trouble began', () => {
  const summary = clockSummary(moves, think, 180, true);
  expect(summary.average.white).toBeCloseTo(40 / 3);
  expect(summary.average.black).toBeCloseTo(160 / 3);
  expect(summary.troubleAt).toEqual({ white: null, black: 6 });  // Black moved at 25 s left on ply 6
  expect(clockSummary(moves, think.map(() => null), 180, true).average).toEqual({ white: null, black: null });
});

test('an error played in a rush, and a long think that still went wrong, are flagged', () => {
  expect(clockFlag(3, 120, 'blunder', 24)).toBe('rushed');
  expect(clockFlag(8, 120, 'mistake', 24)).toBeNull();
  expect(clockFlag(8, 600, 'miss', 24)).toBe('rushed');      // under 3% of a 10-minute clock
  expect(clockFlag(3, 120, 'inaccuracy', 24)).toBeNull();    // a rushed inaccuracy is not worth a flag
  expect(clockFlag(40, 120, 'inaccuracy', 24)).toBe('longWrong');
  expect(clockFlag(40, 120, 'best', 24)).toBeNull();
  expect(clockFlag(null, 120, 'blunder', 24)).toBeNull();
});
