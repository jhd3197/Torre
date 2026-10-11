// /endgames — theoretical endgames played out against Stockfish (endgames.py);
// /endgames/:id plays one. The server judges every move and keeps completions.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChessBoard } from '../components/ChessBoard';
import { usePosition } from '../hooks/useChess';
import { usePlanning } from '../hooks/usePlanning';
import { api } from '../lib/api';
import { endgamePath } from '../lib/routes';
import { useGameData, useToast } from '../state/AppData';
import type { Color, Move } from '../types';

export interface Endgame {
  id: string;
  group: 'mates' | 'pawns' | 'pieces' | 'rooks';
  goal: 'win' | 'draw';
  moves: number;
  fen: string;
  color: Color;
  title: string;
  explain: string;
  attempts: number;
  completed: string | null;
  best: number | null;
}

export interface EndgameCatalog { positions: Endgame[]; completed: number; total: number }

export type EndgameReason = 'mate' | 'converted' | 'held' | 'drawn' | 'limit' | 'mated' | 'lost' | 'slipped';

export interface EndgameMove {
  status: 'playing' | 'success' | 'failed';
  reason: EndgameReason | null;
  reply: string | null;
  reply_san: string | null;
  used: number;
  progress: { attempts: number; completed?: string; best?: number };
}

const GROUPS: Endgame['group'][] = ['mates', 'pawns', 'pieces', 'rooks'];

export function EndgamesPage() {
  const { t } = useTranslation('endgames');
  const { id } = useParams();
  const [catalog, setCatalog] = useState<EndgameCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { document.body.dataset.page = 'train'; }, []);

  const load = useCallback(async () => {
    setError(null);
    try { setCatalog(await api<EndgameCatalog>('api/endgames')); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  let content;
  if (error) content = <p className="train-empty" role="alert">{error} <button type="button" className="text-button" onClick={load}>{t('tryAgain')}</button></p>;
  else if (!catalog) content = <p className="train-empty" role="status">{t('loading')}</p>;
  else if (id) {
    const index = catalog.positions.findIndex(p => p.id === id);
    content = index < 0
      ? <p className="train-empty" role="alert">{t('notFound')} <Link className="text-button" to={endgamePath()}>{t('actions.all')}</Link></p>
      : <EndgamePlay key={id} position={catalog.positions[index]} next={catalog.positions[index + 1]} onRecorded={load} />;
  } else {
    content = <>
      <p className="train-detail">{t('intro', { completed: catalog.completed, total: catalog.total })}</p>
      {GROUPS.map(group => {
        const positions = catalog.positions.filter(p => p.group === group);
        return positions.length > 0 && (
          <section key={group} className="lesson-group" aria-labelledby={`endgames-${group}`}>
            <h2 id={`endgames-${group}`}>{t(`groups.${group}`)}</h2>
            <div className="lesson-cards">
              {positions.map(p => (
                <Link key={p.id} className={`lesson-card${p.completed ? ' completed' : ''}`} to={endgamePath(p.id)}>
                  <h3>{p.title}</h3>
                  <span className="lesson-meta">{t(`goal.${p.goal}.${p.color}`)} · {t(p.goal === 'win' ? 'meta.win' : 'meta.draw', { count: p.moves })}</span>
                  <span className="lesson-status">{p.completed ? t('status.done', { count: p.best ?? p.moves }) : p.attempts ? t('status.tried', { count: p.attempts }) : t('status.new')}</span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </>;
  }

  return (
    <section id="endgames" className="train" aria-label={t('page.label')}>
      <nav className="train-actions" aria-label={t('page.modes')}>
        <Link className="text-button" to="/train">{t('page.drills')}</Link>
        <Link className="text-button" to="/openings">{t('page.openings')}</Link>
        {id && <Link className="text-button" to={endgamePath()}>{t('actions.all')}</Link>}
      </nav>
      {content}
    </section>
  );
}

function EndgamePlay({ position, next, onRecorded }: { position: Endgame; next?: Endgame; onRecorded: () => void }) {
  const { t } = useTranslation('endgames');
  const toast = useToast();
  const { engineAvailable } = useGameData();
  const [moves, setMoves] = useState<Move[]>([]);
  const [result, setResult] = useState<EndgameMove | null>(null);
  const [busy, setBusy] = useState(false);
  const { board } = usePosition(position.fen, moves);
  const planning = usePlanning(board);
  const over = !!result && result.status !== 'playing';

  async function play(uci: string) {
    if (busy || over) return;
    const before = moves;
    const played = [...before, { uci, san: '' }];
    setMoves(played);
    setBusy(true);
    try {
      const answer = await api<EndgameMove>('api/endgames/move', { id: position.id, moves: played.map(m => m.uci) });
      setResult(answer);
      if (answer.reply) setMoves([...played, { uci: answer.reply, san: answer.reply_san ?? '' }]);
      if (answer.status === 'success' || (before.length === 0)) onRecorded();
    } catch (e) {
      setMoves(before);
      toast((e as Error).message);
    } finally { setBusy(false); }
  }

  const retry = () => { setMoves([]); setResult(null); };
  const used = result?.used ?? 0;
  const last = moves.at(-1)?.uci ?? null;

  return (
    <div className="train-layout">
      <div className="train-board-column">
        <ChessBoard board={board} flipped={position.color === 'black'} planning={planning} lastMove={last}
          movable={over || busy || !engineAvailable ? false : position.color} onMove={play} busy={busy} />
      </div>
      <aside className="train-panel" aria-live="polite">
        <p className="train-source">{t(`groups.${position.group}`)}{position.completed ? ` · ${t('status.done', { count: position.best ?? position.moves })}` : ''}</p>
        <h2>{position.title}</h2>
        <p className="train-prompt"><strong>{t(`goal.${position.goal}.${position.color}`)}.</strong> {position.explain}</p>
        {!engineAvailable && <p className="train-detail">{t('noEngine')}</p>}
        {over && result ? (
          <p className={`train-verdict ${result.status === 'success' ? 'correct' : 'missed'}`}>
            {t(`result.${result.status}.${result.reason}`, { count: used })}
          </p>
        ) : (
          <p className="train-detail">{t(position.goal === 'win' ? 'left.win' : 'left.draw', { count: position.moves - used })}</p>
        )}
        <div className="train-actions">
          {(over || moves.length > 0) && <button className={`button${over ? ' primary' : ''}`} type="button" onClick={retry}>{t('actions.retry')}</button>}
          {over && next && <Link className="text-button" to={endgamePath(next.id)}>{t('actions.next')}</Link>}
          <Link className="text-button" to={endgamePath()}>{t('actions.all')}</Link>
        </div>
      </aside>
    </div>
  );
}
