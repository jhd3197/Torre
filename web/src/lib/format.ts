import i18n from '../i18n';
import type { EngineLine } from '../types';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const displayDate = (value?: string | null) => value && !value.startsWith('1970') ? value.replaceAll('.', ' / ') : i18n.t('common:date.undated');

export const formatNumber = (value: number | null | undefined) =>
  Number.isFinite(value) ? new Intl.NumberFormat(i18n.language || 'en').format(value as number) : '–';

type Score = Pick<EngineLine, 'cp' | 'mate'>;

export function scoreLabel(line: Score): string {
  return line.mate !== null && line.mate !== undefined
    ? `${line.mate > 0 ? '+' : '−'}M${Math.abs(line.mate)}`
    : `${line.cp >= 0 ? '+' : ''}${(line.cp / 100).toFixed(2)}`;
}

export function describeEval(line: Score): string {
  if (line.mate !== null && line.mate !== undefined) {
    return i18n.t(`common:eval.${line.mate > 0 ? 'white' : 'black'}Mate`, { count: Math.abs(line.mate) });
  }
  if (Math.abs(line.cp) < 35) return i18n.t('common:eval.even');
  const side = line.cp >= 0 ? 'white' : 'black';
  return i18n.t(`common:eval.${side}${Math.abs(line.cp) < 150 ? 'Slightly' : 'Better'}`);
}

/** Height of White's share of the evaluation bar, in percent. */
export const evalFill = (cp: number) => Math.max(3, Math.min(97, 50 + 47 * Math.tanh(cp / 450)));

/** Plies already played before a FEN's position (0 for the standard start). */
export function startPly(fen: string): number {
  const parts = fen.split(' ');
  return (Number(parts[5] || 1) - 1) * 2 + (parts[1] === 'b' ? 1 : 0);
}

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60000);
  // The words come from the translation files (so English keeps its short "in 5 min" form);
  // the number is formatted for the current language.
  const at = (key: string, count: number) => i18n.t(`common:relative.${key}`, { count, value: formatNumber(count) });
  if (minutes < 1) return i18n.t('common:relative.moment');
  if (minutes < 60) return at('minutes', minutes);
  if (minutes < 60 * 36) return at('hours', Math.round(minutes / 60));
  return at('days', Math.round(minutes / 1440));
}

export const sideToMove = (fen: string): 'white' | 'black' => fen.split(' ')[1] === 'b' ? 'black' : 'white';
