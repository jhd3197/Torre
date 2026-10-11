// Lesson text helpers: narration beats and move labels.
import { NARRATION_PART, narrationText } from '../../hooks/useNarration';

/** In explain narration, `[move]` marks where the next demo move plays (lessons.py MOVE_CUE). */
const MOVE_CUE = /\s*\[move\]\s*/;
/** The narration in spoken pieces: piece k is followed by demo move k while k < cues. */
export const narrationBeats = (narration = '') => narration.split(MOVE_CUE).map(piece => piece.trim());
/** The line as shown, without its cues. A beat built from recorded parts (the coach's generated
 *  lessons) reads as its own sentence. */
export const spokenText = (narration = '') => narrationBeats(narration).filter(Boolean)
  .map(beat => (beat.includes(NARRATION_PART) ? narrationText(beat).replace(/([^.!?])$/, '$1.') : beat)).join(' ');
/** The line as read in one go: a generated narration keeps its recorded parts. */
export const listenText = (narration = '') => (narration.includes(NARRATION_PART)
  ? narrationBeats(narration).filter(Boolean).join(` ${NARRATION_PART} `) : spokenText(narration));

/** "12. Nf3", "12... Nc6", or plain "Nc6" when it follows White's move. */
export function moveLabel(fen: string, index: number, san: string) {
  const [, turn, , , , full] = fen.split(' ');
  const ply = index + (turn === 'b' ? 1 : 0);
  const number = (Number(full) || 1) + Math.floor(ply / 2);
  if (ply % 2 === 0) return `${number}. ${san}`;
  return index === 0 ? `${number}... ${san}` : san;
}
