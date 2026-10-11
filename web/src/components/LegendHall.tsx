// The bot lobby's Legends group: one panel per era under its diorama, each legend a roster card like any other bot.
// Legends whose games are still downloading (or failed to) wait dimmed in their era with a button to fetch them.
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Bot } from '../data/bots';
import { ERAS, byHistory, eraArt, legendEra, legendFigure } from '../data/legends';
import type { MastersFill, MastersList } from '../hooks/useMasters';
import { api } from '../lib/api';

interface HallProps {
  legends: Bot[];
  missing: { id: string; name: string }[];
  fill?: MastersFill;
  /** The lobby's roster card, so a legend looks like every other bot. */
  card: (bot: Bot) => ReactNode;
  onAdded: (data: MastersList) => void;
}

export function LegendHall({ legends, missing, fill, card, onAdded }: HallProps) {
  const { t } = useTranslation('play');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function fetchGames(id: string) {
    setBusy(id);
    setProblem(null);
    try { onAdded(await api<MastersList>('api/masters/download', { id })); } catch (error) { setProblem((error as Error).message); } finally { setBusy(null); }
  }

  const rows = ERAS.map(era => ({
    era,
    bots: legends.filter(bot => legendEra(bot.masterId ?? '') === era),
    waiting: missing.filter(m => legendEra(m.id) === era && legendFigure(m.id)).sort((a, b) => byHistory(a.id, b.id)),
  })).filter(row => row.bots.length || row.waiting.length);

  return (
    <div className="bot-week legend-hall">
      {fill?.running && <p className="hall-fill" role="status">{t('hall.fetching', { done: fill.done, total: fill.total })}</p>}
      {rows.map(({ era, bots, waiting }) => (
        <section key={era} className={`hall-era era-${era}`} aria-label={t(`hall.eras.${era}.name`)}>
          <div className="hall-era-heading">
            <img src={eraArt(era)} alt="" loading="lazy" />
            <h3>{t(`hall.eras.${era}.name`)}</h3>
          </div>
          <div className="bot-grid">
            {bots.map(card)}
            {waiting.map(m => (
              <div key={m.id} className="bot-card waiting">
                <span className="bot-picture"><img src={legendFigure(m.id)} alt="" loading="lazy" /></span>
                <span className="bot-card-name"><strong>{m.name}</strong></span>
                {fill?.running && fill.current !== m.id && !fill.failed.includes(m.id)
                  ? <small>{t('hall.queued')}</small>
                  : <button type="button" disabled={!!busy || fill?.current === m.id} onClick={() => void fetchGames(m.id)}>
                    {busy === m.id || fill?.current === m.id ? t('hall.downloading') : t('hall.getGames')}</button>}
              </div>
            ))}
          </div>
        </section>
      ))}
      {problem && <p className="hall-problem" role="alert">{problem}</p>}
    </div>
  );
}
