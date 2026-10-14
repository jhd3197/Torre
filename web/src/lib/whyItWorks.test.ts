import i18n from '../i18n';
import { whyItWorks } from './whyItWorks';
import type { BoardState, EngineLine } from '../types';

const t = i18n.getFixedT('en', 'board');
const line = (san: string, uci: string, cp: number, mate: number | null = null): EngineLine =>
  ({ cp, mate, moves: [san], uci: [uci], depth: 14 }) as EngineLine;
const board = (pieces: Record<string, string>, control: Record<string, { white: string[]; black: string[] }> = {}) =>
  ({ pieces, control }) as unknown as BoardState;

test('a great move says how much the next best loses', () => {
  expect(whyItWorks(t, { grade: 'great', moverWhite: true, picks: [line('Rxa7', 'a1a7', 300), line('Ra2', 'a1a2', 0)] }))
    .toBe('Only good move: the next best loses 25%.');
  // For Black the engine's White view is turned around.
  expect(whyItWorks(t, { grade: 'great', moverWhite: false, picks: [line('Rxa2', 'a8a2', -300), line('Ra7', 'a8a7', 0)] }))
    .toBe('Only good move: the next best loses 25%.');
  expect(whyItWorks(t, { grade: 'great', moverWhite: true, picks: [line('Rxa7', 'a1a7', 300)] })).toBeNull();
});

test('a brilliant move names the piece it gives up and where', () => {
  const before = board({ d3: 'B', h7: 'p', g8: 'k' });
  const after = board({ h7: 'B', g8: 'k' }, { h7: { white: [], black: ['g8'] } });
  expect(whyItWorks(t, { grade: 'brilliant', moverWhite: true, picks: [], before, after, played: { uci: 'd3h7', san: 'Bxh7+' } }))
    .toBe('Gives up the bishop on h7, and it works.');
});

test('a miss names the mate that was there, or the piece the opponent left hanging', () => {
  expect(whyItWorks(t, { grade: 'miss', moverWhite: false, picks: [line('Qh2#', 'h4h2', 0, -2)] })).toBe('You had mate in 2.');
  const earlier = board({ d1: 'Q', e2: 'P' }, { d1: { white: [], black: [] } });
  const before = board({ g4: 'Q', e2: 'P' }, { g4: { white: [], black: ['c8'] } });
  expect(whyItWorks(t, { grade: 'miss', moverWhite: false, picks: [line('Bxg4', 'c8g4', -900)], earlier, before, previous: { uci: 'd1g4', san: 'Qg4' } }))
    .toBe('Your opponent’s last move left the queen on g4 hanging.');
  expect(whyItWorks(t, { grade: 'miss', moverWhite: true, picks: [] })).toBe('Your opponent’s last move gave you a chance here.');
});

test('forced and excellent moves, and nothing for the rest', () => {
  expect(whyItWorks(t, { grade: 'forced', moverWhite: true, picks: [] })).toBe('The only legal move.');
  expect(whyItWorks(t, { grade: 'excellent', moverWhite: true, picks: [line('Nf3', 'g1f3', 30)], played: { uci: 'd2d4', san: 'd4' } }))
    .toBe('Almost as good as Nf3.');
  expect(whyItWorks(t, { grade: 'good', moverWhite: true, picks: [line('Nf3', 'g1f3', 30)] })).toBeNull();
  expect(whyItWorks(t, { grade: 'blunder', moverWhite: true, picks: [] })).toBeNull();
});
