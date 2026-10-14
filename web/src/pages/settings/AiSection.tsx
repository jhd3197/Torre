// Settings > AI: everything Torre's AI runs on, in one place (torre/ai, /api/ai).
// - What it runs on: Prompture (installed from here when missing), Prompture Desk, and the model
//   servers on this computer.
// - Which model Torre uses: one default for everything, and optionally another for the coach's
//   advice or for explanations and reviews. Each can be tested with one short question.
// - The providers: the Claude Code and Codex logins, Ollama and LM Studio, and the cloud services,
//   each with its state; a cloud key is pasted, checked and saved right on its card.
// - What the models have cost, across every Prompture app on this computer.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import {
  AI_FEATURES, loadAi, modelName, resetAiStatus, saveAiKey, saveAiSettings, testAiModel,
  type AiFeature, type AiProvider, type AiProviderKind, type AiTest, type AiUsage, type AiView,
} from '../../lib/ai';
import { ModelPicker } from '../../components/ai/ModelPicker';
import { usePoll } from '../../hooks/usePoll';
import { anchorId, Subheading } from './controls';

const INSTALL_POLL_MS = 2500;
const KINDS: AiProviderKind[] = ['login', 'local', 'cloud'];
const providerAnchor = (id: string) => `ai-provider-${id}`;

export function AiSection() {
  const { t } = useTranslation('settings');
  const [view, setView] = useState<AiView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { schedule, cancel } = usePoll();

  const load = useCallback(async () => {
    try {
      const next = await loadAi();
      setView(next);
      setError(null);
      if (next.prompture.install.running) schedule(load, INSTALL_POLL_MS);
    } catch (e) { setError((e as Error).message); }
  }, [schedule]);
  useEffect(() => { void load(); return cancel; }, [load, cancel]);

  /** Apply a change that answers with the new view; the features' cached status is stale after it. */
  const change = useCallback(async (request: Promise<AiView>) => {
    setError(null);
    try {
      const next = await request;
      setView(next);
      resetAiStatus();
      return next;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  if (!view) return <p className="ai-note" role={error ? 'alert' : 'status'}>{error ?? t('ai.loading')}</p>;

  const connect = (provider: string) => document.getElementById(providerAnchor(provider))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return (
    <div className="ai-settings">
      <Runtime view={view} onInstall={() => void change(api<AiView>('api/ai/install', {})).then(() => schedule(load, INSTALL_POLL_MS))} />
      {error && <p className="ai-error" role="alert">{error}</p>}
      {view.prompture.installed && <>
        <Subheading id={anchorId('ai.default')}>{t('ai.models')}</Subheading>
        <ModelRow view={view} label={t('ai.default')} note={t('ai.defaultNote')} model={view.model} source={view.source}
          onPick={model => change(saveAiSettings({ model }))} onClear={view.settings.model ? () => change(saveAiSettings({ model: null })) : undefined}
          clearLabel={t('ai.automatic')} onConnect={connect} />
        {AI_FEATURES.map(feature => <FeatureRow key={feature} feature={feature} view={view} change={change} onConnect={connect} />)}

        {KINDS.map(kind => {
          const list = view.providers.filter(p => p.kind === kind);
          if (!list.length) return null;
          return (
            <section key={kind} className="ai-kind" aria-labelledby={`ai-kind-${kind}`}>
              <Subheading id={kind === 'cloud' ? anchorId('ai.providers') : `ai-kind-${kind}`}>
                <span id={`ai-kind-${kind}`}>{t(`ai.kinds.${kind}`)}</span>
              </Subheading>
              <p className="ai-note">{t(`ai.kindNotes.${kind}`)}</p>
              <div className="ai-providers">
                {list.map(p => <ProviderCard key={p.id} provider={p} hosted={view.hosted} onKey={(key) => change(saveAiKey(p.id, key))} />)}
              </div>
            </section>
          );
        })}
        <Usage />
      </>}
    </div>
  );
}

/** Prompture's version (or an install button), Prompture Desk, and the servers on this computer. */
function Runtime({ view, onInstall }: { view: AiView; onInstall: () => void }) {
  const { t } = useTranslation('settings');
  const { installed, version, install } = view.prompture;
  if (!installed) {
    return (
      <div id={anchorId('ai.prompture')} className="ai-install">
        <h3>{t('ai.prompture')}</h3>
        <p className="ai-note">{t('ai.promptureNote')}</p>
        {install.running
          ? <p className="ai-note" role="status">{t('ai.installing')}</p>
          : <button type="button" className="button primary" onClick={onInstall}>{t('ai.install')}</button>}
        {install.error && !install.running && <p className="ai-error" role="alert">{t('ai.installFailed', { error: install.error })}</p>}
      </div>
    );
  }
  const local = view.providers.filter(p => p.kind === 'local');
  return (
    <ul id={anchorId('ai.prompture')} className="ai-runtime" aria-label={t('ai.runtime')}>
      <li className="ai-pill is-ready" title={version ?? undefined}>{t('ai.promptureVersion', { version: version?.split('+')[0] })}</li>
      {!view.hosted && (
        <li className={`ai-pill is-${view.desk.running ? 'ready' : 'off'}`} title={t('ai.deskNote')}>
          {view.desk.running ? t('ai.deskOpen') : t('ai.deskClosed')}
        </li>
      )}
      {local.map(p => (
        <li key={p.id} className={`ai-pill is-${p.ready ? 'ready' : 'off'}`}>
          {p.ready ? t('ai.serverRunning', { name: p.name, count: p.models.length }) : t('ai.serverOff', { name: p.name })}
        </li>
      ))}
    </ul>
  );
}

/** A model in use: its name and where it came from, a way to change it, and a one-question test. */
function ModelRow({ view, label, note, model, source, onPick, onClear, clearLabel, onConnect, id, follows }: {
  view: AiView; label: string; note: string; model: string | null; source: AiView['source'];
  /** A feature with no model of its own: it uses whatever the default is. */
  follows?: boolean;
  onPick: (model: string) => Promise<unknown>; onClear?: () => Promise<unknown>; clearLabel: string;
  onConnect: (provider: string) => void; id?: string;
}) {
  const { t } = useTranslation('settings');
  const [picking, setPicking] = useState(false);
  const [test, setTest] = useState<AiTest | 'running' | null>(null);
  useEffect(() => { setTest(null); }, [model]);
  const known = view.models[model ?? ''];
  const provider = model ? view.providers.find(p => p.id === model.split('/')[0]) : undefined;

  async function runTest() {
    if (!model) return;
    setTest('running');
    try { setTest(await testAiModel(model)); } catch (e) { setTest({ ok: false, seconds: 0, error: (e as Error).message }); }
  }

  return (
    <div id={id} className="ai-model-row">
      <div className="ai-model-row-main">
        <span className="settings-row-text"><strong>{label}</strong><small>{note}</small></span>
        <div className="ai-current">
          {model ? <>
            <strong>{modelName(model, view.models)}</strong>
            <small>{provider?.name ?? model.split('/')[0]} · {follows ? t('ai.sameAsDefault') : t(`ai.source.${source ?? 'none'}`)}{known?.efforts.length ? ` · ${t('ai.reasons')}` : ''}</small>
          </> : <strong className="is-none">{t('ai.noModel')}</strong>}
        </div>
        <div className="ai-actions">
          <button type="button" className="button" aria-expanded={picking} onClick={() => setPicking(p => !p)}>{t('ai.change')}</button>
          {model && <button type="button" className="button" disabled={test === 'running'} onClick={() => void runTest()}>
            {test === 'running' ? t('ai.testing') : t('ai.test')}
          </button>}
          {onClear && <button type="button" className="text-button" onClick={() => void onClear()}>{clearLabel}</button>}
        </div>
      </div>
      {test && test !== 'running' && (
        <p className={test.ok ? 'ai-test-ok' : 'ai-error'} role="status">
          {test.ok ? t('ai.testOk', { seconds: test.seconds, reply: test.reply }) : t('ai.testFailed', { error: test.error })}
        </p>
      )}
      {picking && (
        <ModelPicker providers={view.providers} value={model} label={t('ai.pickFor', { what: label })} onConnect={onConnect}
          onPick={chosen => { setPicking(false); void onPick(chosen); }} />
      )}
    </div>
  );
}

/** A feature's model: the default, or one of its own. */
function FeatureRow({ feature, view, change, onConnect }: {
  feature: AiFeature; view: AiView; change: (request: Promise<AiView>) => Promise<AiView | null>; onConnect: (provider: string) => void;
}) {
  const { t } = useTranslation('settings');
  const own = view.settings.features[feature];
  const current = view.features[feature];
  return (
    <ModelRow id={anchorId(`ai.feature.${feature}`)} view={view} label={t(`ai.feature.${feature}`)} note={t(`ai.feature.${feature}Note`)}
      model={current.model} source={current.source} follows={!own} clearLabel={t('ai.useDefault')} onConnect={onConnect}
      onPick={model => change(saveAiSettings({ features: { [feature]: model } }))}
      onClear={own ? () => change(saveAiSettings({ features: { [feature]: null } })) : undefined} />
  );
}

/** One provider: its state, what to do next, and for the cloud its key. */
function ProviderCard({ provider, hosted, onKey }: { provider: AiProvider; hosted: boolean; onKey: (key: string) => Promise<AiView | null> }) {
  const { t } = useTranslation('settings');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [checked, setChecked] = useState<AiView['check']>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    const next = await onKey(key.trim());
    setBusy(false);
    if (next) { setKey(''); setEditing(false); setChecked(next.check ?? null); }
  }

  async function remove() {
    setBusy(true);
    await onKey('');
    setBusy(false);
    setChecked(null);
  }

  const askKey = provider.kind === 'cloud' && (!provider.key || editing);
  return (
    <article id={providerAnchor(provider.id)} className={`ai-provider-card${provider.ready ? ' is-ready' : ''}`} aria-label={provider.name}>
      <header>
        <h4>{provider.name}</h4>
        <span className={`ai-pill is-${provider.ready ? 'ready' : 'off'}`}>{t(`ai.detail.${provider.detail}`)}</span>
      </header>
      {provider.ready && provider.kind !== 'cloud' && (
        <p className="ai-note">{t(`ai.readyNotes.${provider.kind}`, { count: provider.models.length })}</p>
      )}
      {!provider.ready && provider.kind !== 'cloud' && (
        <p className="ai-note">
          {t(`ai.offNotes.${provider.detail}`, { name: provider.name })}{' '}
          {provider.url && <a href={provider.url} target="_blank" rel="noreferrer">{t('ai.howTo', { name: provider.name })}</a>}
        </p>
      )}
      {provider.kind === 'cloud' && provider.key && !editing && (
        <p className="ai-note">
          {provider.key.source === 'environment'
            ? t('ai.keyFromEnvironment', { hint: provider.key.hint })
            : t(hosted ? 'ai.keySavedHosted' : 'ai.keySaved', { hint: provider.key.hint })}
          {checked === 'unverified' && ` ${t('ai.keyUnverified')}`}
          {provider.key.source === 'saved' && <>
            {' '}<button type="button" className="text-button" disabled={busy} onClick={() => setEditing(true)}>{t('ai.replaceKey')}</button>
            {' '}<button type="button" className="text-button" disabled={busy} onClick={() => void remove()}>{t('ai.removeKey')}</button>
          </>}
        </p>
      )}
      {askKey && (
        <>
          <form className="ai-key" onSubmit={save}>
            <input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" spellCheck={false}
              aria-label={t('ai.keyFor', { name: provider.name })} placeholder={t('ai.keyPlaceholder')} />
            <button type="submit" className="button" disabled={busy || !key.trim()}>{busy ? t('ai.checking') : t('ai.saveKey')}</button>
            {editing && <button type="button" className="text-button" onClick={() => setEditing(false)}>{t('ai.cancel')}</button>}
          </form>
          <p className="ai-note">
            {t(hosted ? 'ai.keyNoteHosted' : 'ai.keyNote')}{' '}
            {provider.url && <a href={provider.url} target="_blank" rel="noreferrer">{t('ai.getKey', { name: provider.name })}</a>}
          </p>
        </>
      )}
    </article>
  );
}

/** What the models have cost through Prompture on this computer, by any app. */
function Usage() {
  const { t } = useTranslation('settings');
  const [rows, setRows] = useState<AiUsage[] | null>(null);
  useEffect(() => {
    let live = true;
    api<{ usage: AiUsage[] }>('api/ai/usage').then(data => { if (live) setRows(data.usage); }, () => { if (live) setRows([]); });
    return () => { live = false; };
  }, []);
  if (!rows?.length) return null;
  return (
    <section className="ai-usage" aria-labelledby={anchorId('ai.usage')}>
      <Subheading id={anchorId('ai.usage')}>{t('ai.usage')}</Subheading>
      <p className="ai-note">{t('ai.usageNote')}</p>
      <table>
        <thead><tr><th scope="col">{t('ai.usageModel')}</th><th scope="col">{t('ai.usageCalls')}</th><th scope="col">{t('ai.usageTokens')}</th><th scope="col">{t('ai.usageCost')}</th></tr></thead>
        <tbody>{rows.map(row => (
          <tr key={row.model}>
            <th scope="row">{row.model}</th>
            <td>{row.calls.toLocaleString()}</td>
            <td>{row.tokens.toLocaleString()}</td>
            <td>{row.cost ? `$${row.cost.toFixed(row.cost < 1 ? 3 : 2)}` : '$0'}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}
