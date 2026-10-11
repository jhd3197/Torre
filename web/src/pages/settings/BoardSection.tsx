// Board & pieces: a live preview on top, then the piece set, the board colours and how the board behaves.
import { useTranslation } from 'react-i18next';
import { fenCells } from '../../lib/boardTools';
import { PIECE_SETS, pieceSrc, setPieceSet, usePieceSet } from '../../lib/pieces';
import { autoQueen, BOARD_THEMES, boardTheme, coordinates, dragPieces, lastMoveHighlight, legalDots, MOVE_ANIMATIONS, moveAnimation } from '../../lib/settings';
import { anchorId, ChoiceRow, FlagSwitch, Subheading } from './controls';

// Three pieces on a light square, for the piece set swatches.
const SWATCH = ['k', 'n', 'p'];
// The preview: a Ruy Lopez after 3.Bb5, the bishop's move highlighted and Black's knight picked up.
const PREVIEW_FEN = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
const PREVIEW_LAST = ['f1', 'b5'];
const PREVIEW_PICKED = 'c6';
const PREVIEW_TARGETS = ['b8', 'e7', 'a5', 'b4', 'd4'];
const squareAt = (i: number) => `${'abcdefgh'[i % 8]}${8 - Math.floor(i / 8)}`;

function PreviewBoard() {
  const { t } = useTranslation('settings');
  const pieceSet = usePieceSet();
  const showCoordinates = coordinates.use();
  const showLast = lastMoveHighlight.use();
  const showTargets = legalDots.use();
  return (
    <figure className="settings-preview">
      <div className={`settings-preview-board pieces-${pieceSet}`} role="img" aria-label={t('display.preview')}>
        {fenCells(PREVIEW_FEN).map((piece, i) => {
          const square = squareAt(i);
          const classes = ['square', (Math.floor(i / 8) + i) % 2 && 'dark', showLast && PREVIEW_LAST.includes(square) && 'last-move',
            square === PREVIEW_PICKED && 'selected', showTargets && PREVIEW_TARGETS.includes(square) && 'legal'].filter(Boolean).join(' ');
          return (
            <span key={square} className={classes}>
              {piece && <img src={pieceSrc(piece, pieceSet)} alt="" />}
              {showCoordinates && i % 8 === 0 && <span className="coordinate rank">{square[1]}</span>}
              {showCoordinates && i >= 56 && <span className="coordinate file">{square[0]}</span>}
            </span>
          );
        })}
      </div>
    </figure>
  );
}

export function BoardSection() {
  const { t } = useTranslation('settings');
  const pieceSet = usePieceSet();
  const theme = boardTheme.use();
  return (
    <div className="settings-board-layout">
      <PreviewBoard />
      <div className="settings-board-options">
        <Subheading id={anchorId('pieces.label')}>{t('pieces.label')}</Subheading>
        <div className="settings-tiles" role="radiogroup" aria-label={t('pieces.label')}>
          {PIECE_SETS.map(set => (
            <button key={set} type="button" role="radio" aria-checked={pieceSet === set} className="settings-tile"
              onClick={() => setPieceSet(set)}>
              <span className={`settings-piece-swatch pieces-${set}`} aria-hidden="true">
                {SWATCH.map(p => <img key={p} src={pieceSrc(p, set)} alt="" />)}
              </span>
              <span className="settings-tile-text">
                <strong>{t(`pieces.sets.${set}.name`)}</strong>
                <small>{t(`pieces.sets.${set}.note`)}</small>
              </span>
            </button>
          ))}
        </div>
        <Subheading id={anchorId('board.title')}>{t('board.title')}</Subheading>
        <div className="settings-tiles boards" role="radiogroup" aria-label={t('board.title')}>
          {BOARD_THEMES.map(name => (
            <button key={name} type="button" role="radio" aria-checked={theme === name} className="settings-tile"
              onClick={() => boardTheme.set(name)}>
              <span className={`settings-board-swatch board-${name}`} aria-hidden="true">
                {Array.from({ length: 16 }, (_, i) => <i key={i} className={(Math.floor(i / 4) + i) % 2 ? 'dark' : undefined} />)}
              </span>
              <strong>{t(`board.themes.${name}`)}</strong>
            </button>
          ))}
        </div>
        <Subheading>{t('board.behaviour')}</Subheading>
        <FlagSwitch setting={coordinates} text="board.coordinates" />
        <FlagSwitch setting={lastMoveHighlight} text="board.lastMove" />
        <FlagSwitch setting={legalDots} text="board.legalDots" />
        <ChoiceRow setting={moveAnimation} values={MOVE_ANIMATIONS} text="board.animation" group="board.animations" />
        <FlagSwitch setting={dragPieces} text="board.drag" />
        <FlagSwitch setting={autoQueen} text="board.autoQueen" />
      </div>
    </div>
  );
}
