// Choosing the AI the coach writes with (coach_ai.py): a provider, the player's own API key for it
// (saved on the server, shown back only as its last characters) and a model from the provider's
// list. Ollama runs on your computer and needs no key; it is not offered where Torre is hosted.
// Used in Settings > AI coach and in the one-time setup dialog (AiSetupDialog).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog';
import { api } from '../lib/api';
import { anchorId } from '../pages/settings/controls';

export interface AiProvider {
  id: string;
  name: string;
  local: boolean;
  key_url: string;
  has_key?: boolean;
  key_hint?: string | null;
  suggested?: string[];
  /** Ollama only: the models it serves. */
  models?: string[];
}

export interface AiView {
  providers: AiProvider[];
  model: string | null;
  auto: boolean;
  setup_seen: boolean;
  hosted: boolean;
}

const providerOf = (model: string | null) => (model ? model.split('/')[0] : null);

export function AiSetup({ onSaved }: { onSaved?: (model: string) => void }) {
  const { t } = useTranslation('settings');
  const [view, setView] = useState<AiView | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    api<AiView>('api/coach/ai').then(data => {
      setView(data);
      const current = providerOf(data.model);
      setChosen(data.providers.some(p => p.id === current) ? current : data.providers[0]?.id ?? null);
    }).catch(e => setError((e as Error).message));
  }, []);

  const provider = view?.providers.find(p => p.id === chosen) ?? null;

  // The chosen provider's models: Ollama's from the view, the others listed for the saved key.
  useEffect(() => {
    if (!provider) return;
    setError(null);
    if (provider.local) { setModels(provider.models ?? []); return; }
    if (!provider.has_key) { setModels([]); return; }
    let live = true;
    api<{ models: string[]; error?: string }>('api/coach/ai/models', { provider: provider.id }).then(data => {
      if (!live) return;
      setModels(data.models);
      if (data.error) setError(t('ai.keyStale', { name: provider.name }));
    }).catch(e => live && setError((e as Error).message));
    return () => { live = false; };
  }, [provider, t]);

  // Keep the current model selected when it is in the list, else the first one.
  useEffect(() => {
    const current = view?.model && providerOf(view.model) === chosen ? view.model.slice(chosen!.length + 1) : null;
    setModel(current && models.includes(current) ? current : models[0] ?? '');
  }, [models, view, chosen]);

  const saveKey = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (!provider || !key.trim()) return;
    setBusy(true); setError(null);
    try {
      setView(await api<AiView>('api/coach/ai/key', { provider: provider.id, key: key.trim() }));
      setKey('');
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }, [provider, key]);

  const forgetKey = async () => {
    if (!provider) return;
    setBusy(true); setError(null);
    try { setView(await api<AiView>('api/coach/ai/key', { provider: provider.id, key: '' })); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  const use = async () => {
    if (!provider || !model) return;
    const full = `${provider.id}/${model}`;
    setBusy(true); setError(null);
    try {
      await api('api/coach/model', { model: full });
      setView(v => (v ? { ...v, model: full, auto: false } : v));
      setSaved(full);
      onSaved?.(full);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  if (!view) return <p className="ai-setup-note" role={error ? 'alert' : 'status'}>{error ?? t('ai.loading')}</p>;

  return (
    <div className="ai-setup">
      <div id={anchorId('ai.provider')} className="ai-setup-step">
        <h3>{t('ai.provider')}</h3>
        <p className="ai-setup-note">{t(view.hosted ? 'ai.providerNoteHosted' : 'ai.providerNote')}</p>
        <div className="ai-providers" role="radiogroup" aria-label={t('ai.provider')}>
          {view.providers.map(p => (
            <button key={p.id} type="button" role="radio" aria-checked={p.id === chosen}
              className={`ai-provider${p.id === chosen ? ' is-chosen' : ''}`} onClick={() => setChosen(p.id)}>
              <span className="ai-provider-name">{p.name}</span>
              <span className="ai-provider-state">
                {p.local ? t('ai.onThisComputer') : p.has_key ? t('ai.keySavedShort') : t('ai.needsKey')}
              </span>
            </button>
          ))}
        </div>
      </div>

      {provider && !provider.local && (
        <div id={anchorId('ai.key')} className="ai-setup-step">
          <h3>{t('ai.key')}</h3>
          {provider.has_key ? (
            <p className="ai-setup-note">
              {t('ai.keySaved', { name: provider.name, hint: provider.key_hint })}{' '}
              <button type="button" className="text-button" disabled={busy} onClick={forgetKey}>{t('ai.removeKey')}</button>
            </p>
          ) : (
            <form className="ai-key" onSubmit={saveKey}>
              <input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" spellCheck={false}
                aria-label={t('ai.keyFor', { name: provider.name })} placeholder={t('ai.keyPlaceholder')} />
              <button type="submit" className="button" disabled={busy || !key.trim()}>{busy ? t('ai.checking') : t('ai.saveKey')}</button>
            </form>
          )}
          <p className="ai-setup-note">
            {t('ai.keyNote')}{' '}
            <a href={provider.key_url} target="_blank" rel="noreferrer">{t('ai.getKey', { name: provider.name })}</a>
          </p>
        </div>
      )}

      {provider && (
        <div id={anchorId('ai.model')} className="ai-setup-step">
          <h3>{t('ai.model')}</h3>
          {models.length ? (
            <div className="ai-model">
              <select value={model} onChange={e => setModel(e.target.value)} aria-label={t('ai.model')}>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <button type="button" className="button primary" disabled={busy || !model} onClick={use}>{t('ai.use')}</button>
            </div>
          ) : (
            <p className="ai-setup-note">{provider.local ? t('ai.ollamaMissing') : t('ai.modelsAfterKey')}</p>
          )}
        </div>
      )}

      {(saved ?? view.model) && (
        <p className="ai-setup-current" role="status">
          {saved ? t('ai.saved', { model: saved }) : view.auto ? t('ai.currentAuto', { model: view.model }) : t('ai.current', { model: view.model })}
        </p>
      )}
      {error && <p className="ai-setup-error" role="alert">{error}</p>}
    </div>
  );
}

/** The setup in a dialog: shown once on its own when the coach has no model, and from "Set up the AI coach". */
export function AiSetupDialog({ open, onClose }: { open: boolean; onClose: (saved: boolean) => void }) {
  const { t } = useTranslation('settings');
  const [saved, setSaved] = useState(false);
  return (
    <Dialog id="ai-setup" open={open} onClose={() => onClose(saved)}>
      <div className="ai-setup-dialog">
        <h2>{t('ai.dialogTitle')}</h2>
        <p className="ai-setup-note">{t('ai.dialogText')}</p>
        <AiSetup onSaved={() => setSaved(true)} />
        <div className="ai-setup-actions">
          <button type="button" className={saved ? 'button primary' : 'text-button'} onClick={() => onClose(saved)}>
            {saved ? t('ai.done') : t('ai.later')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
