// Tactical blind spots from /api/stats (motifs.py): the tactics your mistakes missed and the ones
// they let your opponent play, each linked to the puzzle theme that trains it and to a game where it happened.
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { gamePath, puzzlePath } from '../lib/routes';
import type { MotifRow, MotifStats } from '../types';

const SHOWN = 4;

function MotifList({ kind, rows }: { kind: 'missed' | 'allowed'; rows: MotifRow[] }) {
  const { t } = useTranslation('stats');
  if (!rows.length) return <p className="insights-empty">{t(`motifs.${kind}None`)}</p>;
  const max = Math.max(...rows.map(r => r.count), 1);
  return (
    <ul className="motif-list">
      {rows.slice(0, SHOWN).map(row => {
        const example = row.examples[0];
        return (
          <li key={row.tag}>
            <div className="motif-head">
              <strong>{t(`motifs.tags.${row.tag}`, { defaultValue: row.tag })}</strong>
              <span>{t('motifs.times', { count: row.count })}</span>
            </div>
            <div className="phase-track"><i style={{ width: `${Math.max(2, row.count / max * 100)}%` }} /></div>
            {row.trend?.direction && (
              <p className={`motif-trend ${row.trend.direction}`}>
                {t(`motifs.trend.${row.trend.direction}`, { recent: row.trend.recent, earlier: row.trend.earlier })}
              </p>
            )}
            <div className="motif-actions">
              {row.slug && <Link className="text-button" to={puzzlePath(row.slug)}>{t('motifs.practice')}</Link>}
              {example && <Link className="text-button" to={gamePath(example.game_id, Math.max(0, example.ply - 1))}>
                {t('motifs.example', { opponent: example.opponent || t('motifs.unknown') })}</Link>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function BlindSpots({ motifs }: { motifs: MotifStats }) {
  const { t } = useTranslation('stats');
  if (!motifs.errors) return null;
  return (
    <div className="insight-section blind-spots">
      <h2>{t('motifs.title')}</h2>
      <p className="insights-empty">{t('motifs.intro', { count: motifs.errors })}</p>
      <div className="insight-columns">
        <div><h3>{t('motifs.allowed')}</h3><MotifList kind="allowed" rows={motifs.allowed} /></div>
        <div><h3>{t('motifs.missed')}</h3><MotifList kind="missed" rows={motifs.missed} /></div>
      </div>
    </div>
  );
}
