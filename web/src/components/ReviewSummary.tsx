// The top of a game review's Summary tab: how the game ended, both sides' accuracy, your moves by
// grade, and the moves worth another look, each jumping the board there.
import { useTranslation } from 'react-i18next';
import { GRADES, gradeIcon, type Grade } from '../lib/grades';
import type { Outcome } from '../lib/commentary';

/** How the game ended, in one line: who won, the score, and why it stopped. */
export function ResultBanner({ outcome, result, winner, ending }: {
  outcome: Outcome | null;
  /** The PGN result ("1-0"). */
  result: string;
  /** The winner's name when the game does not know your side. */
  winner: string | null;
  ending: string;
}) {
  const { t } = useTranslation('games');
  const score = result.replace('1/2', '½').replace('1/2', '½').replace('-', '–');
  const title = outcome ? t(`summary.${outcome}`) : winner ? t('summary.winner', { name: winner }) : result === '1/2-1/2' ? t('summary.drew') : t('summary.unfinished');
  return (
    <div className={`result-banner${outcome ? ` result-${outcome}` : ''}`} id="result-banner">
      <strong>{title}{result !== '*' && <span> · {score}</span>}</strong>
      {ending && <span>{ending}</span>}
    </div>
  );
}

export interface AccuracyCard { name: string; accuracy: number | null; you: boolean }

export function AccuracyCards({ cards }: { cards: AccuracyCard[] }) {
  const { t } = useTranslation('games');
  if (!cards.some(card => card.accuracy != null)) return null;
  return (
    <div className="accuracy-cards">
      {cards.map(card => (
        <div key={card.name} className={`accuracy-card${card.you ? ' yours' : ''}`}>
          <span>{card.name}</span>
          <b>{card.accuracy ?? '–'}{card.accuracy != null && <small>%</small>}</b>
          <span>{t('summary.accuracy')}</span>
        </div>
      ))}
    </div>
  );
}

/** Your moves by grade, as chips; only the grades that came up. */
export function GradeChips({ counts, title }: { counts: Record<Grade, number>; title: string }) {
  const { t } = useTranslation('games');
  const shown = GRADES.filter(grade => counts[grade] > 0);
  if (!shown.length) return null;
  return (
    <section className="summary-block" aria-labelledby="grade-chips-title">
      <h3 id="grade-chips-title">{title}</h3>
      <ul className="grade-chips">
        {shown.map(grade => (
          <li key={grade} className={`move-${grade}`}>
            <img src={gradeIcon(grade)} alt="" width="20" height="20" />
            {t('summary.chip', { count: counts[grade], grade: t(`game.gradeTable.${grade}`) })}
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface Moment { ply: number; target: number; title: string; grade: Grade; detail: string }

/** The moves worth another look: each opens the position before it, to look for a better one. */
export function WorthALook({ moments, cursor, onGo, note }: { moments: Moment[]; cursor: number; onGo: (ply: number) => void; note?: string }) {
  const { t } = useTranslation('games');
  if (!moments.length) return null;
  return (
    <section className="summary-block key-moments" aria-labelledby="key-moments-title">
      <h3 id="key-moments-title">{t('game.keyMoments')}</h3>
      <ol>
        {moments.map(moment => (
          <li key={moment.ply}>
            <button type="button" className={`key-moment move-${moment.grade}`} aria-current={cursor === moment.target ? 'step' : undefined}
              onClick={() => onGo(moment.target)}>
              <img src={gradeIcon(moment.grade)} alt="" width="28" height="28" />
              <span><strong>{moment.title}</strong><small>{moment.detail}</small></span>
              <i aria-hidden="true">›</i>
            </button>
          </li>
        ))}
      </ol>
      {note && <p className="key-moments-note">{note}</p>}
    </section>
  );
}
