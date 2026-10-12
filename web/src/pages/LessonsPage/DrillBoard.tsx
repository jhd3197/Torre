// The drill board (Torre Lesson design): a bare board with one piece of yours, your pawns, Black's
// pieces, and the goal markers (bobbing stars, a flag). Tapping a square is the only input.
import { useTranslation } from 'react-i18next';
import { squareName, type DrillPiece } from '../../lib/drills';
import { pieceSrc, usePieceSet } from '../../lib/pieces';

export interface DrillMarks {
  /** Squares the piece can move to (a dot), or take on (a ring). */
  dots: number[];
  rings: number[];
  /** Hint squares that glow. */
  glow: number[];
  arrow: { from: number; to: number; tone: 'hint' | 'watch' } | null;
  /** A refused tap flashes red; the last move is tinted; a collected star bursts. */
  wrong: number | null;
  last: { from: number; to: number } | null;
  burst: number | null;
  /** The piece's square once the drill is solved (green). */
  solved: number | null;
  /** Its square while it waits for your move (gold). */
  active: number | null;
}

const STAR = 'M12 2.8l2.75 5.6 6.15.9-4.45 4.35 1.05 6.1L12 16.9l-5.5 2.85 1.05-6.1L3.1 9.3l6.15-.9z';
const PIECE_NAMES: Record<string, string> = { r: 'rook', b: 'bishop', q: 'queen', n: 'knight', k: 'king', p: 'pawn' };

export function DrillStar() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12.5" r="12" className="drill-star-glow" />
      <path d={STAR} className="drill-star-shade" transform="translate(0 1.2)" />
      <path d={STAR} className="drill-star-face" />
      <path d="M9.4 9.6c.6-1.3 1.3-2.6 2-3.9" className="drill-star-shine" />
    </svg>
  );
}

export function DrillBoard({ piece, at, own, enemies, stars, flag, marks, onTap, interactive }: {
  piece: DrillPiece;
  at: number;
  own: number[];
  enemies: Record<number, string>;
  stars: number[];
  flag: number | null;
  marks: DrillMarks;
  onTap: (square: number) => void;
  interactive: boolean;
}) {
  const { t } = useTranslation('lessons');
  const set = usePieceSet();
  const ownSet = new Set(own);
  const point = (i: number) => [(i & 7) + 0.5, (i >> 3) + 0.5];
  let arrow = null;
  if (marks.arrow) {
    const [x1, y1] = point(marks.arrow.from), [bx, by] = point(marks.arrow.to);
    const dx = bx - x1, dy = by - y1, d = Math.hypot(dx, dy);
    arrow = { x1, y1, x2: bx - (dx / d) * 0.38, y2: by - (dy / d) * 0.38, tone: marks.arrow.tone };
  }
  return (
    <div className={`drill-board${interactive ? ' interactive' : ''}`} role="group" aria-label={t('drill.board')}>
      {Array.from({ length: 64 }, (_, i) => {
        const light = ((i >> 3) + (i & 7)) % 2 === 0;
        const symbol = i === at ? piece : ownSet.has(i) ? 'P' : enemies[i];
        const isStar = stars.includes(i) && !symbol;
        const isFlag = flag === i && !symbol;
        const classes = ['drill-square', light ? 'light' : 'dark',
          marks.solved === i ? 'solved' : marks.active === i ? 'active' : '',
          marks.last && (marks.last.from === i || marks.last.to === i) ? 'last' : '',
          marks.wrong === i ? 'wrong' : ''].filter(Boolean).join(' ');
        const name = squareName(i);
        const label = symbol
          ? `${t(`drill.side.${symbol === symbol.toUpperCase() ? 'white' : 'black'}`)} ${t(`drill.piece.${symbol.toUpperCase()}`)} ${name}`
          : isStar ? t('drill.starOn', { square: name }) : isFlag ? t('drill.flagOn', { square: name }) : name;
        return (
          <button key={i} type="button" className={classes} aria-label={label} tabIndex={interactive ? 0 : -1}
            onClick={() => onTap(i)}>
            {marks.glow.includes(i) && <span className="drill-glow" />}
            {(i & 7) === 0 && <span className="drill-rank">{8 - (i >> 3)}</span>}
            {i >> 3 === 7 && <span className="drill-file">{name[0]}</span>}
            {symbol && <img src={pieceSrc(symbol, set)} alt="" className={`drill-piece${symbol === symbol.toLowerCase() ? ' enemy' : ''}`}
              data-piece={PIECE_NAMES[symbol.toLowerCase()]} draggable={false} />}
            {isStar && <span className="drill-star" style={{ animationDelay: `${(((i * 37) % 10) / 10) * -2.6}s` }}><DrillStar /></span>}
            {isFlag && <span className="drill-flag" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M6 21V4" /><path d="M6 4h11l-2.5 4L17 12H6" /></svg>
            </span>}
            {marks.burst === i && <span className="drill-burst" />}
            {marks.dots.includes(i) && !symbol && !isStar && !isFlag && <span className="drill-dot" />}
            {(marks.rings.includes(i) || (marks.dots.includes(i) && (symbol || isStar || isFlag))) && <span className="drill-ring" />}
          </button>
        );
      })}
      <svg className="drill-arrows" viewBox="0 0 8 8" aria-hidden="true">
        <defs>
          <marker id="drill-head-hint" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="drill-head hint" />
          </marker>
          <marker id="drill-head-watch" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="drill-head watch" />
          </marker>
        </defs>
        {arrow && <line x1={arrow.x1} y1={arrow.y1} x2={arrow.x2} y2={arrow.y2} className={`drill-arrow ${arrow.tone}`}
          markerEnd={`url(#drill-head-${arrow.tone})`} />}
      </svg>
    </div>
  );
}
