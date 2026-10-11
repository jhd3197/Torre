// The coach in plain words (explain.py): why a move was a mistake, and a review of a whole game. Both
// are grounded in engine facts on the server, cached there, and only offered when the AI coach is set up.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';

interface Answer<T> { answer: T | null; model: string | null; cached: boolean }
interface GameReviewText { headline: string; summary: string; lesson: string }

let ready: Promise<boolean> | null = null;
/** Whether the AI coach can answer (Prompture and a model); asked once per page load. */
export function useCoachReady() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    ready ??= api<{ available: boolean }>('api/coach/status').then(s => s.available, () => false);
    void ready.then(v => { if (live) setOk(v); });
    return () => { live = false; };
  }, []);
  return ok;
}
/** Tests reset the cached answer between cases. */
export const resetCoachReady = () => { ready = null; };

/** Ask `path` with `body`, showing a cached answer at once when there is one. */
function useAsk<T>(path: string, body: object, enabled: boolean) {
  const [answer, setAnswer] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(body);
  useEffect(() => {
    setAnswer(null);
    setError(null);
    if (!enabled) return;
    let live = true;
    // The body as of `key`: a caller's fresh object with the same fields asks nothing new.
    api<Answer<T>>(path, { ...JSON.parse(key), cachedOnly: true }).then(r => { if (live && r.answer) setAnswer(r.answer); }, () => { /* offered on demand */ });
    return () => { live = false; };
  }, [path, key, enabled]);
  const ask = () => {
    setBusy(true);
    setError(null);
    api<Answer<T>>(path, body).then(r => setAnswer(r.answer), (e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  return { answer, busy, error, ask };
}

/** "Why was this a mistake?" for `move` (SAN or UCI) in `fen`. */
export function ExplainMove({ fen, move }: { fen: string; move: string }) {
  const { t } = useTranslation('coach');
  const enabled = useCoachReady();
  const { answer, busy, error, ask } = useAsk<{ text: string }>('api/explain', { fen, move }, enabled);
  if (!enabled) return null;
  return (
    <div className="coach-explain" aria-live="polite">
      {answer ? <p><strong>{t('explain.title')}</strong> {answer.text}</p>
        : busy ? <p role="status">{t('explain.thinking')}</p>
          : <button type="button" className="text-button" onClick={ask}>{t('explain.ask', { move })}</button>}
      {error && <p role="alert">{t('error', { error })}</p>}
    </div>
  );
}

/** The coach's review of an analyzed game: a headline, how it went, one lesson. */
export function GameReview({ id }: { id: string | number }) {
  const { t } = useTranslation('coach');
  const enabled = useCoachReady();
  const { answer, busy, error, ask } = useAsk<GameReviewText>('api/coach/game', { id }, enabled);
  if (!enabled) return null;
  return (
    <div className="coach-explain coach-game-review" aria-live="polite">
      {answer ? <>
        <p><strong>{answer.headline}</strong></p>
        <p>{answer.summary}</p>
        {answer.lesson && <p><strong>{t('review.lesson')}</strong> {answer.lesson}</p>}
      </> : busy ? <p role="status">{t('review.thinking')}</p>
        : <button type="button" className="text-button" onClick={ask}>{t('review.ask')}</button>}
      {error && <p role="alert">{t('error', { error })}</p>}
    </div>
  );
}
