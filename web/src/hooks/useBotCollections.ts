// The bot lobby's collections with what the server adds: installed engines and models, and the legends
// whose games are on disk (plus those still to fetch, for the Legends hall).
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { legendBots, mergeEngineBots } from '../data/bots';
import { botCollections } from '../data/collections';
import { useEngines, useGameData } from '../state/AppData';
import { useMasters } from './useMasters';

export function useBotCollections() {
  const { t } = useTranslation('play');
  const { engines } = useEngines();
  const { games } = useGameData();
  const masters = useMasters();
  const engineBots = useMemo(() => mergeEngineBots(engines), [engines]);
  const legends = useMemo(() => legendBots(masters.masters, t), [masters.masters, t]);
  const rating = Number(games.find(g => g.user_rating)?.user_rating) || null;
  const collections = useMemo(() => botCollections({ legends, engines: engineBots, rating }), [legends, engineBots, rating]);
  return { collections, rating, masters };
}
