// The review's summary as a table: one row per grade, a column per player, accuracy on top.
import { useTranslation } from 'react-i18next';
import { GRADES, gradeIcon, type Grade } from '../lib/grades';

export interface GradeColumn {
  name: string;
  accuracy?: number | null;
  counts: Record<Grade, number>;
}

export function GradeTable({ columns }: { columns: GradeColumn[] }) {
  const { t } = useTranslation('games');
  return (
    <table className="grade-table" aria-label={t('game.summary')}>
      <thead>
        <tr>
          <th scope="col" aria-label={t('game.gradeTable.grade')} />
          {columns.map(column => <th key={column.name} scope="col">{column.name}</th>)}
        </tr>
      </thead>
      <tbody>
        <tr className="grade-table-accuracy">
          <th scope="row">{t('game.gradeTable.accuracy')}</th>
          {columns.map(column => <td key={column.name}>{column.accuracy != null ? `${column.accuracy}%` : '–'}</td>)}
        </tr>
        {GRADES.map(grade => (
          <tr key={grade} className={`move-${grade}`} title={t(`board:grades.${grade}.message`)}>
            <th scope="row"><span className="grade-name"><img src={gradeIcon(grade)} alt="" />{t(`game.gradeTable.${grade}`)}</span></th>
            {columns.map(column => (
              <td key={column.name} className={column.counts[grade] ? undefined : 'none'}>{column.counts[grade]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
