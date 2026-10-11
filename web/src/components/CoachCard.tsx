// The AI coach from /api/coach (coach.py): an LLM reads a brief of your numbers and answers with a
// headline, strengths, a week's plan and focus areas tied to saved, measurable activities. Without
// Prompture it offers to install it; without a model it offers the AI setup (AiSetup: a provider, the
// player's own key, a model), once on its own. `useCoach` loads it once for the page: the header's model menu, Rooky's
// talking points and the "Rooky noticed" card all read the same state.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { AiSetupDialog } from './AiSetup';
import { usePoll } from '../hooks/usePoll';
import { lessonPath, puzzlePath } from '../lib/routes';

export type CoachDrillKind = 'puzzles' | 'lessons' | 'openings' | 'play';

export interface CoachAdvice {
  headline: string;
  strengths: string[];
  focus: { title: string; why: string; drill: { kind: CoachDrillKind; target: string } }[];
  weekly_plan: string[];
}

export interface CoachTask {
  id: string; kind: CoachDrillKind; target: string; title: string; why: string;
  goal: number; progress: number; done: boolean;
}

export interface CoachData {
  tasks?: CoachTask[];
  available: boolean;
  model: string | null;
  /** The model was picked from the local Ollama, not chosen. */
  auto?: boolean;
  /** Prompture strings for the models a local Ollama serves. */
  models?: string[];
  reason: 'prompture_missing' | 'no_model' | null;
  /** The one-time AI setup dialog was shown already. */
  setup_seen?: boolean;
  advice: CoachAdvice | null;
  fresh: boolean;
  generated_at: string | null;
  job: { running: boolean; error: string | null };
  install?: { running: boolean; error: string | null; done: boolean };
}

/** A coach answer or a model install takes tens of seconds; a slow check is plenty. */
const COACH_POLL_MS = 3000;
const busy = (data: CoachData) => !!data.job.running || !!data.install?.running;

export const drillPath = ({ kind, target }: { kind: CoachDrillKind; target: string }) =>
  kind === 'puzzles' ? puzzlePath(target || undefined)
    : kind === 'lessons' ? lessonPath(target || undefined)
      : kind === 'openings' ? '/openings'
        : '/play/bots';

/** A local Ollama model runs on this computer; its name reads better without the provider. */
const localName = (model: string) => (model.startsWith('ollama/') ? model.slice('ollama/'.length) : null);

export interface CoachState {
  coach: CoachData | null;
  failed: string | null;
  running: boolean;
  load: () => Promise<CoachData | null>;
  post: (path: string, body: object) => Promise<void>;
  chooseModel: (model: string) => Promise<void>;
}

export function useCoach(): CoachState {
  const [coach, setCoach] = useState<CoachData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const { schedule, cancel, signal } = usePoll();

  const load = useCallback(async (): Promise<CoachData | null> => {
    const live = signal();
    try {
      const data = await api<CoachData>('api/coach', undefined, live);
      if (live.aborted) return null;
      setCoach(data);
      setFailed(null);
      return data;
    } catch (error) {
      if (!live.aborted) setFailed((error as Error).message);
      return null;
    }
  }, [signal]);

  useEffect(() => { void load(); }, [load]);

  // While a job or an install runs, check back (through a failed check too).
  const follow = useCallback(async () => {
    const data = await load();
    if (!data || busy(data)) schedule(follow, COACH_POLL_MS);
  }, [load, schedule]);
  const running = !!coach && busy(coach);
  useEffect(() => {
    if (running) schedule(follow, COACH_POLL_MS);
    else cancel();
  }, [running, follow, schedule, cancel]);

  const post = useCallback((path: string, body: object) => {
    setFailed(null);
    return api<CoachData>(path, body).then(setCoach).catch((error: Error) => setFailed(error.message));
  }, []);
  const chooseModel = useCallback((model: string) => post('api/coach/model', { model }), [post]);
  return { coach, failed, running, load, post, chooseModel };
}

/** "Rooky noticed": the coach's headline, what works, what to work on, and the saved plan's status. */
export function CoachCard({ state }: { state: CoachState }) {
  const { t } = useTranslation('coach');
  const { coach, failed, running, load, post } = state;

  if (!coach) return <section className="coach-notes coach-notes-loading" role={failed ? 'alert' : 'status'}>
    {failed ? <>{t('loadFailed')} <button type="button" className="text-button" onClick={() => load()}>{t('retry')}</button></> : t('loading')}
  </section>;

  const heading = <h2 id="coach-notes-title">{t('notes.title')}</h2>;
  const tasks = coach.tasks ?? [];

  if (coach.reason === 'prompture_missing') {
    const install = coach.install;
    return (
      <section className="coach-notes" aria-labelledby="coach-notes-title" aria-busy={!!install?.running}>
        {heading}
        <Tasks tasks={tasks} />
        <p className="coach-notes-text">{t('setup.prompture_missing')}</p>
        {install?.running
          ? <p className="coach-notes-text" role="status">{t('setup.installing')}</p>
          : <button type="button" className="button primary" onClick={() => post('api/coach/install', {})}>{t('setup.install')}</button>}
        {(failed ?? install?.error) && !install?.running &&
          <p className="coach-notes-text" role="alert">{t('setup.installFailed', { error: failed ?? install?.error })}</p>}
      </section>
    );
  }

  if (!coach.available) return <NoModel coach={coach} tasks={tasks} heading={heading} failed={failed} load={load} />;

  const advice = coach.advice;
  const error = failed ?? coach.job.error;
  return (
    <section className="coach-notes" aria-labelledby="coach-notes-title" aria-busy={running}>
      {heading}
      {advice?.headline && <p className="coach-notes-headline">{advice.headline}</p>}
      {advice?.strengths.length ? <ul className="coach-notes-list" aria-label={t('strengths')}>
        {advice.strengths.map(line => <li key={line} className="is-good"><span aria-hidden="true">✓</span><p>{line}</p></li>)}
      </ul> : null}
      {tasks.length ? <Tasks tasks={tasks} /> : advice?.focus.length ? <ul className="coach-notes-list" aria-label={t('focus')}>
        {advice.focus.map(area => <li key={area.title} className="is-fix"><span aria-hidden="true">!</span>
          <div><p><strong>{area.title}.</strong> {area.why}</p>
            <Link className="coach-notes-act" to={drillPath(area.drill)}>{t(`drill.${area.drill.kind}`)} →</Link></div>
        </li>)}
      </ul> : null}
      {!advice && !running && <p className="coach-notes-text">{t('empty')}</p>}
      <footer className="coach-notes-status">
        <p role="status">{running ? t('thinking') : coach.fresh ? t('saved') : advice ? t('stale') : t('onDemand')}
          {coach.generated_at && <small>{t('savedAt', { date: new Date(coach.generated_at).toLocaleDateString() })}</small>}
        </p>
        <button type="button" className="button" disabled={running || coach.fresh} onClick={() => post('api/coach', {})}>
          {advice ? t('regenerate') : t('ask')}
        </button>
      </footer>
      {error && !running && <p className="coach-notes-text" role="alert">{t('error', { error })}</p>}
    </section>
  );
}

/** No model yet: say so and offer the setup, opening it on its own the first time (then never again). */
function NoModel({ coach, tasks, heading, failed, load }: {
  coach: CoachData; tasks: CoachTask[]; heading: ReactNode; failed: string | null; load: () => Promise<CoachData | null>;
}) {
  const { t } = useTranslation('coach');
  const [open, setOpen] = useState(!coach.setup_seen);
  useEffect(() => {
    if (!coach.setup_seen) api('api/coach/ai/seen', {}).catch(() => {});
  }, [coach.setup_seen]);
  const close = (saved: boolean) => {
    setOpen(false);
    if (saved) load();
  };
  return (
    <section className="coach-notes" aria-labelledby="coach-notes-title">
      {heading}
      <Tasks tasks={tasks} />
      <p className="coach-notes-text">{t('setup.no_model')}</p>
      <button type="button" className="button primary" onClick={() => setOpen(true)}>{t('setup.button')}</button>
      {failed && <p className="coach-notes-text" role="alert">{failed}</p>}
      <AiSetupDialog open={open} onClose={close} />
    </section>
  );
}

/** The coach's saved tasks, each with its progress and where it is done. */
function Tasks({ tasks }: { tasks: CoachTask[] }) {
  const { t } = useTranslation('coach');
  if (!tasks.length) return null;
  const done = tasks.filter(task => task.done).length;
  return <div className="coach-tasks">
    <div className="coach-tasks-head"><h3>{t('tasks.title')}</h3><span>{t('tasks.complete', { count: done, total: tasks.length })}</span></div>
    <ul className="coach-notes-list">{tasks.map(task => {
      const name = task.title || t(`tasks.kind.${task.kind}`);
      return <li key={task.id} className={task.done ? 'is-good' : 'is-fix'}><span aria-hidden="true">{task.done ? '✓' : '!'}</span>
        <div>
          <p><strong>{name}.</strong> {t(`tasks.goal.${task.kind}`, { count: task.goal })}</p>
          {task.why && <p className="coach-notes-why">{task.why}</p>}
          <div className="coach-task-progress">
            <progress value={task.progress} max={task.goal} aria-label={name} />
            <span>{task.done ? t('tasks.done') : t('tasks.progress', { count: task.progress, goal: task.goal })}</span>
          </div>
          <Link className="coach-notes-act" to={drillPath(task)}>{task.done ? t('tasks.again') : t(`drill.${task.kind}`)} →</Link>
        </div>
      </li>;
    })}</ul>
  </div>;
}

/** The header chip naming the coach's model, opening a menu of the local models and a way to the AI settings. */
export function ModelMenu({ state }: { state: CoachState }) {
  const { t } = useTranslation('coach');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape); };
  }, [open]);

  const { coach, chooseModel } = state;
  if (!coach?.available || !coach.model) return null;
  const local = localName(coach.model);
  const models = coach.models ?? [];
  const choose = (model: string) => chooseModel(model).then(() => setOpen(false));
  return (
    <div className="coach-model-menu" ref={box}>
      <button type="button" className="coach-chip" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(on => !on)}
        title={t('menu.change')}>
        <span className="coach-chip-dot" aria-hidden="true" />
        {local ? t('menu.local', { model: local }) : coach.model}
      </button>
      {open && <div className="coach-model-panel" role="group" aria-label={t('menu.change')}>
        <p>{coach.auto ? t('modelAuto', { model: coach.model }) : t('model', { model: coach.model })}</p>
        {models.length > 0 && <div className="coach-model-list">{models.map(model => (
          <button key={model} type="button" aria-pressed={model === coach.model} onClick={() => choose(model)}>{localName(model) ?? model}</button>
        ))}</div>}
        <Link className="coach-notes-act" to="/settings/ai" onClick={() => setOpen(false)}>{t('menu.settings')} →</Link>
      </div>}
    </div>
  );
}
