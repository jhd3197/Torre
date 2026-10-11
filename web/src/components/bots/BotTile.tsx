// A bot's card in a collection: the figure, name, rating and best stars, marked when beaten or locked.
import type { ReactNode } from 'react';
import { botPicture, type Bot } from '../../data/bots';
import { Stars } from '../Reward';

export interface TileProps {
  bot: Bot;
  rating: ReactNode;
  stars?: number;
  starsLabel?: string;
  selected?: boolean;
  beaten?: boolean;
  locked?: boolean;
  /** A small label over the picture (a collection, "From Caracas"), with an optional flag. */
  badge?: ReactNode;
  /** A line under the rating ("40 above you"). */
  note?: ReactNode;
  title?: string;
  onClick: () => void;
}

export function BotTile({ bot, rating, stars, starsLabel, selected, beaten, locked, badge, note, title, onClick }: TileProps) {
  return (
    <button type="button" className={`bot-card${selected ? ' selected' : ''}${locked ? ' locked' : ''}`} aria-pressed={!!selected} title={title} onClick={onClick}>
      <span className="bot-picture"><img src={botPicture(bot)} alt="" loading="lazy" /></span>
      {badge && <span className="bot-card-badge">{badge}</span>}
      {locked ? <span className="bot-card-mark lock" aria-hidden>🔒︎</span> : beaten && <span className="bot-card-mark beaten" aria-hidden>✓</span>}
      <span className="bot-card-name"><strong>{bot.name}</strong><span className="bot-rating">{rating}</span></span>
      {stars !== undefined && <Stars count={stars} size={13} label={starsLabel} />}
      {note && <small className="bot-card-note">{note}</small>}
    </button>
  );
}

export { Flag } from './Flag';
