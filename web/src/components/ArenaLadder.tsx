// The Arena ladder: maximum-likelihood ratings over every match played (ladder.py), with
// 95% confidence intervals, so "is the 1800 bot really stronger than Capablanca?" has an answer.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import type { ArenaLadderData } from '../types';

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
  // Every range bar shares one scale, from the lowest bound to the highest, with a little room either side.
  const low = Math.min(...ladder.players.map(p => p.ci_low)) - 50;
  const high = Math.max(...ladder.players.map(p => p.ci_high)) + 50;
  const at = (rating: number) => `${((rating - low) / (high - low)) * 100}%`;
  return (
    <section className="arena-recent arena-ladder" aria-labelledby="arena-ladder-title">
      <h2 id="arena-ladder-title">{t('ladder.title')}</h2>
      <ol className="arena-list">
        {ladder.players.map((p, i) => {
          const fixed = p.placed_by === 'anchor' || p.placed_by === 'nominal';
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
                <small>
                  {p.ci_low !== p.ci_high ? t('ladder.rangeText', { low: p.ci_low, high: p.ci_high }) : ''}
                  {fixed ? `${p.ci_low !== p.ci_high ? ' · ' : ''}${t('ladder.nominal', { elo: p.nominal ?? p.rating })}` : ''}
                </small>
              </div>
              <span className="arena-rung-rating">
                <strong>{p.rating}</strong>
                <small>{t('ladder.scoreText', { score: p.score })}</small>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="arena-hint">{t('ladder.hint', { count: ladder.games })}{ladder.groups > 1 ? ` ${t('ladder.groups', { count: ladder.groups })}` : ''}</p>
    </section>
  );
}
