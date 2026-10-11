// The coach's voice packs: one per language, downloaded from the app's release on request.
// Used by the welcome screen and by Settings; polls the server while a download runs.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { usePoll } from '../hooks/usePoll';
import { resetVoicePacks } from '../lib/voice';
import { Flag } from './Flag';

export interface VoicePack {
  id: string; lang: string; title: string; bytes: number; lines: number; version: string;
  installed: boolean; current: boolean;
}
interface PackJob { running: boolean; id: string | null; done: number; total: number; error: string | null }
interface PacksState { packs: VoicePack[]; job: PackJob }

/** Fast enough for the download's progress bar to move smoothly. */
const PACK_POLL_MS = 500;

export function usePacks() {
  const [state, setState] = useState<PacksState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<PacksState>('api/packs').then(setState).catch(e => setError((e as Error).message)), []);
  useEffect(() => { void load(); }, [load]);
  const running = !!state?.job.running;
  const { schedule, cancel, signal } = usePoll();
  // While a pack downloads, follow its progress (through a failed check too); when it lands, forget the cached manifests.
  const follow = useCallback(async () => {
    const live = signal();
    const next = await api<PacksState>('api/packs', undefined, live).catch(() => null);
    if (live.aborted) return;
    if (next) setState(next);
    if (!next || next.job.running) schedule(follow, PACK_POLL_MS);
    else resetVoicePacks();
  }, [schedule, signal]);
  useEffect(() => {
    if (running) schedule(follow, PACK_POLL_MS);
    else cancel();
  }, [running, follow, schedule, cancel]);
  const act = (path: string, id?: string) => api<PacksState>(path, id ? { id } : {})
    .then(next => { setState(next); setError(null); resetVoicePacks(); })
    .catch(e => setError((e as Error).message));
  return {
    state, error,
    install: (id: string) => act('api/packs/install', id),
    remove: (id: string) => act('api/packs/remove', id),
    cancel: () => act('api/packs/cancel'),
  };
}

const megabytes = (bytes: number) => Math.max(1, Math.round(bytes / 1e6));

/** One row per pack (or only `lang`'s), with download, progress and remove. */
export function VoicePackList({ lang, packs }: { lang?: string; packs: ReturnType<typeof usePacks> }) {
  const { t } = useTranslation('settings');
  const { state, error } = packs;
  if (!state) return error ? <p className="voice-pack-note">{t('voice.offline')}</p> : null;
  const shown = state.packs.filter(pack => !lang || pack.lang === lang);
  if (!shown.length) return <p className="voice-pack-note">{t('voice.none')}</p>;
  const job = state.job;
  return (
    <ul className="voice-packs">
      {shown.map(pack => {
        const downloading = job.running && job.id === pack.id;
        const share = downloading && job.total ? Math.min(1, job.done / job.total) : 0;
        return (
          <li key={pack.id} className={`voice-pack${pack.installed ? ' installed' : ''}`}>
            <Flag lang={pack.lang} size={30} />
            <div className="voice-pack-info">
              <strong>{pack.title}</strong>
              <small>{t('voice.size', { mb: megabytes(pack.bytes), count: pack.lines })}</small>
              {downloading && (
                <span className="voice-pack-bar" role="progressbar" aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}
                  aria-label={t('voice.downloading')}><i style={{ width: `${share * 100}%` }} /></span>
              )}
              {job.error && job.id === pack.id && !job.running && <span className="voice-pack-error" role="alert">{job.error}</span>}
            </div>
            {downloading
              ? <button type="button" className="button" onClick={() => void packs.cancel()}>{t('voice.cancel')}</button>
              : pack.installed && pack.current
                ? <span className="voice-pack-actions">
                    <span className="voice-pack-done">{t('voice.installed')}</span>
                    <button type="button" className="text-button" onClick={() => void packs.remove(pack.id)}>{t('voice.remove')}</button>
                  </span>
                : <button type="button" className="button primary" disabled={job.running} onClick={() => void packs.install(pack.id)}>
                    {pack.installed ? t('voice.update') : t('voice.download')}
                  </button>}
          </li>
        );
      })}
      {error && <li className="voice-pack-error" role="alert">{error}</li>}
    </ul>
  );
}
