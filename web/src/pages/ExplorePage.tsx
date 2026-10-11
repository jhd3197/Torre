// /explore?fen&moves&base&from — try moves for both sides on a free copy of a position.
// The whole line lives in the URL, so a reload or a shared link restores it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { BoardWorkspace } from '../components/BoardWorkspace';
import { playMove } from '../hooks/useChess';
import { api } from '../lib/api';
import { explorePath, parseExplore } from '../lib/routes';
import { useToast } from '../state/AppData';
import { lastVisited } from '../state/lastVisited';
import type { Move } from '../types';

const lineCache = new Map<string, Move[]>();

/** SAN for a list of UCI moves. The server cuts the line at the first illegal move. */
function useSanLine(fen: string, ucis: string[]) {
  const uciList = ucis.join(',');
  const key = `${fen}|${uciList}`;
  const [line, setLine] = useState<{ key: string; moves: Move[] | null; error: string | null }>(
    () => ({ key, moves: lineCache.get(key) ?? null, error: null }));
  useEffect(() => {
    const cached = lineCache.get(key);
    if (cached) { setLine({ key, moves: cached, error: null }); return; }
    const controller = new AbortController();
    api<{ moves: Move[]; error?: string }>('api/line', { initialFen: fen, moves: uciList ? uciList.split(',') : [] }, controller.signal)
      .then(result => {
        if (!result.error) lineCache.set(key, result.moves);
        setLine({ key, moves: result.moves, error: result.error ?? null });
      })
      .catch(error => { if (!controller.signal.aborted) setLine({ key, moves: [], error: (error as Error).message }); });
    return () => controller.abort();
  }, [key, fen, uciList]);
  return line.key === key ? line : { key, moves: null, error: null };
}

function backLabel(t: TFunction<'play'>, from: string | null): string {
  if (!from) return '';
  if (from.startsWith('/play')) return t('explore.back.play');
  if (from.startsWith('/games')) return t('explore.back.games');
  if (from.startsWith('/train')) return t('explore.back.train');
  if (from.startsWith('/insights')) return t('explore.back.insights');
  return t('explore.back.home');
}

export function ExplorePage() {
  const { t } = useTranslation('play');
  const [params] = useSearchParams();
  const state = parseExplore(params);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { moves, error } = useSanLine(state.fen, state.moves);
  const [busy, setBusy] = useState(false);
  const [flipped, setFlipped] = useState(state.flipped);

  useEffect(() => { lastVisited.explore = location.pathname + location.search; }, [location]);
  useEffect(() => { if (error) toast(error); }, [error, toast]);

  // The cursor is the end of the line unless you step back; stepping back does not cut the line.
  const [cursor, setCursor] = useState<number | null>(null);
  const lineKey = state.moves.join(',');
  useEffect(() => setCursor(null), [lineKey]);
  const total = moves?.length ?? 0;
  const at = cursor === null ? total : Math.min(cursor, total);

  const update = useCallback((ucis: string[], replace = true) =>
    navigate(explorePath({ ...state, moves: ucis, base: Math.min(state.base, ucis.length), flipped }), { replace }),
  [navigate, state, flipped]);

  const play = async (uci: string) => {
    if (!moves) return;
    setBusy(true);
    try {
      const line = moves.slice(0, at);
      const played = await playMove(state.fen, line, uci);
      const next = [...line, { uci, san: played.san }];
      lineCache.set(`${state.fen}|${next.map(m => m.uci).join(',')}`, next);
      update(next.map(m => m.uci));
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  const fromLabel = backLabel(t, state.from);
  const branched = state.moves.length !== state.base || at !== total;
  const showMoves = useMemo(() => moves ?? [], [moves]);

  if (!moves) return <p className="page-status" role="status">{t('explore.loading')}</p>;

  return (
    <BoardWorkspace mode="explore" initialFen={state.fen} moves={showMoves} cursor={at} onGo={ply => setCursor(Math.max(0, Math.min(total, ply)))}
      flipped={flipped} onFlip={() => setFlipped(!flipped)}
      players={{ white: { name: t('explore.white'), detail: t('explore.whitePieces') }, black: { name: t('explore.black'), detail: t('explore.blackPieces') } }}
      movable="turn" onMove={play} busy={busy} busyText={t('explore.checking')} onTryBest={play}
      context={state.from ? (
        <div id="explore-context">
          <strong id="explore-context-title">{state.from.startsWith('/play') ? t('explore.gamePaused') : t('explore.exploringCopy')}</strong>
          <Link id="exit-explore" className="button" to={state.from}>{fromLabel}</Link>
        </div>
      ) : undefined}
      panelBottom={branched || state.base ? (
        <div id="branch-banner">
          <button id="return-game" type="button" disabled={!branched} onClick={() => update(state.moves.slice(0, state.base))}>{t('explore.resetLine')}</button>
        </div>
      ) : undefined} />
  );
}
