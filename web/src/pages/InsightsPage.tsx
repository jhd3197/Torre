// /insights/:section — overview, openings, learn and blunders from your archive.
import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GRADES, gradeIcon } from '../lib/grades';
import type { TFunction } from 'i18next';
import { AnalysisBanner } from '../components/AnalysisBanner';
import { GameStats } from '../components/GameStats';
import { Mascot } from '../components/Reward';
import { MiniBoard } from '../components/MiniBoard';
import { explorePath, gamePath, insightSections, lessonPath, mistakesPath, type InsightSection } from '../lib/routes';
import { useInsights } from '../state/AppData';
import type { InsightsData } from '../types';
import { INSIGHT_ART, openingArt, openingKey } from '../lib/art';
import { OpeningStory } from '../components/OpeningStory';
import { CoachStats } from '../components/CoachStats';
import { storyFor } from '../data/openings';

const fmt = (value: unknown) => value == null ? '–' : String(value);
const resultWord = (r: number, t: TFunction<'insights'>) => t(`result.${r === 1 ? 'win' : r === 0 ? 'loss' : 'draw'}`);
const SectionArt = ({ src }: { src: string }) => <img className="section-art" src={src} alt="" width="34" height="34" />;
const Empty = ({ text }: { text: string }) => <p className="insights-empty">{text}</p>;
function GameLink({ id, label, ply }: { id: string | number; label?: string; ply?: number }) {
  const { t } = useTranslation('insights');
  return <Link className="text-button" to={gamePath(id, ply)}>{label ?? t('replay')}</Link>;
}
function PositionLink({ fen, section }: { fen: string; section: InsightSection }) {
  const { t } = useTranslation('insights');
  return <Link className="text-button" to={explorePath({ fen, from: `/insights/${section}` })}>{t('explorePosition')}</Link>;
}

function Table({ headings, rows }: { headings: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="insight-table-wrap"><table>
      <thead><tr>{headings.map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

export function InsightsPage({ basePath = '/insights' }: { basePath?: string }) {
  const { t } = useTranslation('insights');
  const { section = 'overview' } = useParams();
  const { insights, insightsError, retry } = useInsights();
  useEffect(() => { document.body.dataset.page = basePath.startsWith('/coach') ? 'coach' : 'insights'; }, [basePath]);
  if (!insightSections.includes(section as InsightSection)) return <Navigate to={basePath} replace />;
  const current = section as InsightSection;
  // The Coach page's Stats tab lays the overview out its own way (CoachStats).
  const inCoach = basePath.startsWith('/coach');

  let body;
  if (insightsError) body = <p id="insights-status" role="status">{insightsError} <button type="button" className="text-button" onClick={retry}>{t('status.retry')}</button></p>;
  else if (insights === undefined) body = <div id="insights-status" className="insights-waiting" role="status"><Mascot pose="calculating" size={120} /><p>{t('status.loading')}</p></div>;
  else if (insights === null) body = <p id="insights-status" role="status">{t('status.empty')}</p>;
  else body = <div id="insights-content">{{ overview: inCoach ? <CoachStats data={insights} /> : <Overview data={insights} />, openings: <Openings data={insights} />, learn: <Learn data={insights} />, blunders: <Blunders data={insights} /> }[current]}</div>;

  return (
    <section id="insights" className="insights" aria-label={t('label')}>
      <div className="insights-toolbar">
        <nav aria-label={t('sectionsLabel')}>
          {insightSections.map(key => (
            <NavLink key={key} to={key === 'overview' ? basePath : `${basePath}/${key}`} end
              className={({ isActive }) => isActive ? 'active' : ''}>{t(`sections.${key}`)}</NavLink>
          ))}
        </nav>
        {!inCoach && <span id="insights-coverage">{insights ? t('coverage', { analyzed: insights.coverage.analyzed, total: insights.coverage.total }) : ''}</span>}
      </div>
      <div data-analysis-runner=""><AnalysisBanner /></div>
      {body}
    </section>
  );
}

function Overview({ data }: { data: InsightsData }) {
  const { t } = useTranslation('insights');
  const rate = data.games ? Math.round(100 * data.wins / data.games) : 0;
  const metrics: [string, unknown, string][] = [
    [t('metrics.games'), data.games, t('metrics.gamesNote', { wins: data.wins, draws: data.draws, losses: data.losses })],
    [t('metrics.winRate'), `${rate}%`, t('metrics.winRateNote')],
    [t('metrics.accuracy'), data.avgAcc == null ? '–' : `${data.avgAcc}%`, t('metrics.accuracyNote')],
    [t('metrics.avgLoss'), data.avgCpl, t('metrics.avgLossNote')],
    [t('metrics.blunders'), data.blPerGame, t('metrics.blundersNote', { count: data.totalBlunders })],
    [t('metrics.mistakes'), data.mistakes, t('metrics.mistakesNote', { count: data.inaccuracies })],
  ];
  const maxPhase = Math.max(...data.phases.map(p => p.acpl), 1);
  return (
    <>
      <div className="insight-metrics">{metrics.map(([label, value, note]) => <div key={label}><span>{label}</span><strong>{fmt(value)}</strong><small>{note}</small></div>)}</div>
      {data.grades && <MoveQuality grades={data.grades} coverage={data.gradeCoverage} />}
      <div className="insight-section">
        <div className="insight-section-heading"><h2><SectionArt src={INSIGHT_ART.form} />{t('form.title')}</h2><span className="chart-legend"><i />{t('form.accuracy')} <i className="gold" />{t('form.cpl')}</span></div>
        {data.series.length ? <FormChart data={data} /> : <Empty text={t('form.empty')} />}
      </div>
      <div className="insight-columns">
        <div className="insight-section"><h2><SectionArt src={INSIGHT_ART.phases} />{t('phases.title')}</h2>
          {data.phases.some(p => p.moves) ? data.phases.map(p => (
            <div className="phase-row" key={p.phase}>
              <div><strong>{INSIGHT_ART[p.phase.toLowerCase() as 'opening'] && <img className="row-art" src={INSIGHT_ART[p.phase.toLowerCase() as 'opening']} alt="" width="28" height="28" />}{p.phase}</strong><span>{t('phases.counts', { blunders: p.blunders, mistakes: p.mistakes, moves: p.moves })}</span></div>
              <b>{fmt(p.acpl)}<small>ACPL</small></b>
              <div className="phase-track"><i style={{ width: `${Math.max(1, p.acpl / maxPhase * 100)}%` }} /></div>
            </div>
          )) : <Empty text={t('phases.empty')} />}
        </div>
        <div className="insight-section"><h2><SectionArt src={INSIGHT_ART.colors} />{t('colors.title')}</h2>
          <Table headings={[t('colors.color'), t('table.games'), t('table.winRate'), t('table.acpl'), t('colors.blundersPerGame')]}
            rows={data.colors.map(c => [<span className="cell-art"><img src={INSIGHT_ART[c.color === 'white' ? 'white' : 'black']} alt="" width="26" height="26" />{t(`colors.${c.color === 'white' ? 'white' : 'black'}`)}</span>, fmt(c.games), `${fmt(c.winrate)}%`, fmt(c.acpl), fmt(c.bl_per_game)])} />
        </div>
      </div>
      <div className="insight-section"><h2><SectionArt src={INSIGHT_ART.opponents} />{t('opponents.title')}</h2>
        <Table headings={[t('opponents.opponent'), t('table.games'), t('opponents.wdl'), t('table.acpl')]} rows={data.opponents.map(o => [o.opp, fmt(o.games), `${o.w} / ${o.d} / ${o.l}`, fmt(o.acpl)])} />
      </div>
      <GameStats />
    </>
  );
}

const QUALITY = GRADES;

/** Every analyzed move of yours by grade: a count and share each, and one bar of the whole mix. */
function MoveQuality({ grades, coverage }: { grades: NonNullable<InsightsData['grades']>; coverage?: InsightsData['gradeCoverage'] }) {
  const { t } = useTranslation('insights');
  const total = QUALITY.reduce((sum, key) => sum + (grades[key] ?? 0), 0);
  if (!total) return null;
  const share = (key: typeof QUALITY[number]) => (grades[key] ?? 0) / total * 100;
  return (
    <div className="insight-section move-quality" aria-label={t('quality.title')}>
      <div className="insight-section-heading"><h2>{t('quality.title')}</h2><span>{t('quality.note', { moves: total.toLocaleString() })}</span></div>
      {coverage && coverage.current < coverage.total && <p className="muted">{t('quality.updating', { current: coverage.current.toLocaleString(), total: coverage.total.toLocaleString() })}</p>}
      <div className="quality-bar" aria-hidden="true">
        {QUALITY.map(key => grades[key] ? <i key={key} className={`q-${key}`} style={{ width: `${share(key)}%` }} /> : null)}
      </div>
      <div className="quality-grid">
        {QUALITY.map(key => (
          <div key={key} className={`quality-tile q-${key}`} title={t(`board:grades.${key}.message`)}>
            <img src={gradeIcon(key)} alt="" width="24" height="24" />
            <span>{t(`quality.${key}`)}</span>
            <strong>{(grades[key] ?? 0).toLocaleString()}</strong>
            <small>{share(key) < 0.1 && grades[key] ? '<0.1' : share(key).toFixed(1)}%</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FormChart({ data }: { data: InsightsData }) {
  const { t } = useTranslation('insights');
  const series = data.series;
  const [selected, setSelected] = useState<string | number | null>(null);
  const [active, setActive] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const found = series.findIndex(game => game.id === selected);
  const index = found < 0 ? series.length - 1 : found;
  const W = 960, H = 245, pad = 40, maxCpl = Math.max(100, ...series.map(g => g.acpl || 0));
  const x = (i: number) => pad + i * (W - pad * 2) / Math.max(1, series.length - 1);
  const path = (field: 'acpl' | 'acc', max: number) => {
    let previous = false;
    return series.map((g, i) => {
      const value = g[field];
      if (value == null) { previous = false; return ''; }
      const point = `${previous ? 'L' : 'M'}${x(i).toFixed(1)},${(H - pad - value / max * (H - pad * 2)).toFixed(1)}`;
      previous = true;
      return point;
    }).join(' ');
  };
  const paths = { acpl: path('acpl', maxCpl), acc: path('acc', 100) };
  const g = series[index];
  const selectAt = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const position = ((event.clientX - rect.left) / rect.width * W - pad) / (W - 2 * pad);
    const next = Math.max(0, Math.min(series.length - 1, Math.round(position * (series.length - 1))));
    setSelected(series[next].id);
    setActive(true);
    setKeyboard(false);
  };
  const navigate = (event: React.KeyboardEvent) => {
    const next = ({ ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: series.length - 1 })[event.key];
    if (next == null) return;
    event.preventDefault();
    setSelected(series[Math.max(0, Math.min(series.length - 1, next))].id);
    setActive(true);
    setKeyboard(true);
  };
  return (
    <div className="insight-chart">
      <div className="chart-interaction" role="group" tabIndex={0} aria-label={t('form.explore')}
        aria-describedby="insight-chart-help insight-chart-detail" onKeyDown={navigate}
        onFocus={() => { setActive(true); setKeyboard(true); }} onBlur={() => setActive(false)}>
      <p id="insight-chart-help" className="chart-help">{t('form.help')}</p>
      {active && <div className="chart-tooltip" aria-hidden="true" style={{ left: `clamp(0px, calc(${x(index) / W * 100}% - 130px), max(0px, calc(100% - 260px)))` }}>
        <strong>{g.date}</strong><span><i />{t('form.accuracy')}: {g.acc == null ? '–' : `${g.acc}%`}</span>
        <span><i className="gold" />{t('form.cpl')}: {fmt(g.acpl)}</span>
      </div>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('form.chartLabel', { count: series.length })}
        onPointerMove={selectAt} onPointerDown={event => {
          if (event.pointerType !== 'mouse') event.currentTarget.setPointerCapture(event.pointerId);
          selectAt(event);
        }} onPointerLeave={() => { if (!keyboard) setActive(false); }}>

        {[0, 1, 2, 3, 4].map(i => {
          const y = pad + i * (H - pad * 2) / 4;
          return <g key={i}><line x1={pad} x2={W - pad} y1={y} y2={y} /><text x={0} y={y + 4}>{100 - i * 25}%</text><text x={W - 30} y={y + 4}>{Math.round(maxCpl * (1 - i / 4))}</text></g>;
        })}
        <path className="chart-cpl" d={paths.acpl} />
        <path className="chart-accuracy" d={paths.acc} />
        <line id="insight-chart-cursor" className="chart-cursor" x1={x(index)} x2={x(index)} y1={pad} y2={H - pad} />
        {g.acc != null && <circle className="chart-point chart-accuracy" cx={x(index)} cy={H - pad - g.acc / 100 * (H - 2 * pad)} r="4" />}
        {g.acpl != null && <circle className="chart-point chart-cpl" cx={x(index)} cy={H - pad - g.acpl / maxCpl * (H - 2 * pad)} r="4" />}
        <text x={pad} y={H - 5}>{series[0].date}</text><text x={W - pad} y={H - 5} textAnchor="end">{series.at(-1)!.date}</text>
      </svg>
      </div>
      <div id="insight-chart-detail" aria-live={keyboard ? 'polite' : 'off'} aria-atomic="true">
        <span><strong>{g.opp}</strong> · {g.date}<small>{t('form.detail', { result: resultWord(g.result, t), acpl: fmt(g.acpl), accuracy: g.acc == null ? '–' : `${g.acc}%`, blunders: g.blunders })}</small></span>
        <GameLink id={g.id} />
      </div>
    </div>
  );
}

function Openings({ data }: { data: InsightsData }) {
  const { t } = useTranslation('insights');
  return (
    <>
      <div className="opening-list">
        {data.openings.length ? data.openings.map(o => (
          <details className="insight-opening" key={`${o.eco}-${o.color}-${o.name}`}>
            <summary>
              <img className="opening-art" src={openingArt(o.name, o.eco)} alt="" width="52" height="52" loading="lazy" />
              <span className="eco-tag">{o.eco}</span>
              <span className="opening-name">{o.name}<small>{t('openings.colorGames', { color: o.color, count: o.games })}</small></span>
              <span className="opening-rate">{o.winrate}%<small>{t('openings.winRate')}</small></span>
              <span className="opening-wdl" aria-label={t('openings.wdl', { w: o.w, d: o.d, l: o.l })}>
                <i style={{ width: `${o.w / o.games * 100}%` }} /><i style={{ width: `${o.d / o.games * 100}%` }} /><i style={{ width: `${o.l / o.games * 100}%` }} />
              </span>
              <span className="opening-chevron">⌄</span>
            </summary>
            <div className="insight-opening-body">
              <div><MiniBoard fen={o.fen} /><PositionLink fen={o.fen} section="openings" /></div>
              <div>
                <p className="opening-notation">{o.line}</p>
                <p className="insight-muted">{t('openings.analyzed', { acpl: fmt(o.acpl), count: o.analyzed })}</p>
                {o.recent.map(r => <div className="insight-recent" key={r.id}><span>{r.opp}<small>{r.date} · {resultWord(r.result, t)}</small></span><GameLink id={r.id} /></div>)}
              </div>
            </div>
            {storyFor(openingKey(o.name, o.eco)) && <OpeningStory story={storyFor(openingKey(o.name, o.eco))!} titled={false} />}
          </details>
        )) : <Empty text={t('openings.empty')} />}
      </div>
      <div className="insight-section"><h2><SectionArt src={INSIGHT_ART.recurring} />{t('recurring.title')}</h2>
        <div className="insight-position-grid">
          {data.recurring.length ? data.recurring.map(p => (
            <article className="insight-position" key={p.fen}><MiniBoard fen={p.fen} /><div><h3><img className="opening-art small" src={openingArt(p.name, p.eco)} alt="" width="34" height="34" loading="lazy" />{p.name}</h3><p>{t('recurring.count', { count: p.count, eco: p.eco })}</p><PositionLink fen={p.fen} section="openings" /></div></article>
          )) : <Empty text={t('recurring.empty')} />}
        </div>
      </div>
    </>
  );
}

function safeLinks(links: { label: string; url: string }[] = []) {
  return links.flatMap(link => {
    try { const url = new URL(link.url); return url.protocol === 'https:' ? [{ label: link.label, href: url.href }] : []; } catch { return []; }
  });
}

function Learn({ data }: { data: InsightsData }) {
  const { t } = useTranslation('insights');
  if (!data.concepts.length) return <Empty text={t('learn.empty')} />;
  return (
    <div className="insight-lessons">
      {data.concepts.map(c => (
        <article className="insight-lesson" key={c.title}>
          <span className="lesson-tag">{c.tag}</span><h2>{c.title}</h2>
          <p className="lesson-evidence">{c.evidence}</p><p>{c.text}</p>
          {c.fen && <div className="lesson-position"><MiniBoard fen={c.fen} /><PositionLink fen={c.fen} section="learn" /></div>}
          {c.lesson && <Link className="button primary lesson-start" to={lessonPath(c.lesson)}>{t('learn.takeLesson')}</Link>}
          <div className="lesson-links">{safeLinks(c.links).map(l => <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>)}</div>
        </article>
      ))}
    </div>
  );
}

function Blunders({ data }: { data: InsightsData }) {
  const { t } = useTranslation('insights');
  if (!data.worstBlunders.length) return <Empty text={t('blunders.empty')} />;
  return (
    <div className="insight-blunders">
      <p className="insight-intro"><SectionArt src={INSIGHT_ART.mistakes} />{t('blunders.intro')}</p>
      {data.worstBlunders.map(b => (
        <article className="insight-blunder" key={`${b.id}-${b.ply}`}>
          <MiniBoard fen={b.fen} grid={b.board} />
          <div>
            <h2>{b.move_number}. {b.san} <span>−{fmt(b.cpl)} cp</span></h2>
            <p>{b.opp} · {b.date}</p><small>{t('blunders.before')}</small>
            <div className="blunder-actions"><GameLink id={b.id} label={t('blunders.replayMove')} ply={Math.max(0, b.ply - 1)} /><PositionLink fen={b.fen} section="blunders" />
              <Link className="text-button" to={mistakesPath(b.id)}>{t('trainer:entry.fromGame')}</Link></div>
          </div>
        </article>
      ))}
    </div>
  );
}
