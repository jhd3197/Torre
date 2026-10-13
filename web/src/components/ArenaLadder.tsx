// The Arena ladder: maximum-likelihood ratings over every match played (ladder.py), with
// 95% confidence intervals, so "is the 1800 bot really stronger than Capablanca?" has an answer.
// AI models get a ladder of their own from the same fit: each model at one help level and
// effort is one player, with what its games cost.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { dollars } from '../lib/format';
import type { ArenaLadderData } from '../types';

type Rung = ArenaLadderData['players'][number];

/** `refresh` changes whenever a match finishes, so the ladder refits. */
export function ArenaLadder({ refresh }: { refresh?: string }) {
  const { t } = useTranslation('arena');
  const [ladder, setLadder] = useState<ArenaLadderData | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<ArenaLadderData>('api/arena/ladder', undefined, controller.signal).then(setLadder).catch(() => { /* the ladder is extra */ });
    return () => controller.abort();
  }, [refresh]);
  if (!ladder?.players.length) return null;
  const models = ladder.players.filter(p => p.ai);
  const chess = ladder.players.filter(p => !p.ai);
  // Models that only ever met each other are rated around 1500, not on the chess scale.
  const relative = models.length > 0 && models.every(p => p.placed_by === 'average');
  return (
    <>
      {models.length > 0 && (
        <Rungs id="arena-ai-ladder-title" title={t('ladder.aiTitle')} players={models}
          hint={relative ? t('ladder.aiRelative') : t('ladder.aiHint')} />
      )}
      {chess.length > 0 && (
        <Rungs id="arena-ladder-title" title={t('ladder.title')} players={chess}
          hint={`${t('ladder.hint', { count: ladder.games })}${ladder.groups > 1 ? ` ${t('ladder.groups', { count: ladder.groups })}` : ''}`} />
      )}
    </>
  );
}

function Rungs({ id, title, players, hint }: { id: string; title: string; players: Rung[]; hint: string }) {
  const { t } = useTranslation('arena');
  // Every range bar shares one scale, from the lowest bound to the highest, with a little room either side.
  const low = Math.min(...players.map(p => p.ci_low)) - 50;
  const high = Math.max(...players.map(p => p.ci_high)) + 50;
  const at = (rating: number) => `${((rating - low) / (high - low)) * 100}%`;
  return (
    <section className="arena-recent arena-ladder" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <ol className="arena-list">
        {players.map((p, i) => {
          const fixed = p.placed_by === 'anchor' || p.placed_by === 'nominal';
          const details = [
            ...(p.ai ? [p.ai.model.split('/')[0], t('ladder.aiLevel', { level: p.ai.level }),
              ...(p.ai.effort ? [t(`setup.aiEfforts.${p.ai.effort}`)] : []),
              ...(p.cost && p.cost_games ? [t('ladder.aiCost', { cost: dollars(p.cost / p.cost_games) })] : [])] : []),
            ...(p.ci_low !== p.ci_high ? [t('ladder.rangeText', { low: p.ci_low, high: p.ci_high })] : []),
            ...(fixed && !p.ai ? [t('ladder.nominal', { elo: p.nominal ?? p.rating })] : []),
          ];
          return (
            <li key={p.id} className="arena-rung">
              <span className={`arena-rank${i < 3 ? ` medal-${i + 1}` : ''}`} aria-label={t('ladder.rankLabel', { rank: i + 1 })}>{i + 1}</span>
              <div className="arena-rung-main">
                <div className="arena-rung-name">
                  <strong>{p.name}</strong>
                  <span title={t('ladder.games')}>{p.wins} · {p.draws} · {p.losses}</span>
                </div>
                {p.ci_low !== p.ci_high && (
                  <i className="arena-range" aria-hidden="true">
                    <b style={{ left: at(p.ci_low), width: `calc(${at(p.ci_high)} - ${at(p.ci_low)})` }} />
                    <em style={{ left: at(p.rating) }} />
                  </i>
                )}
                <small>{details.join(' · ')}</small>
              </div>
              <span className="arena-rung-rating">
                <strong>{p.rating}</strong>
                <small>{t('ladder.scoreText', { score: p.score })}</small>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="arena-hint">{hint}</p>
    </section>
  );
}
