import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { gamePath } from '../lib/routes';
import { useGameData } from '../state/AppData';

type Filter = 'all' | 'win' | 'loss' | 'draw';

/** Searchable list of archived games. */
export function GameLibrary({ activeId }: { activeId?: string }) {
  const { t } = useTranslation('games');
  const { games, gamesError, reloadGames } = useGameData();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(6);
  const query = search.trim().toLowerCase();
  const filtered = games.filter(g => (g.opponent ?? '').toLowerCase().includes(query) && (filter === 'all'
    || (filter === 'win' && g.user_result === 1) || (filter === 'loss' && g.user_result === 0) || (filter === 'draw' && g.user_result === 0.5)));

  return (
    <section className="library-section" aria-label={t('library.label')}>
      <div className="library-heading">
        <h2>{t('library.title')} <span id="game-count">{games.length}</span></h2>
        <label className="search"><span>⌕</span><input id="search" placeholder={t('library.searchPlaceholder')} aria-label={t('library.searchLabel')}
          value={search} onChange={e => { setSearch(e.target.value); setLimit(6); }} /></label>
      </div>
      <div className="library-filters">
        {(['all', 'win', 'loss', 'draw'] as Filter[]).map(key => (
          <button key={key} type="button" className={filter === key ? 'active' : ''} aria-pressed={filter === key}
            onClick={() => { setFilter(key); setLimit(6); }}>{t(`library.filters.${key}`)}</button>
        ))}
        <span id="library-summary">{t('library.summary', { count: filtered.length })}</span>
      </div>
      {gamesError
        ? <p className="empty-moves">{t('library.loadError')} <button type="button" className="text-button" onClick={reloadGames}>{t('library.retry')}</button></p>
        : (
          <div id="game-cards" className="game-cards">
            {filtered.length ? filtered.slice(0, limit).map(g => {
              const result = g.user_result === 1 ? 'win' : g.user_result === 0 ? 'loss' : 'draw';
              return (
                <Link key={g.id} to={gamePath(g.id)} className={`game-card${String(activeId) === String(g.id) ? ' active' : ''}`}
                  aria-label={t('library.cardLabel', { opponent: g.opponent, date: g.date })}>
                  <div className="card-top">
                    <span className={`result-badge ${result}`}>{t(`library.results.${result}`)}</span>
                    <span>{(g.date || t('library.undated')).replaceAll('.', ' / ')}</span>
                  </div>
                  <h3><span>{t('library.vs')}</span> {g.opponent}</h3>
                  <div className="card-bottom"><span>{g.user_color === 'white' ? t('library.asWhite') : t('library.asBlack')} · {t('library.moves', { count: Math.ceil((g.plies || 0) / 2) })}</span></div>
                </Link>
              );
            }) : <p className="empty-moves">{t('library.noMatch')}</p>}
          </div>
        )}
      {filtered.length > limit && <button id="load-more" type="button" className="text-button" onClick={() => setLimit(limit + 12)}>{t('library.showMore')}</button>}
    </section>
  );
}
