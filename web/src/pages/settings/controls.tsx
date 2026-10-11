// The building blocks of a Settings section: a row (its name on the left, its control on the right),
// an on/off switch, segmented choices, a 0-100 slider, and a subheading. A row's description sits
// behind an (i) unless "Show descriptions" is on, or the row is greyed out and the note says why.
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Segments } from '../../components/Segments';
import { settingNotes, type Setting } from '../../lib/settings';

/** The element id of a setting's row, from its label key: search results scroll to it. */
export const anchorId = (labelKey: string) => `setting-${labelKey.replace(/\./g, '-')}`;

/** The row's name, and its description: in full, or behind an (i) that shows it on hover, focus or tap.
 *  With `htmlFor`, the name is the label of that control (a switch), so clicking it flips the switch. */
function RowText({ label, note, show, htmlFor }: { label: string; note: string; show?: boolean; htmlFor?: string }) {
  const { t } = useTranslation('settings');
  const always = settingNotes.use();
  const name = htmlFor ? <label htmlFor={htmlFor}><strong>{label}</strong></label> : <strong>{label}</strong>;
  if (always || show) return <span className="settings-row-text">{name}<small>{note}</small></span>;
  return (
    <span className="settings-row-text">
      <span className="settings-row-name">
        {name}
        <button type="button" className="settings-info" aria-label={t('info', { setting: label })} data-tip={note}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 7v4.5M8 4.6v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </span>
    </span>
  );
}

export function Row({ id, label, note, disabled, keepNote, children }: {
  id?: string; label: string; note: string; disabled?: boolean; keepNote?: boolean; children: ReactNode;
}) {
  return (
    <div id={id} className={`settings-row${disabled ? ' disabled' : ''}`}>
      <RowText label={label} note={note} show={keepNote || disabled} />
      {children}
    </div>
  );
}

// The name labels the switch; the (i) sits outside that label, or a click on the name would press it instead.
export function Switch({ id, label, note, checked, disabled, onChange }: {
  id?: string; label: string; note: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void;
}) {
  const control = useId();
  return (
    <div id={id} className={`settings-row settings-switch${disabled ? ' disabled' : ''}`}>
      <RowText label={label} note={note} show={disabled} htmlFor={control} />
      <input id={control} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
    </div>
  );
}

/** A switch bound to an on/off setting, labelled from `<text>` and `<text>Note`. */
export function FlagSwitch({ setting, text, disabled }: { setting: Setting<boolean>; text: string; disabled?: boolean }) {
  const { t } = useTranslation('settings');
  return <Switch id={anchorId(text)} label={t(text)} note={t(`${text}Note`)} checked={setting.use()} disabled={disabled} onChange={setting.set} />;
}

export function Choices<T extends string>({ label, options, value, disabled, onChange }: {
  label: string; options: [T, ReactNode][]; value: T; disabled?: boolean; onChange: (value: T) => void;
}) {
  return (
    <Segments className="bots-segments settings-segments" role="group" aria-label={label}>
      {options.map(([option, content]) => (
        <button key={option} type="button" aria-pressed={option === value} className={option === value ? 'selected' : ''}
          disabled={disabled} onClick={() => onChange(option)}>{content}</button>
      ))}
    </Segments>
  );
}

/** A row of segmented choices bound to a setting: labels from `<text>`, `<text>Note` and `<group>.<value>`. */
export function ChoiceRow<T extends string>({ setting, values, text, group, disabled }: {
  setting: Setting<T>; values: readonly T[]; text: string; group: string; disabled?: boolean;
}) {
  const { t } = useTranslation('settings');
  return (
    <Row id={anchorId(text)} label={t(text)} note={t(`${text}Note`)} disabled={disabled}>
      <Choices label={t(text)} options={values.map(value => [value, t(`${group}.${value}`)])} value={setting.use()}
        disabled={disabled} onChange={setting.set} />
    </Row>
  );
}

/** A 0-100 level (a volume) as a slider with its value beside it. */
export function LevelRow({ setting, text, disabled, children }: { setting: Setting<number>; text: string; disabled?: boolean; children?: ReactNode }) {
  const { t } = useTranslation('settings');
  const value = setting.use();
  return (
    <Row id={anchorId(text)} label={t(text)} note={t(`${text}Note`)} disabled={disabled}>
      <span className="settings-level">
        <input type="range" min={0} max={100} step={5} value={value} aria-label={t(text)} disabled={disabled}
          aria-valuetext={`${value}%`} onChange={e => setting.set(Number(e.target.value))}
          style={{ ['--level' as string]: `${value}%` }} />
        <output>{value}%</output>
        {children}
      </span>
    </Row>
  );
}

/** A small heading that splits a long section into parts. */
export const Subheading = ({ id, children }: { id?: string; children: ReactNode }) => <h3 id={id} className="settings-subheading">{children}</h3>;
