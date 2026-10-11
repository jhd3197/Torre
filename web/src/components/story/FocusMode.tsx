// Focus mode: entering a story node (lesson, gauntlet, boss) makes the app
// shell disappear. The in-node header is the exit X, a progress bar, and the
// streak/XP chips — and the X never exits directly: it opens the exit modal.
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../Dialog';
import { Mascot } from '../Reward';
import { Toast } from '../Toast';
import { useProfile } from '../../hooks/useProfile';
import { StreakChip } from './Streak';

/** "Wait, don't go!" — leaving mid-node always goes through this dialog. */
export function ExitModal({ open, onStay, onLeave, streakAtRisk }: {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
  /** Days on the line when today's goal isn't met yet; the modal warns about it. */
  streakAtRisk?: number;
}) {
  const { t } = useTranslation('story');
  return (
    <Dialog id="story-exit-dialog" open={open} onClose={onStay}>
      <div className="exit-card">
        <Mascot pose="sad" size={96} />
        <h2>{t('exit.title')}</h2>
        <p>{t('exit.body')}</p>
        {streakAtRisk ? <p className="exit-streak">{t('exit.streak', { days: streakAtRisk })}</p> : null}
        <div className="exit-actions">
          <button type="button" className="button primary squishy" onClick={onStay}>{t('exit.stay')}</button>
          <button type="button" className="text-button" onClick={onLeave}>{t('exit.leave')}</button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * The shell-less node screen: a fixed header (exit X · progress · streak/XP chips)
 * and the node content below it. `progress` is 0..1; omit it for nodes without
 * a meaningful fill (the boss intro).
 */
export function FocusMode({ label, progress, onExit, children }: {
  label: string;
  progress?: number;
  /** Extra cleanup when leaving; the exit itself always returns to /story. */
  onExit?: () => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation('story');
  const profile = useProfile();
  const [exitOpen, setExitOpen] = useState(false);

  // While a node is open, the rail and top bar hide (story.css), even on the
  // shared /lessons routes that story lessons reuse.
  useEffect(() => {
    document.body.dataset.focus = 'story';
    return () => { delete document.body.dataset.focus; };
  }, []);

  const leave = () => { onExit?.(); navigate('/story'); };

  const streak = profile?.streak;
  const streakAtRisk = streak && !streak.doneToday && streak.count > 0 ? streak.count : undefined;

  return (
    <div className="story-focus">
      <header className="story-focus-bar">
        <button type="button" className="icon-button story-focus-exit" aria-label={t('focus.leave', { label })} onClick={() => setExitOpen(true)}>×</button>
        <div className="story-focus-progress" role="progressbar" aria-label={t('focus.progress', { label })}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)}>
          <i style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
        </div>
        {streak && <StreakChip streak={streak} />}
        {profile && (
          <span className="xp-chip" title={t('focus.xpTitle', { level: profile.level, into: profile.xpIntoLevel, total: profile.xpForLevel })}>
            <span className="xp-level">{profile.level}</span>{t('focus.xp', { xp: profile.xp })}
          </span>
        )}
      </header>
      <div className="story-focus-body">{children}</div>
      <ExitModal open={exitOpen} onStay={() => setExitOpen(false)} onLeave={leave} streakAtRisk={streakAtRisk} />
      <Toast />
    </div>
  );
}
