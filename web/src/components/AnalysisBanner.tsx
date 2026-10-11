import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalysis, useToast } from '../state/AppData';
import { ANALYSIS_ART } from '../lib/art';

const SECONDS_PER_GAME = 2; // depth 12 on half the cores, measured on this archive

/** "Analyze all": runs analyze.py on unanalyzed games in the background, with progress. */
export function AnalysisBanner() {
  const { analysis: status, startAnalysis, stopAnalysis } = useAnalysis();
  const toast = useToast();
  const { t } = useTranslation('board');
  const [busy, setBusy] = useState(false);
  if (!status) return null;

  const act = (action: () => Promise<void>) => async () => {
    setBusy(true);
    try { await action(); } catch (error) { toast((error as Error).message); } finally { setBusy(false); }
  };

  if (status.running) {
    return (
      <div className="analysis-runner" role="status">
        <div><strong>{status.current?.mining ? t('analysis.mining') : t('analysis.running')}</strong><span>{t('analysis.progress', { done: status.done, total: status.total })}{status.current && !status.current.mining ? ` · ${t('analysis.versus', { opponent: status.current.opponent || t('analysis.unknown') })}` : ''}{status.my_puzzles ? ` · ${t('analysis.mined', { count: status.my_puzzles })}` : ''}</span></div>
        <progress max={status.total} value={status.done} aria-label={t('analysis.progressLabel')} />
        <button type="button" className="analysis-runner-button" disabled={busy} onClick={act(stopAnalysis)}>{t('analysis.stop')}</button>
      </div>
    );
  }
  if (status.error) {
    return (
      <div className="analysis-runner">
        <div><strong>{t('analysis.stopped')}</strong><span>{status.error}</span></div>
        <button type="button" className="analysis-runner-button" disabled={busy} onClick={act(startAnalysis)}>{t('analysis.retry')}</button>
      </div>
    );
  }
  if (!status.remaining) return null;
  if (!status.engine) {
    return <div className="analysis-runner"><div><strong>{t('analysis.notAnalyzed', { count: status.remaining })}</strong><span>{t('analysis.install')}</span></div></div>;
  }
  const minutes = Math.max(1, Math.round(status.remaining * SECONDS_PER_GAME / 60));
  const what = status.outdated
    ? t('analysis.toAnalyze', { count: status.remaining, outdated: status.outdated })
    : t('analysis.notAnalyzedYet', { count: status.remaining });
  return (
    <div className="analysis-runner">
      <img className="runner-art" src={ANALYSIS_ART} alt="" width="44" height="44" />
      <div><strong>{what}</strong><span>{t('analysis.estimate', { minutes })}</span></div>
      <button type="button" className="analysis-runner-button primary" disabled={busy} onClick={act(startAnalysis)}>{t('analysis.all')}</button>
    </div>
  );
}
