// Settings → Engines (what was the Engine Lab): the engine behind analysis, installed and available
// engines, Maia models, each engine's config profile, and engines you add by path.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EngineProfileEditor } from './EngineProfileEditor';
import { botForEngine, engineFigure } from '../data/bots';
import { usePoll } from '../hooks/usePoll';
import { api } from '../lib/api';
import { analysisEngine } from '../lib/settings';
import { useGameData } from '../state/AppData';
import type { EngineInfo, EngineInstallStatus, EngineModel } from '../types';

/** Which catalog download matches this machine (the server does the real picking). */
function thisPlatform(): 'windows' | 'linux' | 'macos' {
  const agent = navigator.userAgent;
  return agent.includes('Windows') ? 'windows' : agent.includes('Mac') ? 'macos' : 'linux';
}

/** A download's progress bar moves at this pace; the first check comes sooner, to show the job started. */
const INSTALL_POLL_MS = 1000;
const INSTALL_FIRST_POLL_MS = 500;
const IDLE: EngineInstallStatus = { running: false, engine_id: null, model_id: null, phase: null, downloaded: 0, total: 0, error: null };

/** Which installed engine analyzes (Settings → Analysis); shown once there is more than one to choose from. */
export function AnalysisEngineChoice() {
  const { t } = useTranslation('engines');
  const { engines } = useGameData();
  const chosen = analysisEngine.use();
  const installed = engines.filter(engine => engine.installed);
  if (installed.length < 2) return null;
  // An uninstalled choice falls back to Stockfish where it is used; show that here too.
  const analysisId = installed.some(engine => engine.id === chosen) ? chosen : 'stockfish';
  return (
    <div className="settings-row">
      <span className="settings-row-text"><strong>{t('analysis.title')}</strong><small>{t('analysis.note')}</small></span>
      <select className="settings-select" aria-label={t('analysis.title')} value={analysisId}
        onChange={e => analysisEngine.set(e.target.value)}>
        {installed.map(engine => <option key={engine.id} value={engine.id}>{engine.name}</option>)}
      </select>
    </div>
  );
}

export function EngineSettings() {
  const { t } = useTranslation('engines');
  const { engines, enginesLoaded, refreshEngines } = useGameData();
  const [openId, setOpenId] = useState<string | null>(null);
  const [install, setInstall] = useState<EngineInstallStatus>(IDLE);
  const wasRunning = useRef(false);
  const { schedule, cancel, signal } = usePoll();

  // Poll the install job while it runs; when it finishes, the registry changed.
  const refreshInstall = useCallback(async () => {
    cancel();
    const live = signal();
    let status: EngineInstallStatus | null = null;
    try { status = await api<EngineInstallStatus>('api/engines/install', undefined, live); } catch { /* keep the last known state */ }
    if (!status || live.aborted) return;
    setInstall(status);
    if (status.running) {
      wasRunning.current = true;
      schedule(refreshInstall, INSTALL_POLL_MS);
    } else if (wasRunning.current) {
      wasRunning.current = false;
      if (!status.error) void refreshEngines();
    }
  }, [refreshEngines, cancel, schedule, signal]);

  useEffect(() => { void refreshInstall(); }, [refreshInstall]);

  async function begin(path: string, body: { engineId: string; modelId?: string }) {
    setInstall({ ...IDLE, running: true, engine_id: body.engineId, model_id: body.modelId ?? null, phase: 'download' });
    try {
      setInstall(await api<EngineInstallStatus>(path, body));
    } catch (error) {
      setInstall({ ...IDLE, engine_id: body.engineId, model_id: body.modelId ?? null, error: (error as Error).message });
      return;
    }
    wasRunning.current = true;
    schedule(refreshInstall, INSTALL_FIRST_POLL_MS);
  }

  if (!enginesLoaded) return <p className="page-status" role="status">{t('loading')}</p>;

  const groups: [string, EngineInfo[]][] = [
    ['installed', engines.filter(engine => engine.installed && !engine.custom)],
    ['available', engines.filter(engine => !engine.installed && !engine.custom)],
    ['custom', engines.filter(engine => engine.custom)],
  ];

  return (
    <>
      {groups.map(([key, list]) => (
        <section className="engines-group" key={key} aria-labelledby={`engines-${key}`}>
          <div className="engines-group-heading"><h3 id={`engines-${key}`}>{t(`sections.${key}`)}</h3><span>{t(`notes.${key}`)}</span></div>
          {key === 'custom' && <CustomEngineForm onAdded={refreshEngines} />}
          {key === 'installed' && !list.length ? <p className="engines-empty">{t('empty.installed')}</p> : list.map(engine => (
            <EngineRow key={engine.id} engine={engine} open={openId === engine.id}
              onToggle={() => setOpenId(openId === engine.id ? null : engine.id)}
              install={install.engine_id === engine.id ? install : null} installing={install.running}
              onInstall={() => void begin('api/engines/install', { engineId: engine.id })}
              onModelInstall={modelId => void begin('api/engines/models/install', { engineId: engine.id, modelId })}
              onChanged={refreshEngines} />
          ))}
        </section>
      ))}
    </>
  );
}

function EngineRow({ engine, open, onToggle, install, installing, onInstall, onModelInstall, onChanged }: {
  engine: EngineInfo; open: boolean; onToggle: () => void;
  install: EngineInstallStatus | null; installing: boolean;
  onInstall: () => void; onModelInstall: (modelId: string) => void; onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation('engines');
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const downloadable = !!engine.download?.[thisPlatform()];

  async function remove(path: string) {
    setConfirming(false);
    setActionError(null);
    try {
      await api(path, { engineId: engine.id });
      await onChanged();
    } catch (error) { setActionError((error as Error).message); }
  }

  const percent = install && install.total ? Math.round(install.downloaded / install.total * 100) : null;
  const rowError = install && !install.model_id ? install.error : null;
  const play = <button type="button" className="button primary" onClick={() => navigate(`/play/bots/engines?bot=${botForEngine(engine)}`)}>{t('card.play')}</button>;
  const confirm = (label: string, path: string) => <>
    <button type="button" className="button danger" onClick={() => void remove(path)}>{label}</button>
    <button type="button" className="button" onClick={() => setConfirming(false)}>{t('card.cancel')}</button>
  </>;

  return (
    <article className={`engine-row${open ? ' open' : ''}`}>
      <div className="engine-row-main">
        <img className="engine-figure" src={engineFigure(engine.id)} alt="" />
        <button type="button" className="engine-row-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="engine-row-title">
            <strong>{engine.name}</strong>
            <span className={`engine-type engine-type-${engine.type}`}>{t(`types.${engine.type}`, { defaultValue: engine.type })}</span>
            {engine.strength_ccrl ? <span className="engine-rating" title={t('card.strength', { rating: engine.strength_ccrl })}>{engine.strength_ccrl}</span> : null}
          </span>
          <small>{engine.description}</small>
        </button>
        <span className="engine-row-actions">
          {engine.custom ? (
            confirming ? confirm(t('card.confirmRemove'), 'api/engines/custom/delete')
              : <>{play}<button type="button" className="button" onClick={() => setConfirming(true)}>{t('card.remove')}</button></>
          ) : engine.installed ? <>
            {play}
            {engine.id !== 'stockfish' && (confirming ? confirm(t('card.confirmUninstall'), 'api/engines/uninstall')
              : <button type="button" className="button" onClick={() => setConfirming(true)}>{t('card.uninstall')}</button>)}
          </> : downloadable ? (
            <button type="button" className="button primary" disabled={installing} onClick={onInstall}>{t('card.install')}</button>
          ) : (
            <button type="button" className="button" disabled title={t('card.addByPathTitle')}>{t('card.addByPath')}</button>
          )}
        </span>
      </div>
      {install?.running && !install.model_id && (
        <div className="engine-progress" role="status">
          <i><b style={{ width: `${percent ?? 15}%` }} /></i>
          <span>{install.phase === 'download' && percent !== null ? t('card.downloading', { percent }) : t(`card.phases.${install.phase ?? 'download'}`)}</span>
        </div>
      )}
      {(rowError || actionError) && <p className="engine-error" role="alert">{rowError ?? actionError}</p>}
      {open && (
        <div className="engine-more">
          <EngineDetail engine={engine} install={install?.model_id ? install : null} installing={installing}
            onModelInstall={onModelInstall} onChanged={onChanged} />
          {engine.installed && <EngineProfileEditor engine={engine} />}
        </div>
      )}
    </article>
  );
}

function CustomEngineForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const { t } = useTranslation('engines');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api('api/engines/custom', { name, path });
      setName('');
      setPath('');
      await onAdded();
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="engine-custom-form" onSubmit={e => { e.preventDefault(); void add(); }}>
      <p className="engine-note">{t('form.note')}</p>
      <div className="engine-fields">
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('form.name')} aria-label={t('form.name')} required />
        <input type="text" value={path} onChange={e => setPath(e.target.value)} placeholder={t('form.path')} aria-label={t('form.path')} required />
        <button type="submit" className="button primary" disabled={busy || !name.trim() || !path.trim()}>{busy ? t('form.adding') : t('form.add')}</button>
      </div>
      {error && <p className="engine-error" role="alert">{error}</p>}
    </form>
  );
}

function EngineDetail({ engine, install, installing, onModelInstall, onChanged }: {
  engine: EngineInfo; install: EngineInstallStatus | null; installing: boolean;
  onModelInstall: (modelId: string) => void; onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation('engines');
  const capability = (on: boolean, label: string) => (
    <li key={label} className={on ? 'on' : 'off'}><span>{label}</span><b>{on ? t('detail.yes') : t('detail.no')}</b></li>
  );
  const download = engine.download?.[thisPlatform()];
  return (
    <div className="engine-detail">
      <ul className="engine-facts">
        <li><span>{t('detail.ccrl')}</span><b>{engine.strength_ccrl ?? '–'}</b></li>
        <li><span>{t('detail.version')}</span><b>{engine.version ?? t('detail.unknownVersion')}</b></li>
        {download?.cpu && <li><span>{t('detail.needs')}</span><b>{download.cpu}</b></li>}
        {download?.size ? <li><span>{t('detail.downloadSize')}</span><b>{t('detail.megabytes', { size: Math.round(download.size / 1048576) })}</b></li> : null}
        {engine.license && <li><span>{t('detail.license')}</span><b>{engine.license}</b></li>}
      </ul>
      <h4>{t('detail.capabilities')}</h4>
      <ul className="engine-facts">
        {capability(engine.capabilities.limit_strength, t('detail.limitStrength'))}
        {capability(engine.capabilities.skill_level, t('detail.skillLevel'))}
        {capability(engine.capabilities.multipv, t('detail.multipv'))}
      </ul>
      {engine.repo_url && <a className="engine-repo" href={engine.repo_url} target="_blank" rel="noreferrer">{t('card.source')}</a>}
      {engine.models.length > 0 && (
        <>
          <h4>{t('detail.models')}</h4>
          <ul className="engine-options">
            {engine.models.map(model => (
              <ModelRow key={model.id} engine={engine} model={model}
                status={install?.model_id === model.id ? install : null} busy={installing}
                onInstall={() => onModelInstall(model.id)} onChanged={onChanged} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ModelRow({ engine, model, status, busy, onInstall, onChanged }: {
  engine: EngineInfo; model: EngineModel; status: EngineInstallStatus | null; busy: boolean;
  onInstall: () => void; onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation('engines');
  const [confirming, setConfirming] = useState(false);
  const percent = status && status.total ? Math.round(status.downloaded / status.total * 100) : null;

  async function uninstall() {
    setConfirming(false);
    try {
      await api('api/engines/models/uninstall', { engineId: engine.id, modelId: model.id });
      await onChanged();
    } catch { /* the row keeps its state; a retry is a click away */ }
  }

  return (
    <li>
      <span className="engine-option-name">
        <strong>{model.name}</strong>
        {model.rating_target ? <small>{t('detail.ratingTarget', { rating: model.rating_target })}</small> : null}
      </span>
      <span className="engine-option-control">
        {status?.running ? (
          <small>{status.phase === 'download' && percent !== null ? t('card.downloading', { percent }) : t(`card.phases.${status.phase ?? 'download'}`)}</small>
        ) : status?.error ? (
          <small className="engine-error-inline" role="alert">{status.error}</small>
        ) : model.installed ? (
          confirming ? <>
            <button type="button" className="button danger" onClick={() => void uninstall()}>{t('card.confirmUninstall')}</button>
            <button type="button" className="button" onClick={() => setConfirming(false)}>{t('card.cancel')}</button>
          </> : <>
            <small className="engine-model-installed">{t('detail.modelInstalled')}</small>
            <button type="button" className="button" onClick={() => setConfirming(true)}>{t('card.uninstall')}</button>
          </>
        ) : (
          <button type="button" className="button primary" disabled={busy || !engine.installed}
            title={engine.installed ? undefined : t('detail.needsLc0', { engine: engine.name })}
            onClick={onInstall}>{t('card.install')}</button>
        )}
      </span>
    </li>
  );
}
