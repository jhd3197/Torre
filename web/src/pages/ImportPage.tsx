// /import — bring games into the library from chess.com, Lichess or PGN files.
// The server fetches or reads them into a preview (api/import/*); nothing is
// saved until you pick the games to keep. Then they are analysed like the rest.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { usePoll } from '../hooks/usePoll';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { IMPORT_ART } from '../lib/art';
import { useAnalysis, useGameData, useToast } from '../state/AppData';
import type { Color } from '../types';

type Source = 'chesscom' | 'lichess' | 'file';
type Range = 'month' | 'quarter' | 'year' | 'all';

interface Candidate {
  id: string; date?: string | null; opponent?: string; type?: string; user_color: Color;
  user_result?: number | null; plies?: number; user_rating?: number | null; opp_rating?: number | null; exists: boolean;
}
interface Failure { where: string | null; white: string | null; black: string | null; error: string }
export interface ImportStatus {
  phase: 'idle' | 'fetching' | 'ready' | 'done' | 'error' | 'cancelled' | 'choose';
  source: Source | null; username: string | null; done: number; total: number; label: string | null; error: string | null;
  games: Candidate[]; failed: Failure[]; added: number; duplicates: number; players?: { name: string; games: number }[];
}
interface PickedFile { name: string; text: string }

const SOURCES: { key: Source; art: string }[] = [
  { key: 'chesscom', art: 'art/topics/as-white.webp' },
  { key: 'lichess', art: 'art/topics/as-black.webp' },
  { key: 'file', art: IMPORT_ART },
];
const RANGES: Range[] = ['month', 'quarter', 'year', 'all'];
/** A fetch reports progress per page of games, so the count moves visibly at this pace. */
const IMPORT_POLL_MS = 700;
const RANGE_DAYS: Record<Range, number | null> = { month: 31, quarter: 92, year: 366, all: null };

/** The first day of the range, as the server wants it ('YYYY-MM-DD'), or null for all time. */
export function rangeStart(range: Range, today = new Date()): string | null {
  const days = RANGE_DAYS[range];
  return days === null ? null : new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export function ImportPage() {
  const { t } = useTranslation('import');
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [source, setSource] = useState<Source>('chesscom');
  const [error, setError] = useState('');
  const { schedule, cancel, signal } = usePoll();

  useEffect(() => {
    document.body.dataset.page = 'import';
    return () => { document.body.dataset.page = 'board'; };
  }, []);

  const refresh = useCallback(async () => {
    cancel();
    const live = signal();
    try {
      const next = await api<ImportStatus>('api/import/status', undefined, live);
      if (live.aborted) return;
      setStatus(next);
      if (next.source) setSource(next.source);
      if (next.phase === 'fetching') schedule(refresh, IMPORT_POLL_MS);
    } catch (e) {
      if (!live.aborted) setError((e as Error).message);
    }
  }, [cancel, schedule, signal]);
  useEffect(() => { void refresh(); }, [refresh]);

  /** Run a request that answers with the job's status. */
  async function act(path: string, body: unknown = {}) {
    setError('');
    try {
      const next = await api<ImportStatus>(path, body);
      setStatus(next);
      if (next.phase === 'fetching') schedule(refresh, IMPORT_POLL_MS);
      return next;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }
  const startOver = () => act('api/import/cancel');

  const phase = status?.phase ?? 'idle';
  return (
    <section id="import" className="import-page" aria-label={t('label')}>
      {phase === 'fetching' && status ? <Fetching status={status} onCancel={startOver} />
        : phase === 'ready' && status ? <Preview status={status} error={error} onCommit={ids => act('api/import/commit', { ids })} onStartOver={startOver} />
          : phase === 'done' && status ? <Summary status={status} onMore={startOver} />
            : (
              <>
                <div className="import-sources" role="radiogroup" aria-label={t('sourceLabel')}>
                  {SOURCES.map(({ key, art }) => (
                    <button key={key} type="button" role="radio" aria-checked={source === key} className="import-source"
                      onClick={() => { setSource(key); setError(''); }}>
                      <img src={art} alt="" width="40" height="40" />
                      <span><strong>{t(`sources.${key}.name`)}</strong><small>{t(`sources.${key}.note`)}</small></span>
                    </button>
                  ))}
                </div>
                <div className="import-panel">
                  {source === 'file'
                    ? <FileForm key="file" act={act} choose={phase === 'choose' ? status?.players ?? [] : null} />
                    : <AccountForm key={source} source={source} act={act} />}
                  {(error || (phase === 'error' && status?.error)) && <p className="import-error" role="alert">{error || status?.error}</p>}
                  {phase === 'cancelled' && !error && <p className="import-hint">{t('fetching.cancelled')}</p>}
                </div>
              </>
            )}
    </section>
  );
}

type Act = (path: string, body?: unknown) => Promise<ImportStatus | null>;

function AccountForm({ source, act }: { source: 'chesscom' | 'lichess'; act: Act }) {
  const { t } = useTranslation('import');
  const [username, setUsername] = useState('');
  const [range, setRange] = useState<Range>('quarter');
  const [busy, setBusy] = useState(false);
  const site = t(`sources.${source}.name`);

  // The account you imported from last time.
  useEffect(() => {
    let live = true;
    api<{ accounts?: Partial<Record<Source, string | null>> }>('api/setup')
      .then(data => { const saved = data?.accounts?.[source]; if (live && saved) setUsername(current => current || saved); })
      .catch(() => { /* no saved account */ });
    return () => { live = false; };
  }, [source]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await act('api/import/fetch', { source, username: username.trim(), since: rangeStart(range) });
    setBusy(false);
  }

  return (
    <form className="import-form" onSubmit={submit}>
      <label className="import-field">
        <span>{t('account.username', { site })}</span>
        <input required value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" spellCheck={false}
          placeholder={t('account.placeholder')} pattern="[A-Za-z0-9_\-]{2,30}" />
      </label>
      <fieldset className="import-field">
        <legend>{t('account.range')}</legend>
        <div className="import-ranges">
          {RANGES.map(key => (
            <button key={key} type="button" aria-pressed={range === key} onClick={() => setRange(key)}>{t(`account.ranges.${key}`)}</button>
          ))}
        </div>
      </fieldset>
      <button className="button primary" type="submit" disabled={busy || !username.trim()}>{t('account.fetch')}</button>
      {source === 'chesscom' && <p className="import-hint">{t('account.botsNote')}</p>}
    </form>
  );
}

function FileForm({ act, choose }: { act: Act; choose: { name: string; games: number }[] | null }) {
  const { t } = useTranslation('import');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [paste, setPaste] = useState('');
  const [dragging, setDragging] = useState(false);
  const [me, setMe] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function add(list: FileList | null) {
    if (!list) return;
    const read = await Promise.all([...list].map(async file => ({ name: file.name, text: await file.text() })));
    setFiles(current => [...current.filter(f => !read.some(r => r.name === f.name)), ...read]);
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void add(event.dataTransfer.files);
  }

  const payload = () => [...files, ...(paste.trim() ? [{ name: 'pasted.pgn', text: paste }] : [])];
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await act('api/import/files', { files: payload(), ...(choose && me ? { me } : {}) });
    setBusy(false);
  }

  if (choose) {
    return (
      <form className="import-form" onSubmit={submit}>
        <h2>{t('choose.title')}</h2>
        <p className="import-hint">{t('choose.note')}</p>
        <div className="import-players" role="radiogroup" aria-label={t('choose.title')}>
          {choose.map(p => (
            <button key={p.name} type="button" role="radio" aria-checked={me === p.name} onClick={() => setMe(p.name)}>
              <strong>{p.name}</strong><small>{t('choose.games', { count: p.games })}</small>
            </button>
          ))}
        </div>
        <button className="button primary" type="submit" disabled={busy || !me}>{t('choose.continue')}</button>
      </form>
    );
  }

  return (
    <form className="import-form" onSubmit={submit}>
      <div className={`import-drop${dragging ? ' dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)} onDrop={drop}>
        <img src={IMPORT_ART} alt="" width="48" height="48" />
        <p>{t('file.drop')} <button type="button" className="text-button" onClick={() => input.current?.click()}>{t('file.browse')}</button></p>
        <small>{t('file.kinds')}</small>
        <input ref={input} type="file" multiple accept=".pgn,.json,.txt" hidden aria-label={t('file.browse')}
          onChange={e => { void add(e.target.files); e.target.value = ''; }} />
      </div>
      {files.length > 0 && (
        <ul className="import-files">
          {files.map(f => (
            <li key={f.name}>
              <span>{f.name}</span>
              <button type="button" className="icon-button" aria-label={t('file.remove', { name: f.name })}
                onClick={() => setFiles(current => current.filter(x => x.name !== f.name))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <label className="import-field">
        <span>{t('file.paste')}</span>
        <textarea value={paste} onChange={e => setPaste(e.target.value)} aria-label={t('file.pasteLabel')}
          placeholder={'[White "You"]\n[Black "Opponent"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *'} />
      </label>
      <button className="button primary" type="submit" disabled={busy || payload().length === 0}>{t('file.read')}</button>
    </form>
  );
}

function Fetching({ status, onCancel }: { status: ImportStatus; onCancel: () => void }) {
  const { t } = useTranslation('import');
  const pct = status.total ? Math.round(100 * status.done / status.total) : null;
  const site = status.source ? t(`sources.${status.source}.name`) : '';
  return (
    <div className="import-panel import-progress">
      <h2>{t('fetching.title', { site, username: status.username })}</h2>
      <div className={`import-bar${pct === null ? ' indeterminate' : ''}`} role="progressbar" aria-label={t('fetching.label')}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
        <i style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
      <p className="import-hint">
        {status.label ? t('fetching.month', { month: status.label, done: status.done, total: status.total })
          : pct === null ? t('fetching.count', { count: status.done }) : t('fetching.finishing')}
      </p>
      <button className="button" type="button" onClick={onCancel}>{t('fetching.cancel')}</button>
    </div>
  );
}

const resultKey = (r?: number | null) => r === 1 ? 'win' : r === 0 ? 'loss' : r === 0.5 ? 'draw' : 'unknown';

function Preview({ status, error, onCommit, onStartOver }: {
  status: ImportStatus; error: string; onCommit: (ids: string[]) => Promise<unknown>; onStartOver: () => void;
}) {
  const { t } = useTranslation('import');
  const fresh = useMemo(() => status.games.filter(g => !g.exists).map(g => g.id), [status.games]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(fresh));
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(100);
  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function commit() {
    setBusy(true);
    await onCommit([...selected]);
    setBusy(false);
  }

  return (
    <div className="import-panel">
      <div className="import-preview-head">
        <div>
          <h2>{t('preview.title', { count: status.games.length })}</h2>
          <p className="import-hint">{t('preview.fresh', { count: fresh.length })} · {t('preview.have', { count: status.games.length - fresh.length })}</p>
        </div>
        <div className="import-preview-actions">
          <button type="button" className="text-button" onClick={() => setSelected(new Set(fresh))}>{t('preview.selectNew')}</button>
          <button type="button" className="text-button" onClick={() => setSelected(new Set())}>{t('preview.selectNone')}</button>
        </div>
      </div>
      {status.games.length === 0 ? <p className="import-empty">{t('preview.nothing')}</p> : (
        <div className="import-table-wrap">
          <table className="import-table">
            <thead>
              <tr>
                <th scope="col" aria-label={t('preview.columns.pick')} />
                <th scope="col">{t('preview.columns.date')}</th>
                <th scope="col">{t('preview.columns.opponent')}</th>
                <th scope="col">{t('preview.columns.color')}</th>
                <th scope="col">{t('preview.columns.result')}</th>
                <th scope="col">{t('preview.columns.moves')}</th>
              </tr>
            </thead>
            <tbody>
              {status.games.slice(0, limit).map(g => {
                const result = resultKey(g.user_result);
                return (
                  <tr key={g.id} className={g.exists ? 'exists' : undefined}>
                    <td><input type="checkbox" checked={selected.has(g.id)} onChange={() => toggle(g.id)}
                      aria-label={t('preview.pick', { opponent: g.opponent, date: g.date })} /></td>
                    <td>{(g.date || '?').replaceAll('.', ' / ')}</td>
                    <td>
                      {g.opponent}{g.opp_rating ? <small> {g.opp_rating}</small> : null}
                      {g.exists && <span className="import-badge">{t('preview.inLibrary')}</span>}
                    </td>
                    <td>{t(`preview.${g.user_color}`)}</td>
                    <td><span className={`result-badge ${result}`}>{t(`preview.results.${result}`)}</span></td>
                    <td>{Math.ceil((g.plies || 0) / 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {status.games.length > limit && <button type="button" className="text-button import-more" onClick={() => setLimit(limit + 200)}>{t('preview.showMore', { count: status.games.length - limit })}</button>}
        </div>
      )}
      <Failures failed={status.failed} />
      {error && <p className="import-error" role="alert">{error}</p>}
      <div className="import-footer">
        <button type="button" className="button" onClick={onStartOver}>{t('preview.startOver')}</button>
        <button type="button" className="button primary" disabled={busy || selected.size === 0} onClick={commit}>{t('preview.import', { count: selected.size })}</button>
      </div>
    </div>
  );
}

function Failures({ failed }: { failed: Failure[] }) {
  const { t } = useTranslation('import');
  if (!failed.length) return null;
  return (
    <details className="import-failures">
      <summary>{t('preview.unreadable', { count: failed.length })}</summary>
      <ul>
        {failed.map((f, i) => (
          <li key={i}>
            <strong>{f.white && f.black ? `${f.white} – ${f.black}` : f.where ?? `#${i + 1}`}</strong> {f.error}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Summary({ status, onMore }: { status: ImportStatus; onMore: () => void }) {
  const { t } = useTranslation('import');
  const { reloadGames, loadInsights, engineAvailable } = useGameData();
  const { startAnalysis, refreshAnalysis, analysis } = useAnalysis();
  const toast = useToast();
  // The studio starts analyzing new games on its own; refreshing shows that job's progress.
  useEffect(() => { void reloadGames(); loadInsights(true); void refreshAnalysis(); }, [reloadGames, loadInsights, refreshAnalysis]);

  async function analyze() {
    try {
      await startAnalysis();
      toast(t('done.analyzing'));
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="import-panel import-done">
      <img src="art/ui3d/level-complete.webp" alt="" width="72" height="72" />
      <h2>{t('done.added', { count: status.added })}</h2>
      {status.duplicates > 0 && <p className="import-hint">{t('done.duplicates', { count: status.duplicates })}</p>}
      <Failures failed={status.failed} />
      <div className="import-footer">
        {status.added > 0 && engineAvailable && (
          <button type="button" className="button primary" disabled={analysis?.running} onClick={analyze}>
            {analysis?.running ? t('done.running') : t('done.analyze')}
          </button>
        )}
        <Link className="button" to="/games">{t('done.open')}</Link>
        <button type="button" className="button" onClick={onMore}>{t('done.more')}</button>
      </div>
    </div>
  );
}
