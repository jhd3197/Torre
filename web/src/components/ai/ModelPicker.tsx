// Picking an AI model, the same way everywhere (Settings > AI, the coach's first-run dialog, the
// coach's model menu): search, the providers that are ready (or every one), each provider's
// featured models with their price, the full list a ready cloud provider offers your key, and any
// other "provider/model" typed in.
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { priceText, providerModels, type AiModel, type AiProvider } from '../../lib/ai';

/** What a model costs, in words: its price, "free" on this computer, or "your subscription". */
function costLabel(model: AiModel, provider: AiProvider, t: (key: string, options?: Record<string, unknown>) => string) {
  if (provider.kind === 'local') return t('ai.free');
  if (provider.kind === 'login') return t('ai.subscription');
  const price = priceText(model.cost);
  return price ? t('ai.price', { price }) : null;
}

/** Models shown per provider before "Show N more" (a local server can serve dozens). */
const SHOWN = 8;

const folded = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function ModelPicker({ providers, value, onPick, onConnect, label }: {
  providers: AiProvider[];
  value: string | null;
  onPick: (model: string) => void;
  /** Offered beside a provider that is not ready yet (Settings > AI scrolls to its card). */
  onConnect?: (provider: string) => void;
  label: string;
}) {
  const { t } = useTranslation('settings');
  const [query, setQuery] = useState('');
  const [everyone, setEveryone] = useState(false);
  const [full, setFull] = useState<Record<string, AiModel[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const shown = useMemo(() => {
    const words = folded(query).split(/\s+/).filter(Boolean);
    return providers
      .filter(p => everyone || p.ready || p.models.some(m => m.id === value))
      .map(p => {
        const models = full[p.id] ?? p.models;
        const match = (m: AiModel) => words.every(w => folded(`${m.name} ${m.id} ${p.name}`).includes(w));
        return { provider: p, models: words.length ? models.filter(match) : models };
      })
      .filter(({ provider, models }) => models.length || (!words.length && !provider.ready));
  }, [providers, everyone, full, query, value]);

  async function showAll(provider: AiProvider) {
    setLoading(provider.id);
    setFailed(null);
    try {
      const found = await providerModels(provider.id);
      if (found.error) setFailed(t('ai.keyStale', { name: provider.name }));
      setFull(f => ({ ...f, [provider.id]: found.models }));
    } catch (e) { setFailed((e as Error).message); }
    setLoading(null);
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const model = typed.trim();
    if (/^[^\s/]+\/\S+$/.test(model)) onPick(model);
  };

  const hidden = providers.filter(p => !p.ready).length;
  return (
    <div className="ai-picker" role="group" aria-label={label}>
      <div className="ai-picker-bar">
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('ai.search')} aria-label={t('ai.search')} />
        {hidden > 0 && (
          <label className="ai-picker-all">
            <input type="checkbox" checked={everyone} onChange={e => setEveryone(e.target.checked)} />
            {t('ai.showAll', { count: hidden })}
          </label>
        )}
      </div>
      {shown.length === 0 && <p className="ai-note">{query ? t('ai.noMatch') : t('ai.noneReady')}</p>}
      {shown.map(({ provider, models }) => (
        <section key={provider.id} className={`ai-picker-group${provider.ready ? '' : ' is-off'}`} aria-label={provider.name}>
          <header>
            <h4>{provider.name}</h4>
            <span className={`ai-pill is-${provider.ready ? 'ready' : 'off'}`}>{t(`ai.detail.${provider.detail}`)}</span>
            {!provider.ready && onConnect && (
              <button type="button" className="text-button" onClick={() => onConnect(provider.id)}>{t('ai.connect')}</button>
            )}
          </header>
          {provider.ready && models.length > 0 && (
            <ul>
              {(query || open[provider.id] ? models : models.slice(0, SHOWN).concat(models.slice(SHOWN).filter(m => m.id === value))).map(model => {
                const cost = costLabel(model, provider, t);
                return (
                  <li key={model.id}>
                    <button type="button" className="ai-model-option" aria-pressed={model.id === value} onClick={() => onPick(model.id)}
                      aria-label={[model.name, model.efforts.length ? t('ai.reasons') : null, cost].filter(Boolean).join(', ')} title={model.id}>
                      <span className="ai-model-name">{model.name}</span>
                      <span className="ai-model-id">{model.id}</span>
                      <span className="ai-model-tags">
                        {model.efforts.length > 0 && <span className="ai-tag">{t('ai.reasons')}</span>}
                        {cost && <span className="ai-tag is-cost">{cost}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {provider.ready && !query && !open[provider.id] && models.length > SHOWN && (
            <button type="button" className="text-button" onClick={() => setOpen(o => ({ ...o, [provider.id]: true }))}>
              {t('ai.more', { count: models.length - SHOWN })}
            </button>
          )}
          {provider.ready && provider.kind === 'cloud' && !full[provider.id] && !query && (
            <button type="button" className="text-button" disabled={loading === provider.id} onClick={() => void showAll(provider)}>
              {loading === provider.id ? t('ai.loadingModels') : t('ai.allModels', { name: provider.name })}
            </button>
          )}
        </section>
      ))}
      {failed && <p className="ai-error" role="alert">{failed}</p>}
      <form className="ai-picker-typed" onSubmit={submit}>
        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder={t('ai.typedPlaceholder')} aria-label={t('ai.typed')}
          spellCheck={false} autoComplete="off" />
        <button type="submit" className="button" disabled={!/^[^\s/]+\/\S+$/.test(typed.trim())}>{t('ai.use')}</button>
      </form>
    </div>
  );
}
