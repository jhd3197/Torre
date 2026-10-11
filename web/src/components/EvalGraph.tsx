// The game's evaluation over time, from the review: a strip in the panel that opens into a larger
// graph along the bottom of the window. White's share is the light area; your slips are dots on
// the line. Clicking either jumps the board to that move.
import { useEffect, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { scoreLabel, startPly } from '../lib/format';
import type { Grade } from '../lib/grades';

/** A White-POV score per ply (0 = the start), null where the review has none yet. */
export type EvalPoint = { cp: number | null; mate: number | null } | null;
export interface EvalMark { ply: number; grade: Grade; white: boolean; yours: boolean }

const SLIPS: Grade[] = ['inaccuracy', 'mistake', 'blunder'];
const CAP = 5; // pawns: the graph's top and bottom

/** Pawns for White, mates at the cap, a missing score carrying the last one forward. */
function pawns(points: EvalPoint[]): number[] {
  let last = 0;
  return points.map(point => {
    if (point?.mate != null) last = point.mate > 0 ? CAP : -CAP;
    else if (point?.cp != null) last = Math.max(-CAP, Math.min(CAP, point.cp / 100));
    return last;
  });
}

/** An area from the bottom edge up to the line, in a viewBox `width` wide and 100 tall. */
const area = (values: number[]) => {
  const y = (v: number) => (50 - v * (48 / CAP)).toFixed(2);
  return `M0 100 ${values.map((v, i) => `L${i} ${y(v)}`).join(' ')} L${values.length - 1} 100 Z`;
};
const top = (v: number) => `${50 - v * (48 / CAP)}%`;

export function EvalGraph({ points, marks, cursor, initialFen, sans, onGo }: {
  points: EvalPoint[];
  marks: EvalMark[];
  cursor: number;
  initialFen: string;
  /** Each move's SAN, for the readout. */
  sans: string[];
  onGo: (ply: number) => void;
}) {
  const { t } = useTranslation('games');
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const total = points.length - 1;

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); setHover(null); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  if (total < 1 || points.every(point => point == null)) return null;
  const values = pawns(points);
  const x = (ply: number) => `${(ply / total) * 100}%`;
  const at = (event: MouseEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(total, Math.round(((event.clientX - box.left) / box.width) * total)));
  };
  const first = startPly(initialFen);
  const moveName = (ply: number) => {
    const n = first + ply - 1;
    return `${Math.floor(n / 2) + 1}${n % 2 ? '…' : '.'} ${sans[ply - 1]}`;
  };
  const shown = hover ?? cursor;
  const point = points[shown];
  const score = point ? scoreLabel({ cp: point.cp ?? 0, mate: point.mate }) : '…';
  const grade = marks.find(mark => mark.ply === shown)?.grade;
  const readout = shown ? `${moveName(shown)}  ${score}${grade ? `  ${t(`game.gradeTable.${grade}`)}` : ''}` : `${t('graph.start')}  ${score}`;
  // Move numbers along the bottom, about five of them.
  const moves = Math.ceil((first + total) / 2);
  const step = [1, 2, 5, 10, 20, 50].find(s => moves / s <= 6) ?? 100;
  const ticks = Array.from({ length: Math.floor(moves / step) + 1 }, (_, i) => Math.max(1, i * step))
    .map(move => ({ move, ply: move * 2 - 1 - first }))
    .filter(tick => tick.ply >= 0 && tick.ply <= total);
  const slips = marks.filter(mark => SLIPS.includes(mark.grade));

  return (
    <>
      <button type="button" className="eval-strip" onClick={() => setOpen(true)} aria-expanded={open} aria-label={t('graph.open')} title={t('graph.open')}>
        <span className="eval-strip-label">⤢ {t('graph.expand')}</span>
        <svg viewBox={`0 0 ${total} 100`} preserveAspectRatio="none" aria-hidden="true">
          <path d={area(values)} />
          <line x1="0" x2={total} y1="50" y2="50" />
        </svg>
        {slips.filter(mark => mark.yours).map(mark => (
          <i key={mark.ply} className={`eval-dot dot-${mark.grade}`} style={{ left: x(mark.ply), top: top(values[mark.ply]) }} />
        ))}
        <b className="eval-cursor" style={{ left: x(cursor) }} />
      </button>
      {open && (
        <section className="eval-sheet" aria-label={t('graph.title')}>
          <div className="eval-sheet-head">
            <h2>{t('graph.title')}</h2>
            <span className="eval-readout">{readout}</span>
            <ul className="eval-legend">
              {SLIPS.map(slip => <li key={slip}><i className={`dot-${slip}`} />{t(`game.gradeTable.${slip}`)}</li>)}
            </ul>
            <button type="button" className="button" onClick={() => { setOpen(false); setHover(null); }}>{t('graph.close')}</button>
          </div>
          <div className="eval-sheet-body">
            <div className="eval-axis" aria-hidden="true"><span>+{CAP}</span><span>0</span><span>−{CAP}</span></div>
            <div className="eval-sheet-plot">
              <div className="eval-big" onMouseMove={event => setHover(at(event))} onMouseLeave={() => setHover(null)} onClick={event => onGo(at(event))}>
                <svg viewBox={`0 0 ${total} 100`} preserveAspectRatio="none" aria-hidden="true">
                  <path d={area(values)} />
                  <line x1="0" x2={total} y1="50" y2="50" vectorEffect="non-scaling-stroke" />
                </svg>
                <b className="eval-cursor" style={{ left: x(cursor) }} />
                {hover != null && <b className="eval-hover" style={{ left: x(hover) }} />}
                {slips.map(mark => (
                  <i key={mark.ply} className={`eval-dot dot-${mark.grade}${mark.white ? '' : ' by-black'}`}
                    style={{ left: x(mark.ply), top: top(values[mark.ply]) }} title={`${moveName(mark.ply)} · ${t(`game.gradeTable.${mark.grade}`)}`} />
                ))}
              </div>
              <div className="eval-ticks" aria-hidden="true">
                {ticks.map(tick => <span key={tick.move} style={{ left: x(tick.ply) }}>{tick.move}</span>)}
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
