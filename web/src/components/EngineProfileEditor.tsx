// An installed engine's config profile in Settings → Engines: saved UCI options (Hash, Threads,
// MultiPV, Skill Level, anything else the engine reports) that apply every time it starts.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import type { EngineInfo, EngineProfile, ProfileValue, UciOption } from '../types';

/** Shown first when the engine has them; the rest are a pick from the "add" list. */
const COMMON = ['Hash', 'Threads', 'MultiPV', 'Skill Level', 'Contempt'];
/** Managed by the app per search (the server refuses them too). */
const MANAGED = new Set(['ponder', 'uci_chess960', 'uci_variant', 'uci_analysemode']);

const editable = (option: UciOption) => option.type !== 'button' && !MANAGED.has(option.name.toLowerCase());

/** An input's text as the option takes it; '' means "the engine's default" and is not saved. */
function parsed(option: UciOption | undefined, text: string): ProfileValue {
  if (option?.type === 'check') return text === 'true';
  if (option?.type === 'spin' || (!option && /^-?\d+$/.test(text))) return Number(text);
  return text;
}

export function EngineProfileEditor({ engine }: { engine: EngineInfo }) {
  const { t } = useTranslation('engineProfile');
  const [profile, setProfile] = useState<EngineProfile | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  function show(loaded: EngineProfile) {
    setProfile(loaded);
    setValues(Object.fromEntries(Object.entries(loaded.options).map(([k, v]) => [k, String(v)])));
    const reported = loaded.reported?.filter(editable).map(o => o.name);
    const common = reported ? COMMON.filter(name => reported.includes(name)) : COMMON.slice(0, 3);
    setShown([...common, ...Object.keys(loaded.options).filter(name => !common.includes(name))]);
  }

  useEffect(() => {
    const controller = new AbortController();
    api<EngineProfile>(`api/engines/profile?engineId=${encodeURIComponent(engine.id)}`, undefined, controller.signal)
      .then(show)
      .catch(problem => { if (!controller.signal.aborted) setError((problem as Error).message); });
    return () => controller.abort();
  }, [engine.id]);

  if (!profile) return error ? <p className="engine-error" role="alert">{error}</p> : <p className="page-status" role="status">{t('loading')}</p>;

  const byName = new Map((profile.reported ?? []).map(option => [option.name, option]));
  const addable = (profile.reported ?? []).filter(option => editable(option) && !shown.includes(option.name));
  const change = (name: string, text: string) => { setValues({ ...values, [name]: text }); setStatus('idle'); };

  async function save(options: Record<string, ProfileValue> | null) {
    setStatus('saving');
    setError(null);
    try {
      if (options === null) {
        await api('api/engines/profile/delete', { engineId: engine.id });
        show({ ...profile!, options: {} });
      } else {
        const saved = await api<{ options: Record<string, ProfileValue> }>('api/engines/profile', { engineId: engine.id, options });
        show({ ...profile!, options: saved.options });
      }
      setStatus('saved');
    } catch (problem) {
      setError((problem as Error).message);
      setStatus('idle');
    }
  }

  const chosen = () => Object.fromEntries(Object.entries(values).filter(([, text]) => text !== '')
    .map(([name, text]) => [name, parsed(byName.get(name), text)]));

  function field(name: string) {
    const option = byName.get(name);
    const text = values[name] ?? '';
    const label = t('valueOf', { name });
    if (option?.type === 'check') {
      return (
        <select aria-label={label} value={text} onChange={e => change(name, e.target.value)}>
          <option value="">{t('default', { value: String(option.default) })}</option>
          <option value="true">{t('on')}</option>
          <option value="false">{t('off')}</option>
        </select>
      );
    }
    if (option?.type === 'combo') {
      return (
        <select aria-label={label} value={text} onChange={e => change(name, e.target.value)}>
          <option value="">{t('default', { value: String(option.default) })}</option>
          {option.var.map(choice => <option key={choice} value={choice}>{choice}</option>)}
        </select>
      );
    }
    return (
      <input aria-label={label} type={option?.type === 'spin' ? 'number' : 'text'} value={text}
        min={option?.min ?? undefined} max={option?.max ?? undefined}
        placeholder={option ? t('default', { value: String(option.default ?? '') }) : t('engineDefault')}
        onChange={e => change(name, e.target.value)} />
    );
  }

  const saved = Object.keys(profile.options).length > 0;
  return (
    <div className="engine-detail engine-profile" role="group" aria-label={t('title')}>
      <h4>{t('title')}</h4>
      <p className="engine-note">{t('note', { engine: engine.name })}</p>
      {!profile.reported && <p className="engine-note">{t('unreported')}</p>}
      <ul className="engine-options">
        {shown.map(name => {
          const option = byName.get(name);
          return (
            <li key={name}>
              <span className="engine-option-name">
                <strong>{name}</strong>
                {option?.type === 'spin' && option.min !== null && option.max !== null
                  ? <small>{t('range', { min: option.min, max: option.max })}</small> : null}
              </span>
              <span className="engine-option-control">{field(name)}</span>
            </li>
          );
        })}
      </ul>
      <div className="engine-fields">
        {addable.length > 0 && (
          <select aria-label={t('add')} value="" onChange={e => { if (e.target.value) setShown([...shown, e.target.value]); }}>
            <option value="">{t('add')}</option>
            {addable.map(option => <option key={option.name} value={option.name}>{option.name}</option>)}
          </select>
        )}
        <button type="button" className="button primary" disabled={status === 'saving'} onClick={() => void save(chosen())}>
          {status === 'saving' ? t('saving') : t('save')}
        </button>
        {saved && <button type="button" className="button" disabled={status === 'saving'} onClick={() => void save(null)}>{t('clear')}</button>}
      </div>
      {status === 'saved' && <p className="engine-note" role="status">{t('saved')}</p>}
      {error && <p className="engine-error" role="alert">{error}</p>}
    </div>
  );
}
