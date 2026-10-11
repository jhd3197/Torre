// /openings — drill your opening repertoire (openings.py) on the drills' FSRS schedule.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { ChessBoard } from '../components/ChessBoard';
import { usePosition } from '../hooks/useChess';
import { usePlanning } from '../hooks/usePlanning';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { explorePath } from '../lib/routes';
import { useToast } from '../state/AppData';
import type { Color } from '../types';

export interface OpeningCard {
  id: string;
  source: 'games' | 'custom';
  color: Color;
  fen: string;
  line: string[];
  seen: number | null;
  opening: string | null;
}

export interface OpeningLine { id: string; color: Color; text: string; added: string | null }

export interface OpeningDeck {
  total: number;
  learned: number;
  due: number;
  new: number;
  new_total: number;
  new_per_day: number;
  next_due: string | null;
  colors: Record<Color, number>;
  card: OpeningCard | null;
  lines: OpeningLine[];
}

export interface OpeningAnswer {
  correct: boolean;
  san: string;
  best: string;
  best_san: string;
  source: 'games' | 'custom';
  seen: number | null;
  played: { san: string; count: number }[];
  corrected: boolean;
  reviewed: boolean;
  next_review: string;
  next: OpeningDeck;
}

const NO_MOVES: never[] = [];

/** "1. e4 e5 2. Nf3" from SAN moves played from the start. */
export const numbered = (sans: string[]) =>
  sans.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(' ');

export function OpeningsPage() {
  const { t } = useTranslation('openings');
  const toast = useToast();
  const [deck, setDeck] = useState<OpeningDeck | null>(null);
  const [answer, setAnswer] = useState<OpeningAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [color, setColor] = useState<Color>('white');
  const [text, setText] = useState('');
  const card = deck?.card ?? null;
  const { board } = usePosition(card?.fen ?? '', NO_MOVES, !!card);
  const shown = card ? board : null;
  const planning = usePlanning(shown);

  useEffect(() => { document.body.dataset.page = 'train'; }, []);

  const load = useCallback(async () => {
    setError(null);
    try { setDeck(await api<OpeningDeck>('api/openings')); setAnswer(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function play(uci: string) {
    if (!card || answer) return;
    setBusy(true);
    try { setAnswer(await api<OpeningAnswer>('api/openings/answer', { id: card.id, move: uci })); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  }

  async function addLine(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{ next: OpeningDeck }>('api/openings/lines', { color, line: text });
      setText('');
      if (!answer) setDeck(result.next);
      else setDeck(d => d && { ...d, lines: result.next.lines });
      toast(t('lines.added'));
    } catch (e) { toast((e as Error).message); }
  }

  async function removeLine(id: string) {
    try {
      const result = await api<{ next: OpeningDeck }>('api/openings/lines/delete', { id });
      if (!answer) setDeck(result.next);
      else setDeck(d => d && { ...d, lines: result.next.lines });
    } catch (e) { toast((e as Error).message); }
  }

  const next = () => { if (answer) { setDeck(answer.next); setAnswer(null); } };
  const counts = deck && (
    <dl className="train-counts">
      <div><dt>{t('counts.due')}</dt><dd>{deck.due}</dd></div>
      <div><dt>{t('counts.newToday')}</dt><dd>{deck.new}</dd></div>
      <div><dt>{t('counts.learned')}</dt><dd>{deck.learned} <small>{t('counts.ofTotal', { total: deck.total })}</small></dd></div>
    </dl>
  );

  const lines = deck && (
    <section className="train-detail" aria-labelledby="opening-lines">
      <h3 id="opening-lines">{t('lines.title')}</h3>
      <p>{t('lines.body')}</p>
      {deck.lines.length > 0 && (
        <ul>
          {deck.lines.map(line => (
            <li key={line.id}>
              {t(`color.${line.color}`)}: {line.text}{' '}
              <button type="button" className="text-button" onClick={() => removeLine(line.id)} aria-label={t('lines.removeLabel', { line: line.text })}>{t('lines.remove')}</button>
            </li>
          ))}
        </ul>
      )}
      <form className="train-actions" onSubmit={addLine}>
        <select aria-label={t('lines.color')} value={color} onChange={e => setColor(e.target.value as Color)}>
          <option value="white">{t('color.white')}</option>
          <option value="black">{t('color.black')}</option>
        </select>
        <input aria-label={t('lines.moves')} placeholder={t('lines.placeholder')} value={text} onChange={e => setText(e.target.value)} />
        <button className="button" type="submit" disabled={!text.trim()}>{t('lines.add')}</button>
      </form>
    </section>
  );

  let content;
  if (error) content = <p className="train-empty" role="alert">{error} <button type="button" className="text-button" onClick={load}>{t('tryAgain')}</button></p>;
  else if (!deck) content = <p className="train-empty" role="status">{t('loading')}</p>;
  else if (!card) {
    content = (
      <div className="train-done">
        {deck.total ? <>
          <h2>{t('done.title')}</h2>
          <p>{deck.next_due ? t('done.nextReview', { when: relativeTime(deck.next_due) }) : t('done.comeBack')}
            {deck.new_total ? t('done.newWaiting', { count: deck.new_total, perDay: deck.new_per_day }) : ''}</p>
        </> : <>
          <h2>{t('empty.title')}</h2>
          <p>{t('empty.body')}</p>
        </>}
        {counts}
        {lines}
      </div>
    );
  } else {
    const flipped = card.color === 'black';
    content = (
      <div className="train-layout">
        <div className="train-board-column">
          <ChessBoard board={shown} flipped={flipped} planning={planning} movable={answer ? false : 'turn'} onMove={play}
            busy={busy} highlight={answer ? [answer.best.slice(0, 2), answer.best.slice(2, 4)] : []} bestMove={answer && !answer.correct ? answer.best : null} />
        </div>
        <aside className="train-panel" aria-live="polite">
          <p className="train-source">
            {card.line.length ? t('source.after', { line: numbered(card.line) }) : t('source.start')}
            {card.opening ? ` · ${card.opening}` : ''}
          </p>
          {!answer ? (
            <p className="train-prompt">
              <Trans t={t} i18nKey={flipped ? 'prompt.black' : 'prompt.white'} components={{ strong: <strong /> }} />
              {card.source === 'custom' ? t('prompt.custom') : card.seen ? t('prompt.seen', { count: card.seen }) : ''}
            </p>
          ) : <>
            {answer.correct
              ? <p className="train-verdict correct"><Trans t={t} i18nKey="verdict.correct" values={{ move: answer.san }} components={{ strong: <strong /> }} /></p>
              : <p className="train-verdict missed"><Trans t={t} i18nKey="verdict.missed" values={{ move: answer.san, best: answer.best_san }} components={{ strong: <strong />, best: <strong /> }} /></p>}
            {answer.corrected && <p className="train-detail">{t('detail.corrected')}</p>}
            <p className="train-detail">
              {answer.played.length > 0 && `${t('detail.played', { moves: answer.played.map(p => `${p.san} ×${p.count}`).join(', ') })} `}
              {t('detail.returns', { when: relativeTime(answer.next_review) })}
            </p>
            <div className="train-actions">
              <button className="button primary" type="button" onClick={next}>{t('actions.next')}</button>
              <Link className="text-button" to={explorePath({ fen: card.fen, from: '/openings' })}>{t('actions.explore')}</Link>
            </div>
          </>}
          {counts}
          {lines}
        </aside>
      </div>
    );
  }

  return (
    <section id="openings" className="train" aria-label={t('page.label')}>
      <nav className="train-actions" aria-label={t('page.modes')}>
        <Link className="text-button" to="/train">{t('page.drills')}</Link>
        <Link className="text-button" to="/endgames">{t('page.endgames')}</Link>
      </nav>
      {content}
    </section>
  );
}
