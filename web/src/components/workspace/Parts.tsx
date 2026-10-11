// Small pieces of the board workspace.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Planning } from '../../hooks/usePlanning';
import type { Color } from '../../types';
import { pieceSrc, usePieceSet } from '../../lib/pieces';
import { NavIcon } from '../NavIcon';

export interface PlayerInfo { name: ReactNode; detail: string; avatar?: string }

/** `lead` (a review's material count, "+3") takes the colour tag's place when given. */
export function PlayerStrip({ position, color, info, lead }: { position: 'top' | 'bottom'; color: Color; info: PlayerInfo; lead?: string | null }) {
  const { t } = useTranslation('board');
  const pieceSet = usePieceSet();
  return (
    <div className={`player ${position}-player`}>
      {info.avatar
        ? <span className="player-avatar portrait"><img src={info.avatar} alt="" /></span>
        : <span className={`player-avatar ${color === 'white' ? 'light' : 'dark'}-piece`}><img src={pieceSrc(color === 'white' ? 'N' : 'n', pieceSet)} alt="" /></span>}
      <div><strong id={`${position}-name`}>{info.name}</strong><small id={`${position}-detail`}>{info.detail}</small></div>
      {lead === undefined
        ? <span className="player-tag" id={`${position}-tag`}>{t(`players.${color}`)}</span>
        : <span className="player-lead" id={`${position}-lead`} title={lead ? t('players.ahead', { count: Number(lead.slice(1)) }) : undefined}>{lead}</span>}
    </div>
  );
}

export function Playback({ progress, cursor, total, onGo, autoplay, onAutoplay, fen, onCopy, disabled = false }: {
  progress: string; cursor: number; total: number; onGo: (ply: number) => void;
  autoplay?: boolean; onAutoplay?: () => void; fen?: string; onCopy?: () => void; disabled?: boolean;
}) {
  const { t } = useTranslation('board');
  return (
    <div className="playback">
      <span id="move-progress">{progress}</span>
      <div className="playback-buttons">
        <button id="first" type="button" aria-label={t('playback.first')} title={t('playback.first')} disabled={disabled || cursor === 0} onClick={() => onGo(0)}><NavIcon to="first" /></button>
        <button id="previous" type="button" aria-label={t('playback.previous')} title={t('playback.previousTitle')} disabled={disabled || cursor === 0} onClick={() => onGo(cursor - 1)}><NavIcon to="previous" /></button>
        {onAutoplay && (
          <button id="autoplay" type="button" className="autoplay" aria-label={autoplay ? t('playback.pause') : t('playback.autoplay')} title={t('playback.autoplay')}
            disabled={!total} onClick={onAutoplay}><img src={`art/ui3d/${autoplay ? 'pause' : 'play'}.webp`} alt="" width="20" height="20" /></button>
        )}
        <button id="next" type="button" aria-label={t('playback.next')} title={t('playback.nextTitle')} disabled={disabled || cursor === total} onClick={() => onGo(cursor + 1)}><NavIcon to="next" /></button>
        <button id="last" type="button" aria-label={t('playback.last')} title={t('playback.last')} disabled={disabled || cursor === total} onClick={() => onGo(total)}><NavIcon to="last" /></button>
      </div>
      {fen !== undefined && <button id="copy-fen" type="button" title={t('playback.copyFen')} onClick={onCopy}>FEN <span>⧉</span></button>}
    </div>
  );
}

export function PlanningToolbar({ planning }: { planning: Planning }) {
  const { t } = useTranslation('board');
  const count = planning.marks.length;
  return (
    <div className="planning-toolbar">
      <button id="draw-mode" type="button" aria-pressed={planning.drawMode} title={t('planning.drawTitle')} onClick={planning.toggleDrawMode}>{t('planning.draw')}</button>
      <select id="arrow-mode" aria-label={t('planning.mode')} value={planning.freeform ? 'freeform' : 'legal'} onChange={e => planning.setFreeform(e.target.value === 'freeform')}>
        <option value="legal">{t('planning.legal')}</option>
        <option value="freeform">{t('planning.freeform')}</option>
      </select>
      <span id="planning-help">{planning.drawMode ? t('planning.chooseStart') : t('planning.rightDrag')}</span>
      <button id="clear-marks" type="button" title={t('planning.clearTitle')} disabled={!count} onClick={planning.clear}>{t('planning.clear')}</button>
    </div>
  );
}

export function HeatLegend({ info }: { info: string }) {
  const { t } = useTranslation('board');
  return (
    <>
      <div id="heat-legend"><span className="heat-white-key">{t('heat.legend.white')}</span><span className="heat-black-key">{t('heat.legend.black')}</span><span className="heat-contested-key">{t('heat.legend.both')}</span><span className="heat-neutral-key">{t('heat.legend.neutral')}</span></div>
      <p id="square-info">{info}</p>
    </>
  );
}
