// App shell: collapsible navigation rail, top bar, dialogs and the toast.
import { Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatches, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog';
import { PageLoading } from './PageLoading';
import { TooltipLayer } from './Tooltip';
import { useRail } from './rail/useRail';
import { assetUrl } from '../lib/base';
import { useGameData, useToastMessage } from '../state/AppData';
import { PAGE_ART } from '../lib/art';
import { PageTitleContext, type PageTitle } from '../hooks/usePageTitle';
import { TopbarSlotsContext, type TopbarSlots } from './TopbarSlot';
import { useNavItems, type NavItem } from '../lib/nav';
import { initials, useHostedAccount, type HostedAccount } from '../hooks/useHostedAccount';
import { usePhone } from '../hooks/usePhone';

/** `topbar: false` drops the shared top bar: the page's own hero or header is
 *  its title, so it owns the page's h1. `phone` does the same on a phone only, where
 *  a page with its own phone header can also give its whole height to itself (no tab bar). */
export interface RouteHandle {
  title: string;
  actions?: ('import' | 'new-game' | 'help')[];
  topbar?: boolean;
  phone?: { topbar?: boolean; tabbar?: boolean };
}

/** The phone's tab bar: the five places a thumb goes most. The rest are a tap away from Home and Profile. */
const TABS: NavItem[] = [
  { to: '/', key: 'home', icon: 'art/nav/home.png', end: true },
  { to: '/play/bots', key: 'play', icon: 'art/nav/play.png', match: '/play' },
  { to: '/story', key: 'story', icon: 'art/nav/explore.png', match: '/story' },
  { to: '/puzzles', key: 'puzzles', icon: 'art/nav/puzzles.png', match: '/puzzles' },
  { to: '/profile', key: 'profile', icon: 'art/nav/awards.png', match: '/profile' },
];


// Anything a click on the rail should leave alone: links, controls, menus.
const INTERACTIVE = 'a, button, input, select, textarea, label, [role="menu"], [role="menuitem"]';

const chevronsRight = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 6 6-6 6" /><path d="m12 6 6 6-6 6" /></svg>
);
const chevronsLeft = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 6-6 6 6 6" /><path d="m12 6-6 6 6 6" /></svg>
);
const closeCross = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 5l14 14M19 5 5 19" /></svg>
);

/** A popover anchored to its trigger; Escape or a click elsewhere closes it. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: globalThis.MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return { open, setOpen, ref };
}

/** The bottom of the rail: who you are, plus importing a game — everything
 *  else that belongs to the player lives on the Profile page now. */
function WorkspaceMenu({ folded, name, account, onImport }: { folded: boolean; name: string; account: HostedAccount | null; onImport: () => void }) {
  const { t } = useTranslation('nav');
  const { open, setOpen, ref } = usePopover();
  const close = () => setOpen(false);
  return (
    <div className="rail-pop" ref={ref}>
      <button
        type="button"
        className="rail-user"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={folded ? t('workspace.labelFor', { name }) : undefined}
        data-tip={folded && !open ? name : undefined}
        data-tip-side="right"
      >
        <span className="rail-avatar" aria-hidden="true">{initials(name)}</span>
        <span className="rail-user-name">{name}</span>
        <svg className="rail-caret" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5" /></svg>
      </button>
      {open && (
        <div className={`rail-menu ${folded ? 'rail-menu-beside' : 'rail-menu-above'}`} role="menu" aria-label={t('workspace.label')}>
          <NavLink to="/profile" role="menuitem" className="rail-menu-item" onClick={close}>{t('rail.profile')}</NavLink>
          <NavLink to="/settings" role="menuitem" className="rail-menu-item" onClick={close}>{t('rail.settings')}</NavLink>
          <div className="rail-menu-rule" role="separator" />
          <button type="button" role="menuitem" className="rail-menu-item" onClick={() => { close(); onImport(); }}>{t('import.title')}</button>
          {account && <>
            <div className="rail-menu-rule" role="separator" />
            {/* Plain links: the sign-in gateway answers these, not the app's router. */}
            {account.admin && <a href="admin" role="menuitem" className="rail-menu-item">{t('rail.admin')}</a>}
            <a href="logout" role="menuitem" className="rail-menu-item">{t('rail.signOut')}</a>
          </>}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { t } = useTranslation('nav');
  const toastMessage = useToastMessage();
  const { insights } = useGameData();
  const matches = useMatches();
  const handle = [...matches].reverse().find(m => (m.handle as RouteHandle | undefined)?.title)?.handle as RouteHandle | undefined;
  const actions = handle?.actions ?? [];
  const navigate = useNavigate();
  const location = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const { narrow, collapsed, drawer, toggle, openDrawer, closeDrawer } = useRail();
  const phone = usePhone();
  // The links and their order are the player's (Settings → Sidebar); see lib/nav.ts.
  const nav = useNavItems();
  const account = useHostedAccount();
  const name = account?.name || insights?.user || 'Player';
  const folded = collapsed && !narrow;
  const [pageTitle, setPageTitle] = useState<PageTitle | null>(null);
  // Spots in the top bar a page can fill (TopbarSlot): a back link in the title's place, tools beside Help.
  const [slots, setSlots] = useState<TopbarSlots>({ lead: null, tools: null });
  const leadRef = useCallback((lead: HTMLElement | null) => setSlots(s => s.lead === lead ? s : { ...s, lead }), []);
  const toolsRef = useCallback((tools: HTMLElement | null) => setSlots(s => s.tools === tools ? s : { ...s, tools }), []);
  // Route titles stay English in the route table (PAGE_ART keys off them); they are translated here.
  const section = handle?.title ? t(`titles.${handle.title}`, { defaultValue: handle.title }) : t('brand');
  const pageArt = pageTitle?.art ?? (handle?.title ? PAGE_ART[handle.title] : undefined);

  // Any empty part of the rail — anything that is not a link or a control —
  // opens or folds it on a click, unless text is being selected.
  const onRailClick = (e: MouseEvent<HTMLElement>) => {
    if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
    if (window.getSelection?.()?.toString()) return;
    toggle();
  };

  const navItem = (item: NavItem) => (
    <NavLink
      key={item.key}
      to={item.to}
      end={item.end}
      viewTransition
      className={({ isActive }) => `rail-item${(item.match ? location.pathname.startsWith(item.match) : isActive) ? ' active' : ''}`}
      style={{ '--icon': `url(${assetUrl(item.icon)})` } as CSSProperties}
      data-tip={folded ? t(`rail.${item.key}`) : undefined}
      data-tip-side="right"
    >
      <span className="rail-icon" aria-hidden="true" />
      <span className="rail-text">{t(`rail.${item.key}`)}</span>
    </NavLink>
  );

  const closeLabel = narrow ? t('rail.closeMenu') : t('rail.fold');
  const showTopbar = handle?.topbar !== false && !(phone && handle?.phone?.topbar === false);
  const showTabbar = phone && handle?.phone?.tabbar !== false;

  const tabItem = (item: NavItem) => {
    const active = item.match ? location.pathname.startsWith(item.match) : location.pathname === item.to;
    return (
      <NavLink key={item.key} to={item.to} end={item.end} viewTransition className={`tab-item${active ? ' active' : ''}`}
        aria-current={active ? 'page' : undefined} style={{ '--icon': `url(${assetUrl(item.icon)})` } as CSSProperties}>
        <span className="tab-icon" aria-hidden="true" />
        <span>{t(`rail.${item.key}`)}</span>
      </NavLink>
    );
  };

  return (
    <div className="shell" data-rail={phone ? 'tabs' : narrow ? 'drawer' : folded ? 'folded' : 'open'} data-drawer-open={drawer ? 'true' : undefined}
      data-tabbar={showTabbar ? 'true' : undefined}>
      {!phone && <aside className="rail-shell" data-folded={folded ? 'true' : 'false'} onClick={onRailClick}>
        <div className="rail-head">
          {folded ? (
            // Folded, the logo is the way back: it turns into the expand icon
            // as soon as the pointer is anywhere over the rail.
            <button
              type="button"
              className="rail-logo-toggle"
              onClick={toggle}
              aria-label={t('rail.expand')}
              aria-expanded="false"
              data-tip={`${t('rail.expand')}  [`}
              data-tip-side="right"
            >
              <img className="rail-logo" src="art/logo/mark.png" alt="" width="26" height="26" />
              <span className="rail-open-icon">{chevronsRight}</span>
            </button>
          ) : (
            <>
              <Link className="rail-brand" to="/" aria-label={t('rail.brandHome')} onClick={narrow ? closeDrawer : undefined}>
                <img className="rail-logo" src="art/logo/mark.png" alt="" width="30" height="30" />
                <span className="rail-brand-text">
                  <span className="rail-brand-name">{t('brand')}</span>
                </span>
              </Link>
              <button
                type="button"
                className="rail-head-btn"
                onClick={toggle}
                aria-label={closeLabel}
                aria-expanded="true"
                data-tip={narrow ? closeLabel : `${closeLabel}  [`}
              >
                {narrow ? closeCross : chevronsLeft}
              </button>
            </>
          )}
        </div>
        <nav className="rail-nav" aria-label={t('rail.sections')}>{nav.map(navItem)}</nav>
        <div className="rail-foot">
          <WorkspaceMenu folded={folded} name={name} account={account} onImport={() => { if (narrow) closeDrawer(); navigate('/import'); }} />
        </div>
      </aside>}
      {drawer && !phone && <button type="button" className="rail-backdrop" aria-label={t('rail.closeNavigation')} onClick={closeDrawer} />}
      <main>
        {narrow && !phone && (
          <div className="rail-menubar">
            <button type="button" className="rail-burger" aria-label={t('rail.openMenu')} onClick={openDrawer}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <img className="rail-menubar-logo" src="art/logo/app-icon-64.png" alt="" width="24" height="24" />
            <span>{t('brand')}</span>
          </div>
        )}
        {showTopbar && <header className="topbar">
          <h1 id="page-title">
            {pageArt && <img className="page-art" src={pageArt} alt="" width="40" height="40" />}
            {pageTitle ? (
              <>
                <Link className="page-crumb" to={`/${location.pathname.split('/')[1]}`}>{section}</Link>
                <span className="page-crumb-sep" aria-hidden="true">/</span>
                <span>{pageTitle.title}</span>
              </>
            ) : section}
          </h1>
          <div className="topbar-lead" ref={leadRef} />
          <div className="header-actions">
            {actions.includes('new-game') && <button className="button" id="choose-bot" type="button" onClick={() => navigate('/play/bots')}>{t('actions.newGame')}</button>}
            {actions.includes('import') && <button className="button import-trigger" type="button" onClick={() => navigate('/import')}>{t('import.title')}</button>}
            <div className="topbar-tools" ref={toolsRef} />
            <button className="icon-button" id="show-help" type="button" title={t('help.title')} aria-label={t('help.title')} onClick={() => setHelpOpen(true)}><img src="art/ui3d/help.webp" alt="" width="22" height="22" /></button>
          </div>
        </header>}
        <PageTitleContext.Provider value={setPageTitle}>
          <TopbarSlotsContext.Provider value={slots}>
            <Suspense fallback={<PageLoading />}><Outlet /></Suspense>
          </TopbarSlotsContext.Provider>
        </PageTitleContext.Provider>
      </main>
      {showTabbar && <nav className="tabbar" aria-label={t('rail.sections')}>{TABS.map(tabItem)}</nav>}
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <div id="toast" role="status" className={toastMessage ? 'visible' : ''}>{toastMessage}</div>
      <TooltipLayer />
    </div>
  );
}

const HELP_ITEMS = ['move', 'castle', 'plan', 'squareControl', 'analysis', 'moveMarks', 'clear', 'navigate', 'links'] as const;

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('nav');
  return (
    <Dialog id="help-dialog" open={open} onClose={onClose}>
      <div className="dialog-heading"><h2><img className="dialog-art" src="art/ui3d/info.webp" alt="" width="36" height="36" />{t('help.title')}</h2><button type="button" className="icon-button" id="close-help" aria-label={t('help.close')} onClick={onClose}>×</button></div>
      <dl className="controls-list">{HELP_ITEMS.map(key => [<dt key={key}>{t(`help.items.${key}.term`)}</dt>, <dd key={`${key}-d`}>{t(`help.items.${key}.text`)}</dd>])}</dl>
    </Dialog>
  );
}
