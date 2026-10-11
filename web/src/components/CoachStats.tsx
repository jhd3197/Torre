// The Coach page's Stats overview (/coach/progress), on the Torre Stats design: Rooky's read of the
// numbers, the headline figures, your moves by grade, form over time, blind spots, accuracy by
// phase, where errors happen, results by opponent strength, think time, colour and opponent.
// Everything is /api/insights (insights.py) and /api/stats (game_stats.py); /insights keeps the
// older layout of the same data.
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { BlindSpots } from './BlindSpots';
import { OpponentFace } from './CoachHome';
import { CursorRook } from './CursorRook';
import { Segments } from './Segments';
import { api } from '../lib/api';
import { GRADES, gradeIcon } from '../lib/grades';
import { PUZZLE_WEAK, puzzlePath } from '../lib/routes';
import { FormChart } from '../pages/InsightsPage';
import type { GameStatsData, InsightsData, SeriesPoint, StatsWdl } from '../types';

const PHASES = ['opening', 'middlegame', 'endgame'] as const;
const PHASE_TRAINING = { opening: '/openings', middlegame: puzzlePath(PUZZLE_WEAK), endgame: '/endgames' } as const;
const STRENGTHS = ['much_lower', 'lower', 'similar', 'higher', 'much_higher'] as const;
const RANGES = ['month', 'half', 'all'] as const;
type Range = typeof RANGES[number];
const RANGE_DAYS: Record<Range, number | null> = { month: 30, half: 183, all: null };
const OPPONENTS_SHOWN = 8;

const fmt = (value: number | null | undefined, suffix = '') => (value == null ? '–' : `${value}${suffix}`);
const pct = (part: number, whole: number) => (whole ? `${part / whole * 100}%` : '0%');
/** A PGN date (2026.10.09) as a time, or null when it is unknown (????.??.??). */
const dayOf = (date: string) => {
  const [y, m, d] = date.split(/[.-]/).map(Number);
  return y && m && d ? Date.UTC(y, m - 1, d) : null;
};
const tone = (value: number | null | undefined, good: number, fair: number) =>
  value == null ? 'is-low' : value >= good ? 'is-good' : value >= fair ? 'is-fair' : 'is-low';

export function useGameStats() {
  const [stats, setStats] = useState<GameStatsData | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<GameStatsData>('api/stats', undefined, controller.signal).then(setStats).catch(() => { /* the rest still shows */ });
    return () => controller.abort();
  }, []);
  return stats;
}

/** The analyzed games of the last `days` (by the newest game's date, so an old archive still shows). */
function inRange(series: SeriesPoint[], range: Range) {
  const days = RANGE_DAYS[range];
  if (days == null) return series;
  const times = series.map(g => dayOf(g.date));
  const newest = Math.max(...times.map(time => time ?? 0));
  return series.filter((_, i) => times[i] != null && newest - times[i]! <= days * 86_400_000);
}

export function CoachStats({ data }: { data: InsightsData }) {
  const { t } = useTranslation('coach');
  const ti = useTranslation('insights').t;
  const stats = useGameStats();
  const [range, setRange] = useState<Range>('all');
  const series = inRange(data.series, range);

  // The headline figures: all of your games, or the analyzed ones in the chosen range.
  const average = (values: (number | null)[]) => {
    const known = values.filter((v): v is number => v != null);
    return known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length * 10) / 10 : null;
  };
  const kpis: [string, string, string][] = range === 'all' ? [
    [ti('metrics.games'), fmt(data.games), ti('metrics.gamesNote', { wins: data.wins, draws: data.draws, losses: data.losses })],
    [ti('metrics.winRate'), data.games ? `${Math.round(100 * data.wins / data.games)}%` : '–', ti('metrics.winRateNote')],
    [ti('metrics.accuracy'), fmt(data.avgAcc, '%'), ti('metrics.accuracyNote')],
    [ti('metrics.avgLoss'), fmt(data.avgCpl), ti('metrics.avgLossNote')],
    [ti('metrics.blunders'), fmt(data.blPerGame), ti('metrics.blundersNote', { count: data.totalBlunders })],
    [ti('metrics.mistakes'), fmt(data.mistakes), ti('metrics.mistakesNote', { count: data.inaccuracies })],
  ] : (() => {
    const wins = series.filter(g => g.result === 1).length, draws = series.filter(g => g.result === 0.5).length;
    const blunders = series.reduce((sum, g) => sum + g.blunders, 0);
    return [
      [ti('metrics.games'), String(series.length), ti('metrics.gamesNote', { wins, draws, losses: series.length - wins - draws })],
      [ti('metrics.winRate'), series.length ? `${Math.round(100 * wins / series.length)}%` : '–', t('stats.inRange')],
      [ti('metrics.accuracy'), fmt(average(series.map(g => g.acc)), '%'), t('stats.inRange')],
      [ti('metrics.avgLoss'), fmt(average(series.map(g => g.acpl))), ti('metrics.avgLossNote')],
      [ti('metrics.blunders'), series.length ? (blunders / series.length).toFixed(2) : '–', ti('metrics.blundersNote', { count: blunders })],
    ];
  })();

  return (
    <div className="coach-stats">
      <div className="coach-stats-range">
        <span>{t('stats.rangeLabel')}</span>
        <Segments className="bots-segments coach-tabs" role="group" aria-label={t('stats.rangeLabel')}>
          {RANGES.map(key => <button key={key} type="button" aria-pressed={key === range} className={key === range ? 'selected' : ''}
            onClick={() => setRange(key)}>{t(`stats.range.${key}`)}</button>)}
        </Segments>
      </div>

      {stats && <RookyRead stats={stats} />}

      <div className="coach-kpis">{kpis.map(([label, value, note]) => (
        <div key={label} className="coach-kpi"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
      ))}</div>

      {data.grades && <Moves grades={data.grades} coverage={data.gradeCoverage} />}

      <section className="coach-stat-card" aria-labelledby="coach-form-title">
        <div className="coach-stat-head"><h2 id="coach-form-title">{ti('form.title')}</h2>
          <span className="chart-legend"><i />{ti('form.accuracy')} <i className="gold" />{ti('form.cpl')}</span></div>
        {series.length ? <FormChart key={range} data={{ ...data, series }} /> : <p className="coach-stat-empty">{range === 'all' ? ti('form.empty') : t('stats.rangeEmpty')}</p>}
      </section>

      {stats?.counts.analyzed ? <StatsSections stats={stats} colors={<Colors data={data} />} />
        : <div className="coach-stat-grid"><Colors data={data} /></div>}

      <Opponents data={data} />
    </div>
  );
}

/** A few lines Rooky reads off the numbers: the weakest phase, where errors peak, and tilt. */
function RookyRead({ stats }: { stats: GameStatsData }) {
  const { t } = useTranslation('coach');
  const ts = useTranslation('stats').t;
  const notes: { head: string; text?: string }[] = [];
  const phases = PHASES.map(phase => ({ phase, row: stats.accuracy[phase] })).filter(p => p.row?.moves && p.row.accuracy != null);
  if (phases.length > 1) {
    const sorted = [...phases].sort((a, b) => a.row!.accuracy! - b.row!.accuracy!);
    const worst = sorted[0], best = sorted.at(-1)!;
    notes.push({ head: t('stats.read.phase', { phase: ts(`phases.${worst.phase}`) }),
      text: t('stats.read.phaseText', { accuracy: worst.row!.accuracy, best: ts(`phases.${best.phase}`), bestAccuracy: best.row!.accuracy }) });
  }
  const peak = stats.heatmap.by_move.find(row => row.bucket === stats.heatmap.peak);
  if (peak?.error_rate != null) notes.push({ head: ts('heatmap.peak', { bucket: stats.heatmap.peak }), text: t('stats.read.peakText', { rate: peak.error_rate }) });
  const tilt = stats.tilt.recommendation.break_after_losses;
  if (tilt != null) notes.push({ head: ts('coach.tilt', { count: tilt }) });
  if (!notes.length) return null;
  return (
    <section className="coach-read" aria-labelledby="coach-read-title">
      <span className="coach-read-figure"><CursorRook size={92} /></span>
      <div>
        <h2 id="coach-read-title">{t('stats.read.title')}</h2>
        <ul>{notes.map(note => <li key={note.head}><strong>{note.head}</strong>{note.text && <span>{note.text}</span>}</li>)}</ul>
      </div>
    </section>
  );
}

function Moves({ grades, coverage }: { grades: NonNullable<InsightsData['grades']>; coverage?: InsightsData['gradeCoverage'] }) {
  const ti = useTranslation('insights').t;
  const total = GRADES.reduce((sum, key) => sum + (grades[key] ?? 0), 0);
  if (!total) return null;
  const share = (key: typeof GRADES[number]) => (grades[key] ?? 0) / total * 100;
  return (
    <section className="coach-moves" aria-labelledby="coach-moves-title">
      <div className="coach-stat-head"><h2 id="coach-moves-title">{ti('quality.title')}</h2><span>{ti('quality.note', { moves: total.toLocaleString() })}</span></div>
      {coverage && coverage.current < coverage.total && <p className="coach-stat-empty">
        {ti('quality.updating', { current: coverage.current.toLocaleString(), total: coverage.total.toLocaleString() })}</p>}
      <div className="quality-bar" aria-hidden="true">
        {GRADES.map(key => grades[key] ? <i key={key} className={`q-${key}`} style={{ width: `${share(key)}%` }} /> : null)}
      </div>
      <ul className="coach-moves-legend">{GRADES.map(key => (
        <li key={key} title={ti(`board:grades.${key}.message`)}>
          <img src={gradeIcon(key)} alt="" width="20" height="20" />
          {ti(`quality.${key}`)}
          <b>{(grades[key] ?? 0).toLocaleString()}</b>
          <small>{share(key) < 0.1 && grades[key] ? '<0.1' : share(key).toFixed(1)}%</small>
        </li>
      ))}</ul>
    </section>
  );
}

function StatsSections({ stats, colors }: { stats: GameStatsData; colors: ReactNode }) {
  const { t } = useTranslation('coach');
  const ts = useTranslation('stats').t;
  const heat = stats.heatmap.by_move.filter(row => row.moves > 0);
  const maxRate = Math.max(...heat.map(row => row.error_rate ?? 0), 1);
  const thinking = stats.time.by_think_time.filter(row => row.moves > 0);
  const maxThink = Math.max(...thinking.map(row => row.error_rate ?? 0), 1);
  const score = (row: StatsWdl | undefined) => (row?.games ? row.score_pct : null);
  return <>
    {stats.motifs && <div className="coach-blind"><BlindSpots motifs={stats.motifs} /></div>}
    <div className="coach-stat-grid">
      <section className="coach-stat-card" aria-labelledby="coach-phases-title">
        <h2 id="coach-phases-title">{ts('phases.title')}</h2>
        {PHASES.map(phase => {
          const row = stats.accuracy[phase];
          if (!row?.moves) return null;
          return <div key={phase} className={`coach-phase ${tone(row.accuracy, 90, 84)}`}>
            <div><strong>{ts(`phases.${phase}`)}</strong><small>{ts('counts', { blunders: row.blunder, mistakes: row.mistake, moves: row.moves })}</small>
              <b>{fmt(row.accuracy, '%')}</b></div>
            <span className="coach-track"><i style={{ width: `${row.accuracy ?? 0}%` }} /></span>
            <Link className="coach-stat-act" to={PHASE_TRAINING[phase]}>{ts('phases.train')} →</Link>
          </div>;
        })}
        <small className="coach-stat-note">{ts('phases.note', { accuracy: fmt(stats.accuracy.overall?.accuracy, '%') })}</small>
      </section>
      <section className="coach-stat-card" aria-labelledby="coach-heat-title">
        <div className="coach-stat-head"><h2 id="coach-heat-title">{ts('heatmap.title')}</h2>
          {stats.heatmap.peak && <span className="coach-peak">{t('stats.peak', { bucket: stats.heatmap.peak })}</span>}</div>
        <ol className="coach-heat">{heat.map(row => (
          <li key={row.bucket} className={row.bucket === stats.heatmap.peak ? 'is-peak' : (row.error_rate ?? 0) > maxRate / 2 ? 'is-high' : ''}
            title={`${ts('heatmap.moves', { bucket: row.bucket })}: ${fmt(row.error_rate, '%')}`}>
            <span>{row.error_rate == null ? '' : Math.round(row.error_rate)}</span>
            <i style={{ height: `${Math.max(2, (row.error_rate ?? 0) / maxRate * 100)}%` }} />
            <small>{row.bucket?.split(/[-–]/)[0]}</small>
          </li>
        ))}</ol>
        <small className="coach-stat-note">{t('stats.heatNote')}</small>
      </section>
    </div>
    <div className="coach-stat-grid">
      <section className="coach-stat-card" aria-labelledby="coach-strength-title">
        <h2 id="coach-strength-title">{ts('strength.title')}</h2>
        {STRENGTHS.map(key => {
          const row = stats.performance.by_rating[key], value = score(row);
          return <div key={key} className={`coach-bar-row ${tone(value, 70, 45)}`}>
            <span>{ts(`strength.${key}`)}</span>
            <span className="coach-track"><i style={{ width: `${value ?? 0}%` }} /></span>
            <b>{fmt(value, '%')}</b>
          </div>;
        })}
        <small className="coach-stat-note">{t('stats.strengthNote')}</small>
      </section>
      <section className="coach-stat-card" aria-labelledby="coach-time-title">
        <h2 id="coach-time-title">{ts('time.title')}</h2>
        {thinking.length ? <>
          {thinking.map(row => (
            <div key={row.bucket} className="coach-bar-row is-time">
              <span>{row.bucket}</span>
              <span className="coach-track is-stacked">
                <i className="is-blunder" style={{ width: pct(row.blunder_rate ?? 0, maxThink) }} />
                <i className="is-error" style={{ width: pct(Math.max(0, (row.error_rate ?? 0) - (row.blunder_rate ?? 0)), maxThink) }} />
              </span>
              <b>{fmt(row.error_rate, '%')}</b>
            </div>
          ))}
          <small className="coach-stat-note"><i className="coach-key is-blunder" />{t('stats.timeBlunders')} <i className="coach-key is-error" />{t('stats.timeErrors')}</small>
        </> : <p className="coach-stat-empty">{ts('time.empty')}</p>}
      </section>
      {colors}
    </div>
  </>;
}

function Colors({ data }: { data: InsightsData }) {
  const { t } = useTranslation('coach');
  const ti = useTranslation('insights').t;
  return (
    <section className="coach-stat-card" aria-labelledby="coach-colors-title">
      <h2 id="coach-colors-title">{t('stats.colors')}</h2>
      {data.colors.map(c => (
        <div key={c.color} className="coach-color">
          <span className={`coach-color-king is-${c.color}`} aria-hidden="true">♚</span>
          <span><strong>{t('stats.colorGames', { color: ti(`colors.${c.color}`), count: c.games })}</strong>
            <small>{t('stats.colorNote', { acpl: fmt(c.acpl), blunders: fmt(c.bl_per_game) })}</small></span>
          <b>{fmt(c.winrate, '%')}</b>
        </div>
      ))}
    </section>
  );
}

function Opponents({ data }: { data: InsightsData }) {
  const { t } = useTranslation('coach');
  const ti = useTranslation('insights').t;
  const [all, setAll] = useState(false);
  if (!data.opponents.length) return null;
  const rows = all ? data.opponents : data.opponents.slice(0, OPPONENTS_SHOWN);
  return (
    <section className="coach-opponents" aria-labelledby="coach-opponents-title">
      <div className="coach-stat-head"><h2 id="coach-opponents-title">{ti('opponents.title')}</h2>
        {data.opponents.length > OPPONENTS_SHOWN && <button type="button" className="button" onClick={() => setAll(on => !on)}>
          {all ? t('stats.opponentsTop', { count: OPPONENTS_SHOWN }) : t('stats.opponentsAll', { count: data.opponents.length })}</button>}
      </div>
      <div className="coach-opponent-table" role="table" aria-labelledby="coach-opponents-title">
        <div className="coach-opponent-row is-head" role="row">
          <span role="columnheader">{ti('opponents.opponent')}</span><span role="columnheader">{ti('table.games')}</span>
          <span role="columnheader">{ti('opponents.wdl')}</span><span role="columnheader">{ti('table.acpl')}</span>
        </div>
        {rows.map(o => (
          <div key={o.opp} className="coach-opponent-row" role="row">
            <span role="cell" className="coach-opponent-name"><OpponentFace name={o.opp} size={32} /><span>{o.opp}</span></span>
            <span role="cell" className="is-num">{o.games}</span>
            <span role="cell" className="coach-wdl">
              <span className="coach-wdl-bar" aria-hidden="true">
                <i className="is-win" style={{ width: pct(o.w, o.games) }} /><i className="is-draw" style={{ width: pct(o.d, o.games) }} />
                <i className="is-loss" style={{ width: pct(o.l, o.games) }} />
              </span>
              <small>{o.w} · {o.d} · {o.l}</small>
            </span>
            <span role="cell" className="is-num">{fmt(o.acpl)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
