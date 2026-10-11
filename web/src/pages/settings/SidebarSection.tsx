// Sidebar: which pages sit in the rail and in what order (drag, or the arrows), the pages that can be
// added, and whether the rail starts folded. Settings stays in the account menu, so any link can go.
import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { assetUrl } from '../../lib/base';
import { DEFAULT_NAV, hiddenNavItems, moveNavItem, NAV_ITEMS, navOrder, placeNavItem } from '../../lib/nav';
import { railFolded } from '../../lib/settings';
import { anchorId, Choices, Row, Subheading } from './controls';

const RAIL_CHOICES = ['', '0', '1'] as const;
const RAIL_LABELS = { '': 'auto', 0: 'open', 1: 'folded' } as const;
const iconOf = (key: string) => ({ '--icon': `url(${assetUrl(NAV_ITEMS.find(item => item.key === key)!.icon)})` } as CSSProperties);

const arrow = (d: string) => <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const grip = (
  <svg className="settings-nav-grip" aria-hidden="true" width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
    {[3, 8, 13].flatMap(y => [<circle key={`a${y}`} cx="3.5" cy={y} r="1.4" />, <circle key={`b${y}`} cx="8.5" cy={y} r="1.4" />])}
  </svg>
);

export function SidebarSection() {
  const { t } = useTranslation('settings');
  const { t: nav } = useTranslation('nav');
  const order = navOrder.use().split(',');
  const rail = railFolded.use();
  const [dragging, setDragging] = useState<string | null>(null);
  const save = (keys: string[]) => navOrder.set(keys.join(','));
  const hidden = hiddenNavItems(order);

  function drop(before: string | null) {
    if (dragging) save(placeNavItem(order, dragging, before));
    setDragging(null);
  }

  return (
    <>
      <Subheading id={anchorId('sidebar.shown')}>{t('sidebar.shown')}</Subheading>
      <p className="settings-section-note">{t('sidebar.shownNote')}</p>
      <ol className="settings-nav-list" aria-label={t('sidebar.shown')}
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); drop(null); }}>
        {order.map((key, i) => {
          const name = nav(`rail.${key}`);
          return (
            <li key={key} className={`settings-nav-item${dragging === key ? ' dragging' : ''}`} draggable
              onDragStart={e => { setDragging(key); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); }}
              onDragEnd={() => setDragging(null)}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); e.stopPropagation(); drop(key); }}>
              {grip}
              <span className="settings-nav-icon" style={iconOf(key)} aria-hidden="true" />
              <span className="settings-nav-name">{name}</span>
              <span className="settings-nav-actions">
                <button type="button" className="icon-button" aria-label={t('sidebar.up', { name })} disabled={i === 0}
                  onClick={() => save(moveNavItem(order, key, -1))}>{arrow('m6 15 6-6 6 6')}</button>
                <button type="button" className="icon-button" aria-label={t('sidebar.down', { name })} disabled={i === order.length - 1}
                  onClick={() => save(moveNavItem(order, key, 1))}>{arrow('m6 9 6 6 6-6')}</button>
                <button type="button" className="text-button" aria-label={t('sidebar.hideNamed', { name })} disabled={order.length === 1}
                  onClick={() => save(order.filter(k => k !== key))}>{t('sidebar.hide')}</button>
              </span>
            </li>
          );
        })}
      </ol>

      <Subheading id={anchorId('sidebar.hidden')}>{t('sidebar.hidden')}</Subheading>
      {hidden.length ? (
        <ul className="settings-nav-list" aria-label={t('sidebar.hidden')}>
          {hidden.map(item => {
            const name = nav(`rail.${item.key}`);
            return (
              <li key={item.key} className="settings-nav-item off">
                <span className="settings-nav-icon" style={iconOf(item.key)} aria-hidden="true" />
                <span className="settings-nav-name">{name}</span>
                <span className="settings-nav-actions">
                  <button type="button" className="text-button" aria-label={t('sidebar.addNamed', { name })}
                    onClick={() => save([...order, item.key])}>{t('sidebar.add')}</button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : <p className="settings-section-note">{t('sidebar.allShown')}</p>}

      <Subheading>{t('sidebar.behaviour')}</Subheading>
      <Row id={anchorId('sidebar.rail')} label={t('sidebar.rail')} note={t('sidebar.railNote')}>
        <Choices label={t('sidebar.rail')} options={RAIL_CHOICES.map(choice => [choice, t(`sidebar.rails.${RAIL_LABELS[choice]}`)])}
          value={rail} onChange={choice => railFolded.set(choice)} />
      </Row>
      <Row id={anchorId('sidebar.reset')} label={t('sidebar.reset')} note={t('sidebar.resetNote')}>
        <button type="button" className="button" disabled={order.join(',') === DEFAULT_NAV.join(',')}
          onClick={() => navOrder.set(navOrder.fallback)}>{t('sidebar.reset')}</button>
      </Row>
    </>
  );
}
