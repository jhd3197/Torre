import { useTranslation } from 'react-i18next';
import { scoreLabel } from '../../lib/format';
import type { EngineStatus } from '../../hooks/useChess';
import type { EngineInfo, EngineResult } from '../../types';
import { engineLines } from '../../lib/settings';
import { Mascot, type MascotPose } from '../Reward';

/** The chosen engine's top lines, refreshed automatically for every position while analysis is on. */
export function EnginePanel({ status, result, auto, onToggleAuto, onTryBest, tryLabel, available, finished, engines, engineId, onEngineChange }: {
  status: EngineStatus;
  result: EngineResult | null;
  auto: boolean;
  onToggleAuto: () => void;
  onTryBest: () => void;
  tryLabel: string;
  available: boolean;
  finished: boolean;
  engines: EngineInfo[];
  engineId: string;
  onEngineChange: (engineId: string) => void;
}) {
  const { t } = useTranslation('board');
  const current = engines.find(engine => engine.id === engineId);
  const shownLines = Number(engineLines.use());
  // With no lines to show, the rook says why.
  const empty = (pose: MascotPose, text: string) => (
    <div className="engine-empty"><Mascot pose={pose} size={88} /><p className="engine-placeholder">{text}</p></div>
  );
  let body;
  if (!available) body = empty('shrug', t('engine.notInstalled'));
  else if (finished) body = empty('content', t('engine.gameOver'));
  else if (!auto) body = empty('sleepy', t('engine.paused'));
  else if (status === 'error') body = empty('confused', t('engine.unavailable'));
  else if (!result) body = <p className="engine-placeholder">{t('engine.finding')}</p>;
  else body = (
    <>
      {result.lines.slice(0, shownLines).map((line, i) => (
        <div className="engine-line" key={i}><b>{scoreLabel(line)}</b><span>{line.moves.join(' ')}</span></div>
      ))}
    </>
  );
  return (
    <div className="engine-section">
      <div className="engine-heading">
        <div>
          <i />
          {engines.length > 1 ? (
            <select id="engine-picker" aria-label={t('engine.choose')} value={engineId} onChange={e => onEngineChange(e.target.value)}>
              {engines.map(engine => <option key={engine.id} value={engine.id}>{engine.name}</option>)}
            </select>
          ) : <strong>{current?.name ?? 'Stockfish 18'}</strong>}
        </div>
        <div className="engine-heading-actions">
          <button className="text-button" id="try-line" type="button" disabled={!result?.best || finished} onClick={onTryBest}>{tryLabel}</button>
          <button id="analyze" type="button" className="engine-toggle" aria-pressed={auto} onClick={onToggleAuto} disabled={!available}>
            {auto ? (status === 'pending' ? t('engine.thinking') : t('engine.on')) : t('engine.off')}
          </button>
        </div>
      </div>
      <div id="engine-lines">{body}</div>
    </div>
  );
}
