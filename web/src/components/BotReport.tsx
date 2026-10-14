// The after-game card on how the game was really played (bot_report.py): accuracy by phase for you
// and the bot, the rating it was set to, and how its deliberate slips turned out. A bot
// never changes strength mid-game; this shows it, so a lucky move is not mistaken for a stronger bot.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { lessonPath } from '../lib/routes';
import { PHASES, type Phase, type PlaySave } from '../lib/storage';

interface SideRow { moves: number; accuracy: number; inaccuracy: number; mistake: number; blunder: number }
export interface BotReportData {
  phases: Record<Phase, { you: SideRow | null; bot: SideRow | null }>;
  overall: { you: SideRow | null; bot: SideRow | null };
  slips: { ply: number; san: string; phase: Phase; class: string | null }[];
  luckySlips: number;
  ratings: Partial<Record<Phase, number[]>>;
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

/** Accuracy by phase, yours beside the other side's, for the phases the game reached; with the
 *  bot's set rating per phase when given (index by PHASES). */
export function PhaseTable({ phases, other, ratings }: { phases: BotReportData['phases']; other: string; ratings?: (string | null)[] }) {
  const { t } = useTranslation('play');
  const pct = (row: SideRow | null) => row ? `${Math.round(row.accuracy)}%` : '–';
  const played = PHASES.filter(phase => phases[phase].you || phases[phase].bot);
  return (
    <table className="phase-table">
      <thead><tr><th>{t('report.phase')}</th><th>{t('report.you')}</th><th>{other}</th>{ratings && <th>{t('report.setTo')}</th>}</tr></thead>
      <tbody>
        {played.map(phase => (
          <tr key={phase}>
            <th scope="row">{t(`report.phases.${phase}`)}</th>
            <td>{pct(phases[phase].you)}</td>
            <td>{pct(phases[phase].bot)}</td>
            {ratings && <td>{ratings[PHASES.indexOf(phase)] ?? '–'}</td>}
          </tr>
        ))}
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
