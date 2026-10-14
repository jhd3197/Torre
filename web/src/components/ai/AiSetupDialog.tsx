// The coach's one-time setup (shown when no model is set, and from "Set up AI"): pick a model from
// what is ready on this computer and in your accounts, or go to Settings > AI to connect more.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Dialog } from '../Dialog';
import { loadAi, modelName, resetAiStatus, saveAiSettings, type AiView } from '../../lib/ai';
import { ModelPicker } from './ModelPicker';

export function AiSetupDialog({ open, onClose }: { open: boolean; onClose: (saved: boolean) => void }) {
  const { t } = useTranslation('settings');
  const [view, setView] = useState<AiView | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open && !view) loadAi().then(setView, e => setError((e as Error).message));
  }, [open, view]);

  async function pick(model: string) {
    setError(null);
    try {
      setView(await saveAiSettings({ model }));
      resetAiStatus();
      setSaved(model);
    } catch (e) { setError((e as Error).message); }
  }

  const ready = view?.providers.some(p => p.ready);
  return (
    <Dialog id="ai-setup" open={open} onClose={() => onClose(!!saved)}>
      <div className="ai-setup-dialog">
        <h2>{t('ai.dialogTitle')}</h2>
        <p className="ai-note">{t('ai.dialogText')}</p>
        {!view && <p className="ai-note" role={error ? 'alert' : 'status'}>{error ?? t('ai.loading')}</p>}
        {view && (view.prompture.installed && ready
          ? <ModelPicker providers={view.providers} value={saved ?? view.settings.model} label={t('ai.default')} onPick={m => void pick(m)} />
          : <p className="ai-note">{view.prompture.installed ? t('ai.noneReady') : t('ai.promptureNote')}</p>)}
        {saved && <p className="ai-test-ok" role="status">{t('ai.saved', { model: modelName(saved, view?.models) })}</p>}
        {error && view && <p className="ai-error" role="alert">{error}</p>}
        <div className="ai-setup-actions">
          <Link className="text-button" to="/settings/ai" onClick={() => onClose(!!saved)}>{t('ai.moreSettings')}</Link>
          <button type="button" className={saved ? 'button primary' : 'text-button'} onClick={() => onClose(!!saved)}>
            {saved ? t('ai.done') : t('ai.later')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
