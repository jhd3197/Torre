// The deeper numbers from /api/stats (game_stats.py): Lichess accuracy by phase, where in the
// game the errors cluster, results by opponent strength, think time vs errors, and tilt.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { PUZZLE_WEAK, puzzlePath } from '../lib/routes';
import { BlindSpots } from './BlindSpots';
import type { GameStatsData, StatsRow, StatsWdl } from '../types';

const PHASES = ['opening', 'middlegame', 'endgame'] as const;
// Where each phase is trained: the repertoire, tactics from your weakest themes, endgame practice.
const PHASE_TRAINING = { opening: '/openings', middlegame: puzzlePath(PUZZLE_WEAK), endgame: '/endgames' } as const;
const STRENGTHS = ['much_lower', 'lower', 'similar', 'higher', 'much_higher'] as const;
const fmt = (value: number | null | undefined, suffix = '') => value == null ? '–' : `${value}${suffix}`;

function Bar({ label, note, value, max, unit, train }: { label: string; note: string; value: number | null; max: number; unit: string; train?: React.ReactNode }) {
  return (
    <div className="phase-row">
      <div><strong>{label}</strong><span>{note}{train && <> {train}</>}</span></div>
      <b>{fmt(value)}<small>{unit}</small></b>
      <div className="phase-track"><i style={{ width: `${Math.max(1, (value ?? 0) / Math.max(max, 1) * 100)}%` }} /></div>
    </div>
  );
}

function Rows({ headings, rows }: { headings: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="insight-table-wrap"><table>
      <thead><tr>{headings.map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

export function GameStats() {
  const { t } = useTranslation('stats');
  const [stats, setStats] = useState<GameStatsData | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<GameStatsData>('api/stats', undefined, controller.signal).then(setStats).catch(() => { /* the rest of Insights still shows */ });
    return () => controller.abort();
  }, []);
  if (!stats || !stats.counts.analyzed) return null;

  const counts = (row: StatsRow) => t('counts', { blunders: row.blunder, mistakes: row.mistake, moves: row.moves });
  const heat = stats.heatmap.by_move.filter(row => row.moves > 0);
  const maxRate = Math.max(...heat.map(row => row.error_rate ?? 0), 1);
  const wdl = (row: StatsWdl | undefined) => row?.games ? [fmt(row.games), `${row.wins} / ${row.draws} / ${row.losses}`, fmt(row.score_pct, '%')] : ['0', '–', '–'];
  const thinking = stats.time.by_think_time.filter(row => row.moves > 0);
  const tip = stats.tilt.recommendation.break_after_losses;

  return (
    <div className="game-stats" aria-label={t('label')}>
      {stats.motifs && <BlindSpots motifs={stats.motifs} />}
      <div className="insight-columns">
        <div className="insight-section"><h2>{t('phases.title')}</h2>
          {PHASES.map(phase => {
            const row = stats.accuracy[phase];
            return row?.moves ? <Bar key={phase} label={t(`phases.${phase}`)} note={counts(row)} value={row.accuracy ?? null} max={100} unit="%"
              train={<Link className="text-button" to={PHASE_TRAINING[phase]}>{t('phases.train')}</Link>} /> : null;
          })}
          <p className="insights-empty">{t('phases.note', { accuracy: fmt(stats.accuracy.overall?.accuracy, '%') })}</p>
        </div>
        <div className="insight-section"><h2>{t('heatmap.title')}</h2>
          {heat.map(row => <Bar key={row.bucket} label={t('heatmap.moves', { bucket: row.bucket })} note={counts(row)} value={row.error_rate} max={maxRate} unit="%" />)}
          {stats.heatmap.peak && <p className="insights-empty">{t('heatmap.peak', { bucket: stats.heatmap.peak })}</p>}
        </div>
      </div>
      <div className="insight-columns">
        <div className="insight-section"><h2>{t('strength.title')}</h2>
          <Rows headings={[t('strength.opponent'), t('table.games'), t('table.wdl'), t('table.score')]}
            rows={STRENGTHS.map(key => [t(`strength.${key}`), ...wdl(stats.performance.by_rating[key])])} />
        </div>
        <div className="insight-section"><h2>{t('time.title')}</h2>
          {thinking.length
            ? <Rows headings={[t('time.think'), t('table.moves'), t('time.errors'), t('time.blunders')]}
                rows={thinking.map(row => [row.bucket, fmt(row.moves), fmt(row.error_rate, '%'), fmt(row.blunder_rate, '%')])} />
            : <p className="insights-empty">{t('time.empty')}</p>}
        </div>
      </div>
      <div className="insight-section"><h2>{t('coach.title')}</h2>
        {tip != null && <p><strong>{t('coach.tilt', { count: tip })}</strong></p>}
        <ul>{stats.summary.weaknesses.map(line => <li key={line}>{line}</li>)}</ul>
      </div>
    </div>
  );
}
