import { describe, expect, test } from 'vitest';
import { applyUci, evalLabel, fromFen, squareIndex, squareName, whiteWinPct } from './stage';
import { START_FEN } from './format';

const at = (pos: ReturnType<typeof fromFen>, name: string) =>
  pos.pieces.find(p => p.square === squareIndex(name))?.symbol ?? null;

describe('stage board', () => {
  test('squares round-trip', () => {
    expect(squareIndex('a8')).toBe(0);
    expect(squareIndex('h1')).toBe(63);
    expect(squareName(squareIndex('e4'))).toBe('e4');
  });

  test('a move keeps the piece id and removes the captured piece', () => {
    const pos = fromFen('r1bb1r1k/p4ppp/2p2n1N/7Q/2p5/2B2N2/qPP2PPP/2KR3R w - - 2 19');
    const queen = pos.pieces.find(p => p.symbol === 'Q')!;
    const { position, captured } = applyUci(pos, 'h5f7');
    expect(captured?.symbol).toBe('p');
    expect(position.pieces).toHaveLength(pos.pieces.length - 1);
    expect(position.pieces.find(p => p.id === queen.id)?.square).toBe(squareIndex('f7'));
    expect(position.turn).toBe('b');
  });

  test('castling moves the rook too', () => {
    const pos = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const short = applyUci(pos, 'e1g1').position;
    expect(at(short, 'g1')).toBe('K');
    expect(at(short, 'f1')).toBe('R');
    expect(at(short, 'h1')).toBeNull();
    const long = applyUci(fromFen('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1'), 'e8c8').position;
    expect(at(long, 'c8')).toBe('k');
    expect(at(long, 'd8')).toBe('r');
  });

  test('en passant and promotion', () => {
    let pos = fromFen(START_FEN);
    for (const m of ['e2e4', 'a7a6', 'e4e5', 'd7d5']) pos = applyUci(pos, m).position;
    const ep = applyUci(pos, 'e5d6');
    expect(ep.captured?.symbol).toBe('p');
    expect(at(ep.position, 'd5')).toBeNull();

    const promo = applyUci(fromFen('8/4P3/8/8/8/8/8/k6K w - - 0 1'), 'e7e8q').position;
    expect(at(promo, 'e8')).toBe('Q');
  });

  test('eval display', () => {
    expect(whiteWinPct(0)).toBe(50);
    expect(whiteWinPct(400)).toBeGreaterThan(80);
    expect(evalLabel(367)).toBe('+3.7');
    expect(evalLabel(-9995)).toBe('M5');
    expect(evalLabel(10000)).toBe('#');
  });
});
