// Data: what this browser keeps for Torre. Clear stars, put every setting back to its default,
// and save or restore a backup file of it all.
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { backup, backupName, restore, storageUsed } from '../../lib/backup';
import { clearEvents } from '../../lib/events';
import { restoreDefaults } from '../../lib/settings';
import { clearStars, totalStars } from '../../lib/stars';
import { useToast } from '../../state/AppData';
import { anchorId, Row } from './controls';

/** A button that asks once before doing something that cannot be undone. */
function Confirmed({ label, confirm, keep, disabled, onConfirm }: {
  label: string; confirm: string; keep: string; disabled?: boolean; onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className="button" disabled={disabled} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <span className="settings-confirm">
      <button type="button" className="button danger" onClick={() => { setAsking(false); onConfirm(); }}>{confirm}</button>
      <button type="button" className="button" onClick={() => setAsking(false)}>{keep}</button>
    </span>
  );
}

const kilobytes = (bytes: number) => Math.max(1, Math.round(bytes / 1024));

export function DataSection({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const { t } = useTranslation('settings');
  const toast = useToast();
  const [stars, setStars] = useState(totalStars);
  const [used, setUsed] = useState(storageUsed);
  const file = useRef<HTMLInputElement>(null);

  function save() {
    const saved = backup();
    const url = URL.createObjectURL(new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = backupName(saved.saved);
    link.click();
    URL.revokeObjectURL(url);
  }

  async function load(chosen: File | undefined) {
    if (!chosen) return;
    try {
      restore(JSON.parse(await chosen.text()));
    } catch {
      toast(t('data.notBackup'));
      return;
    } finally {
      if (file.current) file.current.value = '';
    }
    // Every setting, page and the music read storage when they start, so a fresh start picks it all up.
    reload();
  }

  return (
    <>
      <Row id={anchorId('progress.stars')} label={t('progress.stars')} note={t('progress.starsNote', { count: stars })} keepNote>
        <Confirmed label={t('progress.clear')} confirm={t('progress.confirm')} keep={t('progress.keep')} disabled={!stars}
          onConfirm={() => { clearStars(); clearEvents(); setStars(0); setUsed(storageUsed()); }} />
      </Row>
      <Row id={anchorId('data.reset')} label={t('data.reset')} note={t('data.resetNote')}>
        <Confirmed label={t('data.reset')} confirm={t('data.resetConfirm')} keep={t('data.cancel')}
          onConfirm={() => { restoreDefaults(); setUsed(storageUsed()); toast(t('data.resetDone')); }} />
      </Row>
      <Row id={anchorId('data.backup')} label={t('data.backup')} note={t('data.backupNote')}>
        <button type="button" className="button" onClick={save}>{t('data.save')}</button>
      </Row>
      <Row id={anchorId('data.restore')} label={t('data.restore')} note={t('data.restoreNote')}>
        <button type="button" className="button" onClick={() => file.current?.click()}>{t('data.choose')}</button>
        <input ref={file} type="file" accept="application/json,.json" hidden aria-label={t('data.restore')}
          onChange={e => void load(e.target.files?.[0])} />
      </Row>
      <Row id={anchorId('data.storage')} label={t('data.storage')} note={t('data.storageNote', { size: kilobytes(used) })} keepNote>{null}</Row>
    </>
  );
}
