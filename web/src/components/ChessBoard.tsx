// The interactive board. It never decides legality itself: moves come from the server's legal list.
import { useEffect, useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { arrowPath, castleMove, center, describePiece, heat, isCastleGesture, ownsPiece, plan, squareOrder } from '../lib/boardTools';
import type { Planning } from '../hooks/usePlanning';
import { useToast } from '../state/AppData';
import { usePromotion } from '../state/Promotion';
import type { BoardState, Color, LessonMark } from '../types';
import { api } from '../lib/api';

/** POST /api/illegal: the rule a refused move breaks (board_view.illegal_reason). */
interface IllegalMove { reason: string | null; piece?: string; attacker?: string; blocker?: string }
import { gradeIcon, type Grade } from '../lib/grades';
import { pieceSrc, usePieceSet } from '../lib/pieces';
import { announceMoves, autoQueen, coordinates, dragPieces, lastMoveHighlight, legalDots, moveAnimation, motionReduced, typedMoves } from '../lib/settings';
import { typedMove } from '../lib/moveInput';

export interface ChessBoardProps {
  board: BoardState | null;
  flipped: boolean;
  planning: Planning;
  lastMove?: string | null;
  /** Whose pieces can be picked up: a colour, 'turn' for the side to move, or false. */
  movable: Color | 'turn' | false;
  /** Called with a legal UCI move. */
  onMove?: (uci: string) => void | Promise<void>;
  busy?: boolean;
  bestMove?: string | null;
  /** The move played next from here (in a game or line), drawn as a grey arrow. */
  nextMove?: string | null;
  showHeat?: boolean;
  /** Extra squares to highlight, such as a drill's solution. */
  highlight?: string[];
  /** Arrows and circles that come with the position, such as a lesson's. */
  annotations?: LessonMark[];
  evalBar?: ReactNode;
  onHoverSquare?: (square: string) => void;
  /** The review's grade for the move that landed on a square, shown as a badge on it. */
  gradeMark?: { square: string; grade: Grade } | null;
  /** A square to flash red, such as where a demo move just captured. */
  flash?: string | null;
  /** Blindfold: draw the squares only; moves still work by clicking squares. */
  hidePieces?: boolean;
}

/** How far an arrow's line stops short of the target, in board units (a square is 100): its head covers the rest. */
const ARROW_TRIM = 28;
/** How long a moved piece takes to slide, by the Move animation setting. */
const SLIDE_MS = { fast: 120, normal: 220 } as const;

export function ChessBoard({ board, flipped, planning, lastMove, movable, onMove, busy = false, bestMove, nextMove, showHeat = false,
  highlight = [], annotations = [], evalBar, onHoverSquare, gradeMark, flash = null, hidePieces = false }: ChessBoardProps) {
  const toast = useToast();
  const choosePromotion = usePromotion();
  const { t } = useTranslation('board');
  const pieceSet = usePieceSet();
  const [selected, setSelected] = useState<string | null>(null);
  // A piece that tried an illegal move shakes for a moment while the rule it broke is shown.
  const [shake, setShake] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  // The move this board just made for you: it is already where you put it, so it does not slide.
  const ownMove = useRef<string | null>(null);
  const fen = board?.fen;
  useEffect(() => setSelected(null), [fen]);
  const animation = moveAnimation.use();
  const showCoordinates = coordinates.use();
  const showLast = lastMoveHighlight.use();
  const showTargets = legalDots.use();
  const canDrag = dragPieces.use();
  const announce = announceMoves.use();
  const typing = typedMoves.use();

  // Sliding pieces: the piece that just landed glides over from the moved-from square.
  // Keyed on the FEN, not the board object: a poller (the Arena) hands over a fresh object
  // for the same position, which must not replay the slide.
  useEffect(() => {
    if (animation === 'off' || motionReduced() || !lastMove || !fen || lastMove === ownMove.current) return;
    const from = lastMove.slice(0, 2), to = lastMove.slice(2, 4);
    const square = boardRef.current?.querySelector<HTMLElement>(`[data-square="${to}"]`);
    const img = square?.querySelector('img');
    if (!square || !img) return;
    const size = square.getBoundingClientRect().width;
    if (!size) return;
    const files = from.charCodeAt(0) - to.charCodeAt(0);
    const ranks = Number(from[1]) - Number(to[1]);
    const dx = (flipped ? -files : files) * size;
    const dy = (flipped ? ranks : -ranks) * size;
    img.style.transition = 'none';
    img.style.transform = `translate(${dx}px, ${dy}px)`;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      img.style.transition = `transform ${SLIDE_MS[animation]}ms ease-out`;
      img.style.transform = '';
    }));
    return () => {
      cancelAnimationFrame(frame);
      img.style.transition = 'none';
      img.style.transform = '';
    };
  }, [lastMove, animation, flipped, fen]);

  const turn = board?.turn ?? 'white';
  const canPick = (square: string) => {
    if (!board || busy || board.result || !movable) return false;
    const side = movable === 'turn' ? turn : movable;
    return side === turn && ownsPiece(board.pieces[square], turn);
  };

  async function play(move: string) {
    setSelected(null);
    ownMove.current = move;
    await onMove?.(move);
  }

  async function choose(square: string) {
    if (!board || busy || board.result) return;
    if (selected) {
      const castle = castleMove(board, selected, square);
      if (castle) { await play(castle); return; }
      if (isCastleGesture(board, selected, square)) {
        toast(t('chessboard.illegalCastle'));
        return;
      }
      const choices = board.legal.filter(m => m.startsWith(selected + square));
      if (choices.length) {
        let move = choices[0];
        if (choices.length > 1) {
          const piece = autoQueen.get() ? 'q' : await choosePromotion(turn);
          if (!piece) return;
          move = selected + square + piece;
        }
        await play(move);
        return;
      }
      if (!canPick(square)) { const from = selected; setSelected(null); void explainIllegal(from, square); return; }
    }
    setSelected(canPick(square) && selected !== square ? square : null);
  }

  /** Say which rule a refused move breaks (a pin, a check, how the piece moves), and shake the piece. */
  async function explainIllegal(from: string, to: string) {
    if (!board) return;
    setShake(from);
    setTimeout(() => setShake(current => current === from ? null : current), 450);
    try {
      const why = await api<IllegalMove>('api/illegal', { initialFen: board.fen, from, to });
      if (!why.reason) return;
      const piece = why.piece ? t(`chessboard.pieces.${why.piece}`) : '';
      toast(t(`chessboard.illegal.${why.reason}`, { piece, attacker: why.attacker ?? '', blocker: why.blocker ?? '' }));
    } catch { /* the board still refuses the move; the reason is a bonus */ }
  }

  function squareAt(event: { clientX: number; clientY: number }): string | null {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
    return squareOrder(flipped)[Math.floor(y / rect.height * 8) * 8 + Math.floor(x / rect.width * 8)];
  }

  const report = (reason: string | null) => { if (reason) toast(reason); };

  function onClick(event: React.MouseEvent) {
    const square = (event.target as HTMLElement).closest<HTMLElement>('[data-square]')?.dataset.square;
    if (!square) return;
    if (planning.drawMode) { report(planning.tap(square)); return; }
    planning.clear();
    void choose(square);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 2) return;
    event.preventDefault();
    const square = squareAt(event);
    if (!square) return;
    setSelected(null);
    planning.begin(square);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const square = squareAt(event);
    if (!planning.drag) { if (square) onHoverSquare?.(square); return; }
    if (square) planning.extend(square);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 2 || !planning.drag) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    report(planning.commitDrag(squareAt(event)));
  }

  function onDragStart(event: DragEvent<HTMLDivElement>) {
    const square = (event.target as HTMLElement).closest<HTMLElement>('[data-square]')?.dataset.square;
    if (!square || planning.drawMode || planning.drag || !canPick(square)) { event.preventDefault(); return; }
    planning.clear();
    setSelected(square);
    event.dataTransfer.setData('text/plain', square);
    event.dataTransfer.effectAllowed = 'move';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const square = (event.target as HTMLElement).closest<HTMLElement>('[data-square]')?.dataset.square;
    if (square && event.dataTransfer.getData('text/plain') === selected) void choose(square);
  }

  // Drawings: committed marks plus the arrow being dragged, if it is allowed.
  const marks = [...planning.marks];
  if (board && planning.drag) {
    const preview = plan(board, planning.drag.from, planning.drag.to, planning.freeform);
    if (preview.allowed) marks.push({ ...planning.drag, kind: preview.kind });
  } else if (planning.drawStart) marks.push({ from: planning.drawStart, to: planning.drawStart });

  const targets = selected && board && showTargets ? board.legal.filter(m => m.startsWith(selected)).map(m => m.slice(2, 4)) : [];
  const castleTargets = selected && board && showTargets
    ? squareOrder(false).filter(sq => castleMove(board, selected, sq)) : [];
  // Said to a screen reader as each move lands: where it came from and what now stands there.
  const landed = lastMove && board ? lastMove.slice(2, 4) : null;
  const spoken = announce && landed && board ? t('chessboard.announce', { from: lastMove!.slice(0, 2), piece: describePiece(board.pieces[landed], landed) }) : '';
  const typable = typing && !!board && !!onMove && !!movable && !board.result;

  return (
    <>
      <div className="board-wrap">
        {evalBar}
        <div className={`board pieces-${pieceSet}${planning.drawMode ? ' drawing' : ''}`} id="board" ref={boardRef} role="group" aria-label={t('chessboard.label')}
          onClick={onClick} onContextMenu={e => e.preventDefault()} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={planning.cancel} onLostPointerCapture={() => { if (planning.drag) planning.cancel(); }}
          onDragStart={onDragStart} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}
          onFocus={e => { const sq = (e.target as HTMLElement).dataset.square; if (sq) onHoverSquare?.(sq); }}>
          {board && squareOrder(flipped).map((square, i) => {
            const piece = hidePieces ? undefined : board.pieces[square];
            const dark = (square.charCodeAt(0) - 97 + Number(square[1])) % 2 === 1;
            const isLast = showLast && !!lastMove && (lastMove.slice(0, 2) === square || lastMove.slice(2, 4) === square);
            const isCastle = castleTargets.includes(square);
            const tint = showHeat ? heat(board.control?.[square]) : null;
            const classes = ['square', dark && 'dark', (isLast || highlight.includes(square)) && 'last-move', selected === square && 'selected',
              (targets.includes(square) || isCastle) && 'legal', isCastle && 'castle-target', board.check === square && 'check',
              flash === square && 'capture-flash', shake === square && 'illegal-shake'].filter(Boolean).join(' ');
            const control = tint ? t('chessboard.control', { square, white: tint.white, black: tint.black }) : undefined;
            return (
              <button key={square} type="button" className={classes} data-square={square} aria-label={describePiece(piece, square)}
                aria-pressed={selected === square} draggable={canDrag && !!piece && canPick(square)} title={isCastle ? t('chessboard.castleHere') : control}
                aria-description={control} data-heat={tint && tint.kind !== 'neutral' ? tint.kind : undefined}
                style={tint && tint.kind !== 'neutral' ? { ['--heat-alpha' as string]: String(0.23 + tint.strength * 0.08) } : undefined}>
                {piece && <img src={pieceSrc(piece, pieceSet)} alt="" draggable={false} />}
                {gradeMark?.square === square && (
                  <img key={`${gradeMark.grade}-${board.fen}`} className={`grade-mark grade-${gradeMark.grade}`} src={gradeIcon(gradeMark.grade)} alt="" draggable={false} />
                )}
                {showCoordinates && i % 8 === 0 && <span className="coordinate rank">{square[1]}</span>}
                {showCoordinates && i >= 56 && <span className="coordinate file">{square[0]}</span>}
              </button>
            );
          })}
        </div>
        <svg id="arrows" viewBox="0 0 800 800" aria-hidden="true">
          {/* Heads start where the trimmed line ends (refX 0), so no line or round cap shows past them. */}
          <defs>
            {(['arrowhead', 'plan-arrowhead', 'lesson-arrowhead', 'next-arrowhead'] as const).map(id => (
              <marker key={id} id={id} markerWidth="2.6" markerHeight="3" refX="0" refY="1.5" orient="auto">
                <path className={id} d="M0,0 L2.6,1.5 L0,3 Z" />
              </marker>
            ))}
          </defs>
          {board && nextMove && nextMove !== bestMove && <path id="next-arrow" d={arrowPath(board, nextMove.slice(0, 2), nextMove.slice(2, 4), flipped, ARROW_TRIM)} markerEnd="url(#next-arrowhead)" />}
          {board && bestMove && <path id="hint-arrow" style={{ display: 'block' }} d={arrowPath(board, bestMove.slice(0, 2), bestMove.slice(2, 4), flipped, ARROW_TRIM)} markerEnd="url(#arrowhead)" />}
          <g id="lesson-marks">
            {board && annotations.map(mark => {
              const a = center(mark.from, flipped);
              return mark.from === mark.to
                ? <circle key={`${mark.from}-circle`} className="lesson-circle" cx={a.x} cy={a.y} r={39} />
                : <path key={`${mark.from}-${mark.to}`} className="lesson-arrow" d={arrowPath(board, mark.from, mark.to, flipped, ARROW_TRIM)} markerEnd="url(#lesson-arrowhead)" />;
            })}
          </g>
          <g id="planning-marks">
            {marks.map(mark => {
              const a = center(mark.from, flipped);
              return mark.from === mark.to
                ? <circle key={`${mark.from}-circle`} className="plan-circle" cx={a.x} cy={a.y} r={39} />
                : <path key={`${mark.from}-${mark.to}`} className={`plan-arrow${mark.kind === 'note' ? ' freeform-arrow' : ''}`}
                    d={arrowPath(board, mark.from, mark.to, flipped, ARROW_TRIM)} markerEnd="url(#plan-arrowhead)" />;
            })}
          </g>
        </svg>
      </div>
      {announce && <p className="sr-only" aria-live="polite">{spoken}</p>}
      {typable && <MoveEntry board={board!} canMove={!busy && (movable === 'turn' || movable === board!.turn)} onMove={play} />}
    </>
  );
}

/** A box under the board for typed moves; the move plays on Enter when it names one legal move. */
function MoveEntry({ board, canMove, onMove }: { board: BoardState; canMove: boolean; onMove: (uci: string) => Promise<void> }) {
  const { t, i18n } = useTranslation('board');
  const [text, setText] = useState('');
  const [error, setError] = useState(false);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const move = canMove ? typedMove(board, text, i18n.language) : null;
    setError(!move);
    if (!move) return;
    setText('');
    void onMove(move);
  }
  return (
    <form className="move-entry" onSubmit={submit}>
      <input type="text" value={text} aria-label={t('chessboard.typeMove')} placeholder={t('chessboard.typeMovePlaceholder')}
        aria-invalid={error || undefined} autoComplete="off" spellCheck={false}
        onChange={e => { setText(e.target.value); setError(false); }} />
      {error && <span className="move-entry-error" role="alert">{t('chessboard.typeMoveError')}</span>}
    </form>
  );
}
