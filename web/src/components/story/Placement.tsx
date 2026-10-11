// The placement offer: a one-time modal for players whose puzzle rating says
// they are past the early chapters. Same aesthetic as the exit modal.
import { useTranslation } from 'react-i18next';
import { Dialog } from '../Dialog';
import { Mascot } from '../Reward';

/** "You already solve tactics like a <rating> player. Skip ahead?" */
export function PlacementModal({ rating, through, onAccept, onDecline }: {
  rating: number;
  /** Chapters 1..through open when the offer is accepted. */
  through: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t } = useTranslation('story');
  return (
    <Dialog id="story-placement-dialog" open onClose={onDecline}>
      <div className="exit-card">
        <Mascot pose="salute" size={96} />
        <h2>{t('placement.title')}</h2>
        <p>{t('placement.body', { rating })}</p>
        <div className="exit-actions">
          <button type="button" className="button primary squishy" onClick={onAccept}>{t('placement.accept', { through })}</button>
          <button type="button" className="text-button" onClick={onDecline}>{t('placement.decline')}</button>
        </div>
      </div>
    </Dialog>
  );
}
