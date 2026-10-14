// Time per move, under the evaluation strip and on the same x-axis: a bar for each move's think, White's
// above the line and Black's below, with each side's clock running down behind them. An error played in
// a rush and a long think that still went wrong are marked. Shown only when the game recorded clocks.
import { useTranslation } from 'react-i18next';
import { clockFlag, clocksBefore, clockSummary } from '../lib/clock';
import { startPly } from '../lib/format';
import type { Grade } from '../lib/grades';
import type { Color, Move } from '../types';

/** "8 s", "2 min 5 s". */
export function useSeconds() {
  const { t } = useTranslation('games');
  return (seconds: number) => {
    const n = Math.round(seconds);
    return n < 60 ? t('clock.seconds', { n }) : t('clock.minutes', { m: Math.floor(n / 60), s: n % 60 });
  };
}

export function ClockGraph({ moves, thinkTimes, startClock, grades, longThink, initialFen, cursor, onGo }: {
  moves: Move[];
  /** Seconds each move took (commentary.thinkTimes), null where unknown. */
  thinkTimes: (number | null)[];
  /** The starting clock in seconds, when the time control says it. */
  startClock: number | null;
  /** Each move's grade by ply, where the review has one. */
  grades: Map<number, Grade>;
  /** Seconds that count as a long think in this game. */
  longThink: number;
  initialFen: string;
  cursor: number;
  onGo: (ply: number) => void;
}) {
  const { t } = useTranslation('games');
  const say = useSeconds();
  const total = moves.length;
  if (total < 1 || thinkTimes.every(seconds => seconds == null)) return null;
  const first = startPly(initialFen);
  const whiteAt = (i: number) => (first + i) % 2 === 0;
  const top = Math.max(longThink * 2, ...thinkTimes.map(s => s ?? 0));
  const before = clocksBefore(moves, startClock);
  const x = (ply: number) => `${((ply - 0.5) / total) * 100}%`;
  const width = `${Math.max(0.6, 80 / total)}%`;
  // Each side's clock after its moves, as a share of the start: a line that runs down.
  const line = (white: boolean) => startClock ? moves.map((move, i) => (whiteAt(i) === white && move.clock != null
    ? `${i + 0.5},${100 - Math.min(1, move.clock / startClock) * 100}` : null)).filter(Boolean).join(' ') : '';
  const name = (i: number) => `${Math.floor((first + i) / 2) + 1}${whiteAt(i) ? '.' : '…'} ${moves[i].san}`;

  return (
    <div className="clock-graph" role="group" aria-label={t('clock.title')}>
      {startClock && (
        <svg viewBox={`0 0 ${total} 100`} preserveAspectRatio="none" aria-hidden="true">
          <polyline className="clock-left white" points={line(true)} vectorEffect="non-scaling-stroke" />
          <polyline className="clock-left black" points={line(false)} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <b className="clock-mid" aria-hidden="true" />
      {thinkTimes.map((seconds, i) => {
        if (seconds == null) return null;
        const flag = clockFlag(seconds, before[i], grades.get(i + 1), longThink);
        const tip = [name(i), say(seconds), flag && t(`clock.${flag}`)].filter(Boolean).join(' · ');
        return (
          <button key={i} type="button" title={tip} aria-label={tip} onClick={() => onGo(i + 1)}
            className={`clock-bar ${whiteAt(i) ? 'by-white' : 'by-black'}${flag ? ` ${flag}` : ''}${cursor === i + 1 ? ' current' : ''}`}
            style={{ left: x(i + 1), width, height: `${Math.max(2, (seconds / top) * 50)}%` }} />
        );
      })}
    </div>
  );
}

/** The summary's two clock numbers: each side's average think, and the move its time trouble began. */
export function ClockNumbers({ moves, thinkTimes, startClock, initialFen, names }: {
  moves: Move[]; thinkTimes: (number | null)[]; startClock: number | null; initialFen: string;
  /** The players' names by colour (or "You"). */
  names: Record<Color, string>;
}) {
  const { t } = useTranslation('games');
  const say = useSeconds();
  if (thinkTimes.every(seconds => seconds == null)) return null;
  const first = startPly(initialFen);
  const { average, troubleAt } = clockSummary(moves, thinkTimes, startClock, first % 2 === 0);
  const moveOf = (ply: number) => Math.floor((first + ply - 1) / 2) + 1;
  return (
    <section className="summary-block clock-numbers" aria-labelledby="clock-numbers-title">
      <h3 id="clock-numbers-title">{t('clock.title')}</h3>
      <ul>
        {(['white', 'black'] as const).map(side => (
          <li key={side}>
            <b>{names[side]}</b>{' '}
            {average[side] != null && t('clock.average', { time: say(average[side]!) })}
            {' · '}
            {troubleAt[side] != null ? t('clock.troubleFrom', { move: moveOf(troubleAt[side]!) }) : t('clock.noTrouble')}
          </li>
        ))}
      </ul>
    </section>
  );
}
