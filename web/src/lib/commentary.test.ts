import english from '../i18n/locales/en/commentary.json';
import spanish from '../i18n/locales/es/commentary.json';
import { language } from '../i18n';
import {
  DOMAINS, captureLine, longThink, captureOf, clockEventOf, durationWords, evalEventOf, hangsOf, moveWords, sacrificeOf, openingFamily, recapLines, resetVariety, reviewLines, swingOf, themeOf,
  thinkTimes, type EvalEvent, type Theme,
} from './commentary';
import type { BoardState } from '../types';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const SQUARES = [...'abcdefgh'].flatMap(file => [1, 2, 3, 4, 5, 6, 7, 8].map(rank => `${file}${rank}`));

/** Every line narrate.py records for a language (commentary_lines), openings aside: each template
 *  expanded over its placeholders' domains. A spoken result must only ever use these lines. */
function recorded(tree: Record<string, unknown>): Set<string> {
  const domains: Record<string, string[]> = { square: SQUARES, opening: ['Sicilian Defense'] };
  for (const [name, [low, high]] of Object.entries(DOMAINS)) domains[name] = Array.from({ length: high - low + 1 }, (_, i) => String(low + i));
  const lines = new Set<string>();
  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      let texts = [node];
      for (const name of new Set([...node.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]))) {
        texts = texts.flatMap(text => domains[name].map(value => text.replaceAll(new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'g'), value)));
      }
      texts.forEach(text => lines.add(text));
    } else if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(Object.fromEntries(Object.entries(tree).filter(([key]) => key !== '_domains')));
  return lines;
}

// Every draw takes the first line left in its pool, so the words are predictable; a test can reset it.
beforeEach(() => resetVariety(() => 0));
afterEach(() => resetVariety());

const board = (pieces: Record<string, string>, control: Record<string, { white: string[]; black: string[] }> = {}) =>
  ({ pieces, control }) as unknown as BoardState;

describe('moveWords', () => {
  test('says a SAN move as recorded fragments', () => {
    expect(moveWords('Nf3')).toEqual(['knight to f3']);
    expect(moveWords('Bxe5+')).toEqual(['bishop takes on e5', 'with check']);
    expect(moveWords('exd5')).toEqual(['pawn takes on d5']);
    expect(moveWords('bxc8=Q#')).toEqual(['pawn takes on c8', 'promoting to a queen', 'checkmate']);
    expect(moveWords('Rad1')).toEqual(['rook to d1']);
    expect(moveWords('O-O-O+')).toEqual(['castling long', 'with check']);
    expect(moveWords('O-O')).toEqual(['castling short']);
  });
});

describe('captureOf', () => {
  test('a capture nothing can take back is free', () => {
    const before = board({ e4: 'P', d5: 'n' });
    const after = board({ d5: 'P' }, { d5: { white: [], black: [] } });
    expect(captureOf(before, after, 'e4d5')).toEqual({ piece: 'knight', mover: 'white', free: true });
  });

  test('a defended piece is not free, but a king cannot take back a protected piece', () => {
    const before = board({ e4: 'P', d5: 'n', c6: 'p', e6: 'k', c4: 'B' });
    const defended = board({ d5: 'P', c6: 'p', e6: 'k', c4: 'B' }, { d5: { white: ['c4'], black: ['c6', 'e6'] } });
    expect(captureOf(before, defended, 'e4d5')?.free).toBe(false);
    const kingOnly = board({ d5: 'P', e6: 'k', c4: 'B' }, { d5: { white: ['c4'], black: ['e6'] } });
    expect(captureOf(before, kingOnly, 'e4d5')?.free).toBe(true);
  });

  test('en passant takes the pawn beside the square; a quiet move takes nothing', () => {
    const before = board({ e5: 'P', d5: 'p' });
    const after = board({ d6: 'P' }, { d6: { white: [], black: [] } });
    expect(captureOf(before, after, 'e5d6')?.piece).toBe('pawn');
    expect(captureOf(board({ e2: 'P' }), board({ e4: 'P' }), 'e2e4')).toBeNull();
  });

  test('the live coach names the piece from your side of the board', () => {
    expect(captureLine({ piece: 'knight', mover: 'white', free: true }, 'white')).toBe(english.live.free.knight[0]);
    expect(captureLine({ piece: 'rook', mover: 'black', free: true }, 'white')).toBe(english.live.hung.rook[0]);
    expect(captureLine({ piece: 'queen', mover: 'black', free: false }, 'white')).toBe(english.live.lost.queen[0]);
  });
});

describe('reviewLines', () => {
  // Draws take the first line left in each pool, so the words are predictable here.
  beforeEach(() => resetVariety(() => 0));
  afterEach(() => resetVariety());

  test('a quiet good or best move says nothing; one that did something says what', () => {
    expect(reviewLines({ san: 'h3', grade: 'good' })).toEqual([]);
    expect(reviewLines({ san: 'Nf3', grade: 'best', theme: { kind: 'develop', piece: 'knight' } })).toEqual([english.describe.develop.knight[0]]);
    expect(reviewLines({ san: 'Qxd8', grade: 'good', theme: { kind: 'trade', piece: 'queen' } })).toEqual([english.describe.trade.queen[0]]);
  });

  test('a free piece is called out instead of a quiet grade', () => {
    const lines = reviewLines({ san: 'Nxe5', grade: 'best', capture: { piece: 'knight', mover: 'white', free: true }, theme: { kind: 'takes', piece: 'knight' } });
    expect(lines).toEqual([english.free.knight[0]]);
  });

  test('a slip is named, and a free piece that loses is a trap', () => {
    const lines = reviewLines({ san: 'Bxb7', grade: 'blunder', capture: { piece: 'pawn', mover: 'white', free: true }, bestSan: 'O-O' });
    expect(lines).toEqual([english.grade.blunder[0], english.poisoned.pawn[0], 'The best move was', 'castling short']);
  });

  test('a missed mate, the better move, the opening and leaving the book', () => {
    expect(reviewLines({ san: 'Qd2', grade: 'mistake', missedMate: 2, bestSan: 'Qxf7#' }))
      .toEqual([english.grade.mistake[0], 'There was mate in 2 here.', 'The best move was', 'queen takes on f7', 'checkmate']);
    expect(reviewLines({ san: 'c5', grade: 'book', opening: 'Sicilian Defense' })).toEqual(['This is the Sicilian Defense.']);
    expect(reviewLines({ san: 'h3', grade: 'good', outOfBook: true })).toEqual([english.outOfBook[0]]);
  });

  test('a miss is named with the better move, even in the highlights; a forced move only in full', () => {
    expect(reviewLines({ san: 'Qd2', grade: 'miss', bestSan: 'Nf3' }, true))
      .toEqual([english.grade.miss[0], 'The best move was', 'knight to f3']);
    expect(reviewLines({ san: 'Kh1', grade: 'forced' })).toEqual([english.grade.forced[0]]);
    expect(reviewLines({ san: 'Kh1', grade: 'forced' }, true)).toEqual([]);
    expect(reviewLines({ san: 'a3', grade: 'excellent' })).toEqual([]);
  });

  test('a pool is used up before any line comes back, and never twice in a row', () => {
    resetVariety();
    const said = Array.from({ length: english.grade.blunder.length }, () => reviewLines({ san: 'Qh5', grade: 'blunder' })[0]);
    expect(new Set(said).size).toBe(english.grade.blunder.length);
    expect(reviewLines({ san: 'Qh5', grade: 'blunder' })[0]).not.toBe(said.at(-1));
  });

  test('the clock: a long think that worked, one that did not, and a fast slip', () => {
    resetVariety(() => 0);
    expect(reviewLines({ san: 'Nf3', grade: 'best', thinkSeconds: 150 })).toEqual(['That took', '3 minutes', 'Worth it.']);
    resetVariety(() => 0);
    expect(reviewLines({ san: 'Nf3', grade: 'blunder', thinkSeconds: 45 }).slice(1)).toEqual(['That took', '45 seconds', english.clock.stillWrong[0]]);
    resetVariety(() => 0);
    expect(reviewLines({ san: 'Nf3', grade: 'mistake', thinkSeconds: 1 }).slice(1)).toEqual([english.clock.fastWrong[0]]);
    resetVariety(() => 0);
    expect(reviewLines({ san: 'Nf3', grade: 'good', thinkSeconds: 8 })).toEqual([]);
    expect(durationWords(60)).toBe('a minute');
    expect([longThink('600'), longThink('180+2'), longThink('1/259200'), longThink('5400'), longThink()]).toEqual([24, 15, 30, 120, 30]);
    resetVariety(() => 0);
    expect(reviewLines({ san: 'Nf3', grade: 'best', thinkSeconds: 26, longThink: 24 })).toEqual(['That took', '26 seconds', 'Worth it.']);
  });
});

describe('themeOf', () => {
  const none = { white: [], black: [] };
  const theme = (san: string, uci: string, before: Record<string, string>, after: Record<string, string>, previous?: { uci: string; san: string }) =>
    themeOf(san, uci, board(before), board(after, { [uci.slice(2, 4)]: { white: ['a1'], black: ['a8'] } }), previous);

  test('castling, promotion and mate', () => {
    expect(theme('O-O', 'e1g1', { e1: 'K', h1: 'R' }, { g1: 'K', f1: 'R' })).toEqual({ kind: 'castleShort' });
    expect(theme('O-O-O', 'e8c8', { e8: 'k', a8: 'r' }, { c8: 'k', d8: 'r' })).toEqual({ kind: 'castleLong' });
    expect(theme('a8=Q+', 'a7a8q', { a7: 'P' }, { a8: 'Q' })).toEqual({ kind: 'promote', piece: 'queen' });
    expect(theme('Qh7#', 'h5h7', { h5: 'Q' }, { h7: 'Q' })).toEqual({ kind: 'mate' });
  });

  test('captures: a recapture, a trade of like pieces, or taking something', () => {
    expect(theme('Bxe6', 'c4e6', { c4: 'B', e6: 'b' }, { e6: 'B' })).toEqual({ kind: 'trade', piece: 'bishop' });
    expect(theme('Nxd5', 'f4d5', { f4: 'N', d5: 'b' }, { d5: 'N' })).toEqual({ kind: 'takes', piece: 'bishop' });
    expect(theme('fxe6', 'f7e6', { f7: 'p', e6: 'B' }, { e6: 'p' }, { uci: 'c4e6', san: 'Bxe6' })).toEqual({ kind: 'recapture' });
  });

  test('checks, development, the open file, a passed pawn and the center', () => {
    expect(theme('Bb5+', 'f1b5', { f1: 'B' }, { b5: 'B' })).toEqual({ kind: 'check', piece: 'bishop' });
    expect(theme('Nf6', 'g8f6', { g8: 'n' }, { f6: 'n' })).toEqual({ kind: 'develop', piece: 'knight' });
    expect(theme('Rd1', 'a1d1', { a1: 'R', e2: 'P' }, { d1: 'R', e2: 'P' })).toEqual({ kind: 'openFile' });
    expect(theme('Rd1', 'a1d1', { a1: 'R', d4: 'P' }, { d1: 'R', d4: 'P' })).toBeNull();
    expect(theme('b6', 'b5b6', { b5: 'P', h7: 'p' }, { b6: 'P', h7: 'p' })).toEqual({ kind: 'passedPawn' });
    expect(theme('b6', 'b5b6', { b5: 'P', a7: 'p' }, { b6: 'P', a7: 'p' })).toBeNull();
    expect(theme('e4', 'e2e4', { e2: 'P' }, { e4: 'P' })).toEqual({ kind: 'center' });
    expect(themeOf('h3', 'h2h3', board({ h2: 'P' }), board({ h3: 'P' }, { h3: none }))).toBeNull();
  });

  test('forks, attacks, tempo, an early queen, a king walk and an uncastled king', () => {
    // The knight on c7 hits the king and the rook: a royal fork, named by the piece beside the king.
    const forked = board({ c7: 'N', e8: 'k', a8: 'r' }, { e8: { white: ['c7'], black: [] }, a8: { white: ['c7'], black: [] }, c7: none });
    expect(themeOf('Nc7+', 'b5c7', board({ b5: 'N', e8: 'k', a8: 'r' }), forked)).toEqual({ kind: 'forkKing', piece: 'rook' });
    const two = board({ d5: 'N', c7: 'r', e7: 'b' }, { c7: { white: ['d5'], black: [] }, e7: { white: ['d5'], black: [] }, d5: none });
    expect(themeOf('Nd5', 'b4d5', board({ b4: 'N', c7: 'r', e7: 'b' }), two)).toEqual({ kind: 'fork' });
    // A defended piece worth no more than the attacker is not a target; a queen is.
    const hits = board({ g5: 'B', d8: 'q' }, { d8: { white: ['g5'], black: ['e8'] }, g5: none });
    expect(themeOf('Bg5', 'e3g5', board({ e3: 'B', d8: 'q' }), hits)).toEqual({ kind: 'attacks', piece: 'queen' });
    const tempo = board({ g5: 'B', f6: 'n' }, { f6: { white: ['g5'], black: [] }, g5: none });
    expect(themeOf('Bg5', 'c1g5', board({ c1: 'B', f6: 'n' }), tempo)).toEqual({ kind: 'tempo', piece: 'bishop' });
    expect(themeOf('Qh5', 'd1h5', board({ d1: 'Q' }), board({ h5: 'Q' }, { h5: none }), undefined, 3)).toEqual({ kind: 'earlyQueen' });
    expect(themeOf('Qh5', 'd1h5', board({ d1: 'Q' }), board({ h5: 'Q' }, { h5: none }), undefined, 41)).toBeNull();
    expect(themeOf('Ke2', 'e1e2', board({ e1: 'K', d1: 'Q', d8: 'q' }), board({ e2: 'K', d1: 'Q', d8: 'q' }, { e2: none }))).toEqual({ kind: 'kingWalk' });
    expect(themeOf('a3', 'a2a3', board({ a2: 'P', e1: 'K' }), board({ a3: 'P', e1: 'K' }, { a3: none }), undefined, 23)).toEqual({ kind: 'kingCenter' });
  });
});

describe('evaluation swings and the clock', () => {
  test('a swing is named once, when it crosses a line', () => {
    expect(evalEventOf([20, null], [350, null], true)).toEqual({ kind: 'winning', side: 'white' });
    expect(evalEventOf([350, null], [420, null], true)).toBeNull(); // already winning: nothing new
    expect(evalEventOf([40, null], [-130, null], false)).toEqual({ kind: 'better', side: 'black' });
    expect(evalEventOf([250, null], [-200, null], true)).toEqual({ kind: 'flipped', side: 'black' });
    expect(evalEventOf([400, null], [80, null], true)).toEqual({ kind: 'slipAway' });
    expect(evalEventOf([-220, null], [10, null], false)).toEqual({ kind: 'equal' });
    expect(evalEventOf([500, null], [null, 3], true)).toEqual({ kind: 'mate', side: 'white' });
    expect(evalEventOf([null, 3], [null, 2], true)).toBeNull(); // the mate was already there
    expect(evalEventOf([900, null], [null, 2], false, [null, 3])).toBeNull(); // announced a move ago; the engine flickered
  });

  test('the clock is called when it drops under a minute, then under ten seconds', () => {
    expect([clockEventOf(55, 64), clockEventOf(8, 12), clockEventOf(50, 55), clockEventOf(null, 70)]).toEqual(['lowMinute', 'lowSeconds', null, null]);
  });

  test('a swing follows a quiet move; a slip that only hands over an edge says no more', () => {
    resetVariety(() => 0);
    expect(reviewLines({ san: 'Rd1', grade: 'good', evalEvent: { kind: 'winning', side: 'white' }, clockEvent: 'lowMinute' }))
      .toEqual([english.eval.winning.white[0], english.clock.lowMinute[0]]);
    expect(reviewLines({ san: 'h4', grade: 'inaccuracy', evalEvent: { kind: 'better', side: 'black' } })).toEqual([english.grade.inaccuracy[0]]);
    // A long think before a move that hands the other side mate is not "worth it".
    expect(reviewLines({ san: 'h4', grade: 'good', moverWhite: false, thinkSeconds: 40, evalEvent: { kind: 'mate', side: 'white' } }))
      .toEqual([english.eval.mate.white[0]]);
    resetVariety();
  });
});

describe('sacrifices, pins, repeated checks and repetition', () => {
  const none = { white: [], black: [] };
  test('a pin along the moved piece’s line: to the king, or to something worth more', () => {
    expect(themeOf('Bg5', 'c1g5', board({ c1: 'B', f6: 'n', d8: 'q' }), board({ g5: 'B', f6: 'n', d8: 'q' }, { g5: none })))
      .toEqual({ kind: 'pin', piece: 'knight' });
    expect(themeOf('Bb5', 'f1b5', board({ f1: 'B', c6: 'n', e8: 'k' }), board({ b5: 'B', c6: 'n', e8: 'k' }, { b5: none })))
      .toEqual({ kind: 'pinKing', piece: 'knight' });
    // A pawn in front is no pin, and a piece behind worth less is no pin either.
    expect(themeOf('Bg5', 'c1g5', board({ c1: 'B', f6: 'p', d8: 'q' }), board({ g5: 'B', f6: 'p', d8: 'q' }, { g5: none })))
      .toEqual({ kind: 'develop', piece: 'bishop' });
    expect(themeOf('Re1', 'a1e1', board({ a1: 'R', e5: 'q', e8: 'n' }), board({ e1: 'R', e5: 'q', e8: 'n' }, { e1: none }))).toEqual({ kind: 'openFile' });
  });

  test('a second check in a row by the same side', () => {
    const before = board({ d1: 'Q' }), after = board({ h5: 'Q' }, { h5: none });
    expect(themeOf('Qh5+', 'd1h5', before, after, undefined, 30, { uci: 'd2d1', san: 'Qd1+' })).toEqual({ kind: 'checkAgain' });
    expect(themeOf('Qh5+', 'd1h5', before, after, undefined, 30, { uci: 'd2d1', san: 'Qd1' })).toEqual({ kind: 'check', piece: 'queen' });
  });

  test('a sacrifice gives up the moving piece for less than it is worth', () => {
    // Bxh7+: the bishop takes a pawn where only the king can take it, and nothing guards it.
    expect(sacrificeOf(board({ d3: 'B', h7: 'p', g8: 'k' }), board({ h7: 'B', g8: 'k' }, { h7: { white: [], black: ['g8'] } }), 'd3h7')).toBe('bishop');
    // A guarded piece that only the king attacks is not a sacrifice; nor is an even trade.
    expect(sacrificeOf(board({ d3: 'B', h7: 'p', g8: 'k' }), board({ h7: 'B', g8: 'k' }, { h7: { white: ['h5'], black: ['g8'] } }), 'd3h7')).toBeNull();
    expect(sacrificeOf(board({ f4: 'N', d5: 'b' }), board({ d5: 'N', c6: 'p' }, { d5: { white: ['e4'], black: ['c6'] } }), 'f4d5')).toBeNull();
    // Rook to a square a pawn covers, with nothing taken: the rook is offered.
    expect(sacrificeOf(board({ g1: 'R' }), board({ g6: 'R', h7: 'p' }, { g6: { white: ['g2'], black: ['h7'] } }), 'g1g6')).toBe('rook');
  });

  test('the coach names a sacrifice for a sound move, and the position repeating', () => {
    resetVariety(() => 0);
    expect(reviewLines({ san: 'Bxh7+', grade: 'brilliant', sacrifice: 'bishop', theme: { kind: 'check', piece: 'bishop' } }))
      .toEqual([english.grade.brilliant[0], english.describe.sacrifice.bishop[0]]);
    expect(reviewLines({ san: 'Bxh7+', grade: 'blunder', sacrifice: 'bishop' })).toEqual([english.grade.blunder[0]]);
    expect(reviewLines({ san: 'Rxf6', grade: 'great', sacrifice: 'rook', capture: { piece: 'knight', mover: 'white', free: false } }))
      .toEqual([english.grade.great[0], english.describe.exchangeSac[0]]);
    expect(reviewLines({ san: 'Kg1', grade: 'good', repetition: 1 })).toEqual([english.momentum.repeat[0]]);
    expect(reviewLines({ san: 'Kg1', grade: 'good', repetition: 2 })).toEqual([english.momentum.threefold[0]]);
    resetVariety();
  });
});

describe('momentum and the end of the game', () => {
  test('a slip answered by a slip, a late first capture, and the result on the last move', () => {
    resetVariety(() => 0);
    expect(reviewLines({ san: 'Qg1', grade: 'blunder', answersSlip: true }).slice(0, 2)).toEqual([english.grade.blunder[0], english.momentum.blunderBack[0]]);
    expect(reviewLines({ san: 'Qg1', grade: 'inaccuracy', answersSlip: true })).toEqual([english.grade.inaccuracy[0]]);
    expect(reviewLines({ san: 'exd5', grade: 'good', firstCapture: true })).toEqual([english.momentum.firstCapture[0]]);
    expect(reviewLines({ san: 'Qh7#', grade: 'best', theme: { kind: 'mate' }, result: '1-0' })).toEqual([english.describe.mate[0], english.end.white[0]]);
    expect(reviewLines({ san: 'Kf1', grade: 'good', result: '1/2-1/2' })).toEqual([english.end.draw[0]]);
    expect(reviewLines({ san: 'Kf1', grade: 'good', result: '*' })).toEqual([]);
    resetVariety();
  });
});

describe('highlights and variety', () => {
  test('playing through, only the highlights are said', () => {
    expect(reviewLines({ san: 'Nf3', grade: 'good', theme: { kind: 'develop', piece: 'knight' } }, true)).toEqual([]);
    expect(reviewLines({ san: 'h4', grade: 'inaccuracy', bestSan: 'Nf3' }, true)).toEqual([]);
    expect(reviewLines({ san: 'Nf3', grade: 'good', outOfBook: true, firstCapture: true, thinkSeconds: 90, clockEvent: 'lowMinute' }, true)).toEqual([]);
    expect(reviewLines({ san: 'Qh5', grade: 'blunder', hangs: 'knight', bestSan: 'Nf3' }, true))
      .toEqual([english.grade.blunder[0], english.better[0], 'knight to f3']);
    expect(reviewLines({ san: 'Qxf7#', grade: 'best', theme: { kind: 'mate' }, result: '1-0' }, true)).toEqual([english.describe.mate[0], english.end.white[0]]);
    expect(reviewLines({ san: 'Rd1', grade: 'good', evalEvent: { kind: 'better', side: 'white' } }, true)).toEqual([]);
    expect(reviewLines({ san: 'Rd1', grade: 'good', evalEvent: { kind: 'winning', side: 'white' } }, true)).toEqual([english.eval.winning.white[0]]);
  });

  test('a fixed phrase goes round its pool: never twice in a row, all of it before any repeats', () => {
    resetVariety();
    const intro = () => reviewLines({ san: 'Qh5', grade: 'mistake', bestSan: 'Nf3' })[1];
    const said = english.better.map(intro);
    expect(new Set(said).size).toBe(english.better.length);
    expect(intro()).not.toBe(said.at(-1));
  });
});

describe('hangsOf', () => {
  const none = { white: [], black: [] };
  test('a slip that leaves a piece undefended under attack, and not one that was already hanging', () => {
    // Moving the bishop away from d3 drops the guard on the knight on e4, which the f5 pawn attacks.
    const before = board({ d3: 'B', e4: 'N', f5: 'p' }, { e4: { white: ['d3'], black: ['f5'] }, d3: none });
    const after = board({ b5: 'B', e4: 'N', f5: 'p' }, { e4: { white: [], black: ['f5'] }, b5: none });
    expect(hangsOf(before, after, 'd3b5')).toBe('knight');
    const already = board({ d3: 'B', e4: 'N', f5: 'p' }, { e4: { white: [], black: ['f5'] }, d3: none });
    expect(hangsOf(already, after, 'd3b5')).toBeNull();
    // The moved piece itself, put on an attacked square with no guard.
    expect(hangsOf(board({ c1: 'R' }), board({ c7: 'R', d8: 'q' }, { c7: { white: [], black: ['d8'] } }), 'c1c7')).toBe('rook');
  });

  test('a slip says why when it leaves a piece hanging', () => {
    resetVariety(() => 0);
    expect(reviewLines({ san: 'Bb5', grade: 'mistake', hangs: 'knight' })).toEqual([english.grade.mistake[0], english.reason.hangs.knight[0]]);
    expect(reviewLines({ san: 'Bb5', grade: 'good', hangs: 'knight' })).toEqual([]);
    resetVariety();
  });
});

describe('the game recap', () => {
  test('tells the story of the evaluation', () => {
    const evals: [number, null][] = [[20, null], [30, null], [-450, null], [-200, null], [400, null], [900, null]];
    expect(swingOf(evals, 'white', 'won', START)).toEqual({ kind: 'comeback', move: 1 });
    expect(swingOf(evals.map(([cp]) => [-cp, null] as [number, null]), 'black', 'won', START)).toEqual({ kind: 'comeback', move: 1 });
    expect(swingOf(evals, 'black', 'lost', START)).toEqual({ kind: 'collapse', move: 1 });
    expect(swingOf([[0, null], [40, null], [80, null], [0, 1]], 'white', 'won', START)).toEqual({ kind: 'control' });
  });

  test('says the result, the swing, accuracy, the slips and the longest think', () => {
    expect(recapLines({
      outcome: 'won', swing: { kind: 'comeback', move: 23 }, accuracy: 81.6, counts: { brilliant: 1, mistake: 2, blunder: 0 },
      longestThink: { seconds: 200, move: 31, good: true },
    })).toEqual([
      'You won!', 'You were losing badly on move 23, and still turned it around.', '82 percent accuracy.', 'One brilliant move.', '2 mistakes.',
      'And not a single blunder.', 'Your longest think was', '3 minutes', 'on move 31', 'and it paid off.',
    ]);
  });

  test('says the estimated ratings when they were recorded', () => {
    expect(recapLines({ outcome: null, rating: { you: 1650, opp: 1400 } })).toEqual(['You played like 1650.', 'Your opponent played like 1400.']);
    // A refused estimate, or one off the recorded steps of 50, is left out.
    expect(recapLines({ outcome: null, rating: { you: null, opp: 1425 } })).toEqual([]);
    expect(DOMAINS.rating).toEqual([400, 3000, 50]);
  });

  test('clock times come from the clocks left and the increment', () => {
    const moves = [{ uci: 'e2e4', san: 'e4', clock: 178 }, { uci: 'e7e5', san: 'e5', clock: 170 }, { uci: 'g1f3', san: 'Nf3', clock: 150 }, { uci: 'b8c6', san: 'Nc6' }];
    expect(thinkTimes(moves, '180+2')).toEqual([4, 12, 30, null]);
    expect(thinkTimes([{ uci: 'e2e4', san: 'e4' }])).toEqual([null]);
    expect(openingFamily('French Defense, Classical, 4. Bg5')).toBe('French Defense');
    expect(openingFamily('Sicilian Defense: Najdorf Variation')).toBe('Sicilian Defense');
  });
});

const PIECE_NAMES = ['pawn', 'knight', 'bishop', 'rook', 'queen'] as const;
const THEMES: Theme[] = [
  ...(['castleShort', 'castleLong', 'mate', 'recapture', 'openFile', 'passedPawn', 'center', 'fork', 'earlyQueen', 'kingWalk', 'kingCenter', 'checkAgain'] as const).map(kind => ({ kind })),
  ...(['queen', 'rook', 'bishop', 'knight'] as const).flatMap(piece => [{ kind: 'forkKing' as const, piece }, { kind: 'attacks' as const, piece }, { kind: 'pin' as const, piece }, { kind: 'pinKing' as const, piece }]),
  { kind: 'tempo', piece: 'knight' }, { kind: 'tempo', piece: 'bishop' },
  ...(['queen', 'rook', 'bishop', 'knight'] as const).map(piece => ({ kind: 'promote' as const, piece })),
  ...PIECE_NAMES.flatMap(piece => [{ kind: 'trade' as const, piece }, { kind: 'takes' as const, piece }, { kind: 'check' as const, piece }]),
  { kind: 'check', piece: 'king' }, { kind: 'develop', piece: 'knight' }, { kind: 'develop', piece: 'bishop' },
];

const EVENTS: EvalEvent[] = [
  { kind: 'equal' }, { kind: 'slipAway' },
  ...(['winning', 'better', 'flipped', 'mate'] as const).flatMap(kind => (['white', 'black'] as const).map(side => ({ kind, side }))),
];

test('every line the commentary builds is one narrate.py records, in both languages', () => {
  const scenarios = () => [
    ...['Nf3', 'Bxe5+', 'exd5', 'bxc8=Q#', 'O-O-O', 'Kxh8', 'a1=N+'].flatMap(moveWords),
    ...(['brilliant', 'great', 'best', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'] as const).flatMap(grade =>
      [0, 1, 2, 3, 4, 5].flatMap(round => reviewLines({
        san: 'Nf3', grade, capture: { piece: 'rook', mover: 'white', free: true }, bestSan: 'Qxh7#', missedMate: round + 1,
        opening: 'Sicilian Defense', outOfBook: true, thinkSeconds: [1, 40, 600][round % 3],
      }))),
    // Every theme, drawn enough times to go through each pool.
    ...THEMES.flatMap(theme => [0, 1, 2, 3, 4, 5].flatMap(() => reviewLines({ san: 'Nf3', grade: 'good', theme }))),
    ...(['knight', 'bishop', 'rook', 'queen'] as const).flatMap(hangs => [0, 1, 2].flatMap(() => reviewLines({ san: 'Nf3', grade: 'blunder', hangs }))),
    ...EVENTS.flatMap(evalEvent => [0, 1, 2, 3].flatMap(() => reviewLines({ san: 'Nf3', grade: 'good', evalEvent, clockEvent: 'lowMinute' }))),
    ...[0, 1, 2].flatMap(() => reviewLines({ san: 'Nf3', grade: 'good', clockEvent: 'lowSeconds' })),
    ...[0, 1, 2, 3, 4].flatMap(() => reviewLines({ san: 'Nf3', grade: 'blunder', answersSlip: true, firstCapture: true })),
    ...(['1-0', '0-1', '1/2-1/2'] as const).flatMap(result => [0, 1, 2].flatMap(() => reviewLines({ san: 'Nf3', grade: 'good', result }))),
    ...(['pawn', 'knight', 'bishop', 'rook', 'queen'] as const).flatMap(sacrifice => [0, 1, 2].flatMap(() => reviewLines({ san: 'Nf3', grade: 'great', sacrifice }))),
    ...[0, 1, 2].flatMap(() => reviewLines({ san: 'Rxf6', grade: 'good', sacrifice: 'rook', capture: { piece: 'bishop', mover: 'white', free: false } })),
    ...[1, 2].flatMap(repetition => [0, 1, 2].flatMap(() => reviewLines({ san: 'Nf3', grade: 'good', repetition }))),
    ...(['won', 'lost', 'drew'] as const).flatMap(outcome => recapLines({
      outcome, swing: { kind: 'saved', move: 80 }, accuracy: 100, counts: { brilliant: 20, mistake: 1, blunder: 3 },
      longestThink: { seconds: 59, move: 1, good: false },
    })),
    ...(['pawn', 'knight', 'bishop', 'rook', 'queen'] as const).flatMap(piece =>
      [true, false].flatMap(free => ['white', 'black'].map(mover => captureLine({ piece, mover: mover as 'white', free }, 'white')))),
  ];
  for (const [lang, tree] of [['en', english], ['es', spanish]] as const) {
    language.set(lang);
    const lines = recorded(tree), built = scenarios();
    expect(built.length).toBeGreaterThan(50);
    expect(built.filter(line => !lines.has(line))).toEqual([]);
  }
});
