import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { startPly } from '../../lib/format';
import type { AnalyzedMove, Move } from '../../types';
import { GRADE_INFO, gradeIcon, gradeOf, marked } from '../../lib/grades';
import { CursorRook } from '../CursorRook';


/** Moves in rows of two, each analyzed move marked with its grade's icon (?!, ?, ??, !!). */
export function MoveList({ initialFen, moves, cursor, onSelect, judgments }: {
  initialFen: string;
  moves: Move[];
  cursor: number;
  onSelect: (ply: number) => void;
  judgments?: Map<number, AnalyzedMove>;
}) {
  const { t } = useTranslation('board');
  const listRef = useRef<HTMLDivElement>(null);
  const first = startPly(initialFen);
  const rows = new Map<number, [ReactNode, ReactNode]>();

  moves.forEach((move, i) => {
    const ply = first + i, n = Math.floor(ply / 2) + 1;
    if (!rows.has(n)) rows.set(n, [null, null]);
    const judged = judgments?.get(i + 1);
    const grade = judged ? gradeOf(judged) : null;
    const kind = grade && marked(grade) ? grade : null;
    const description = kind ? `, ${t(`grades.${kind}.short`)}` : '';
    rows.get(n)![ply % 2] = (
      <button key={i} type="button" data-ply={i + 1} className={`${cursor === i + 1 ? 'current' : ''}${kind ? ` move-${kind}` : ''}`}
        aria-label={t('moves.goTo', { number: n, san: move.san, grade: description })} aria-current={cursor === i + 1 ? 'step' : undefined}
        onClick={() => onSelect(i + 1)}>
        {move.san}
        {kind && <img className="move-grade" src={gradeIcon(kind)} alt={GRADE_INFO[kind].symbol} width="20" height="20" />}
      </button>
    );
  });

  useEffect(() => {
    const list = listRef.current, active = list?.querySelector<HTMLElement>('.current');
    if (list && active) list.scrollTop = active.offsetTop - list.offsetTop - list.clientHeight / 2;
    else if (list && cursor === 0) list.scrollTop = 0;
  }, [cursor]);

  return (
    <div id="move-list" className="move-list" aria-label={t('moves.label')} ref={listRef}>
      {rows.size ? [...rows].map(([n, [white, black]]) => (
        <div className="move-row" key={n}><span className="move-number">{n}.</span>{white ?? <span>…</span>}{black ?? <span />}</div>
      )) : <div className="moves-empty"><CursorRook size={110} /><p className="empty-moves">{t('moves.empty')}</p></div>}
    </div>
  );
}

export function moveProgress(initialFen: string, cursor: number, total: number): string {
  const first = startPly(initialFen);
  return cursor
    ? i18n.t('board:moves.progress', { number: Math.floor((first + cursor - 1) / 2) + 1, total: Math.ceil((first + total) / 2) })
    : i18n.t('board:moves.start');
}
