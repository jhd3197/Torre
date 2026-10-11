// A lesson's YouTube video, played in a modal. The privacy-enhanced domain sets no
// cookies until the video plays; the player only loads while the dialog is open.
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog';
import type { LessonVideo } from '../types';

export function VideoDialog({ video, title, open, onClose }: { video: LessonVideo; title: string; open: boolean; onClose: () => void }) {
  const { t } = useTranslation('lessons');
  const id = encodeURIComponent(video.youtube);
  return (
    <Dialog id="lesson-video-dialog" open={open} onClose={onClose}>
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button type="button" className="text-button" onClick={onClose}>{t('video.close')}</button>
      </div>
      <div className="lesson-video-frame">
        <iframe src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`} title={t('video.frame', { title })}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      </div>
      <a className="text-button" href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noreferrer">{t('video.openYouTube')}</a>
    </Dialog>
  );
}
