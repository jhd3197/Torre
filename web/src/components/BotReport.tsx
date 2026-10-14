// The after-game card on how the game was really played (bot_report.py): accuracy by phase for you
// and the bot, the rating it was set to, and how its deliberate slips turned out. A bot
// never changes strength mid-game; this shows it, so a lucky move is not mistaken for a stronger bot.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { gradeIcon, type Grade } from '../lib/grades';
import { lessonPath } from '../lib/routes';
import { PHASES, type Phase, type PlaySave } from '../lib/storage';

/** One side's phase: `grade` is null with too few moves to judge (bot_report.phase_grade), `rating`
 *  null under 8 moves (game_rating). */
interface SideRow {
  moves: number; accuracy: number; inaccuracy: number; mistake: number; blunder: number;
  grade?: Grade | null; rating?: number | null;
}
export interface BotReportData {
  phases: Record<Phase, { you: SideRow | null; bot: SideRow | null }>;
  overall: { you: SideRow | null; bot: SideRow | null };
  slips: { ply: number; san: string; phase: Phase; class: string | null }[];
  luckySlips: number;
  ratings: Partial<Record<Phase, number[]>>;
  /** The ply of each phase's first move, null for a phase the game never reached. */
  starts?: Record<Phase, number | null>;
  /** How strongly you and the bot played the whole game, in rating points; null when too short to say. */
  rating?: { you: number | null; bot: number | null };
  /** Your costliest mistake and the position before it, to play again from there. */
  retry: { ply: number; san: string; class: string; fen: string } | null;
}

export function BotReport({ game, botName, onRetry }: { game: PlaySave; botName: string; onRetry?: (fen: string) => void }) {
  const { t } = useTranslation('play');
  const [report, setReport] = useState<BotReportData | null>(null);
  const [failed, setFailed] = useState(false);
  const key = `${game.initialFen} ${game.moves.map(m => m.uci).join(' ')}`;

  useEffect(() => {
    let live = true;
    setReport(null);
    setFailed(false);
    api<BotReportData>('api/played/report', {
      initialFen: game.initialFen, moves: game.moves.map(m => m.uci), playerColor: game.playerColor, notes: game.botNotes ?? [],
    }).then(data => { if (live) setReport(data); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
    // The key is the game itself; the save object changes identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (failed || game.moves.length < 2) return null;
  if (!report) return <p className="bot-report-loading" role="status">{t('report.loading', { name: botName })}</p>;
  const ratings = PHASES.map(phase => report.ratings[phase]?.join(' / ') ?? null);
  const set = ratings.filter(Boolean);
  const steady = new Set(set).size <= 1;
  return (
    <section className="bot-report" aria-label={t('report.title', { name: botName })}>
      <h3>{t('report.title', { name: botName })}</h3>
      <PhaseTable phases={report.phases} other={botName} ratings={set.length ? ratings : undefined} />
      {report.rating?.you != null && report.rating.bot != null && (
        <p className="game-rating-line" title={t('report.ratingNote')}>{t('report.rating', { you: report.rating.you, name: botName, bot: report.rating.bot })}</p>
      )}
      {set.length > 0 && <p>{steady
        ? t('report.steady', { name: botName, elo: set[0] })
        : t('report.byPhase', { name: botName })}</p>}
      {report.slips.length > 0 && <p>{t('report.slips', { name: botName, count: report.slips.length })}{' '}
        {report.luckySlips > 0 ? t('report.lucky', { count: report.luckySlips }) : t('report.unlucky')}</p>}
      {report.retry && onRetry && (
        <button type="button" className="button" onClick={() => onRetry(report.retry!.fen)}>
          {t('report.retry', { san: report.retry.san, move: `${report.retry.fen.split(' ')[5]}${report.retry.fen.split(' ')[1] === 'b' ? '...' : '.'}` })}
        </button>
      )}
    </section>
  );
}

/** The phase report card: a grade per phase for you and the other side, for the phases the game
 *  reached, each with its accuracy and slips in a tooltip; with the bot's set rating per phase when
 *  given (index by PHASES). With `starts` and `onGo`, a phase's name jumps to its first move. */
export function PhaseTable({ phases, other, ratings, starts, onGo }: {
  phases: BotReportData['phases']; other: string; ratings?: (string | null)[];
  starts?: BotReportData['starts'] | null; onGo?: (ply: number) => void;
}) {
  const { t } = useTranslation('play');
  const played = PHASES.filter(phase => phases[phase].you || phases[phase].bot);
  const cell = (row: SideRow | null) => {
    if (!row) return <td>–</td>;
    const slips = (['inaccuracy', 'mistake', 'blunder'] as const).filter(kind => row[kind])
      .map(kind => t(`report.slipCount.${kind}`, { count: row[kind] }));
    const tip = [t('report.accuracyTip', { percent: Math.round(row.accuracy) }), ...slips].join(' · ');
    if (!row.grade) return <td title={`${tip} · ${t('report.tooFew')}`}>–</td>;
    return (
      <td title={tip} className={`phase-grade move-${row.grade}`}>
        <img src={gradeIcon(row.grade)} alt="" width="18" height="18" />
        <span>{t(`games:game.gradeTable.${row.grade}`)}</span>
        {row.rating != null && <small>~{row.rating}</small>}
      </td>
    );
  };
  return (
    <table className="phase-table">
      <thead><tr><th>{t('report.phase')}</th><th>{t('report.you')}</th><th>{other}</th>{ratings && <th>{t('report.setTo')}</th>}</tr></thead>
      <tbody>
        {played.map(phase => {
          const start = starts?.[phase];
          return (
            <tr key={phase}>
              <th scope="row">{start && onGo
                ? <button type="button" className="text-button" onClick={() => onGo(start)}>{t(`report.phases.${phase}`)}</button>
                : t(`report.phases.${phase}`)}</th>
              {cell(phases[phase].you)}
              {cell(phases[phase].bot)}
              {ratings && <td>{ratings[PHASES.indexOf(phase)] ?? '–'}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Why a game was drawn, for players who think the bot cheated them out of a win. */
export function DrawRule({ termination, onNavigate }: { termination: string; onNavigate?: () => void }) {
  const { t } = useTranslation('play');
  const key = termination.replace(/ (\w)/g, (_, c: string) => c.toUpperCase());
  const known = ['stalemate', 'insufficientMaterial', 'threefoldRepetition', 'fivefoldRepetition', 'fiftyMoves', 'seventyfiveMoves'];
  if (!known.includes(key)) return null;
  return (
    <p className="result-rule">{t(`drawRule.${key}`)}{' '}
      <Link className="text-button" to={lessonPath(key === 'stalemate' ? 'stalemate' : 'draws')} onClick={onNavigate}>{t('drawRule.lesson')}</Link>
    </p>
  );
}
