// /settings/:section: one section at a time, picked from the index on the left, or found with the
// search box above it. /settings opens the first; /engines lands on Engines. The bigger sections
// live in ./settings/, and ./settings/search.ts lists every row for the search.
import { AiSetup } from '../components/AiSetup';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { language, LANGUAGE_NAMES, LANGUAGES } from '../i18n';
import {
  ANALYSIS_DEPTHS, analysisDepth, announceMoves, autoAnalysis, bestArrow, boardTheme, ENGINE_LINES, engineLines, evalBar, hardMode,
  MOTION_CHOICES, motion, motionReduced, nextArrow, PALETTES, palette, playBlindfold, PUZZLE_HELP, puzzleAutoNext, puzzleBlindfold, puzzleHelp,
  settingNotes, showRatings, squareControl, START_PAGES, startPage, typedMoves, UI_SIZES, uiSize,
} from '../lib/settings';
import { AnalysisEngineChoice, EngineSettings } from '../components/EngineSettings';
import { Flag } from '../components/Flag';
import { useAnalysis, useToast } from '../state/AppData';
import { settingsPath } from '../lib/routes';
import { anchorId, ChoiceRow, Choices, FlagSwitch, Row, Switch } from './settings/controls';
import { BoardSection } from './settings/BoardSection';
import { SoundSection, VoiceSection } from './settings/SoundSections';
import { DataSection } from './settings/DataSection';
import { SidebarSection } from './settings/SidebarSection';
import { AboutSection } from './settings/AboutSection';
import { searchSettings, SETTINGS_SECTIONS, type SearchHit, type SectionId } from './settings/search';
import { isPhoneSection, PhoneSettingsHome, PhoneSettingsSection } from './settings/PhoneSettings';
import { usePhone } from '../hooks/usePhone';

const isSection = (id: string | undefined): id is SectionId => SETTINGS_SECTIONS.includes(id as SectionId);
/** Sections that were renamed or folded into another, so old links still land. */
const MOVED: Record<string, SectionId> = { language: 'general', progress: 'data' };
const sectionFor = (id: string | undefined): SectionId | null => (isSection(id) ? id : id && MOVED[id]) || null;
/** How long a row found by search stays highlighted. */
const FOUND_MS = 1600;

const PANELS: Record<SectionId, () => ReactNode> = {
  general: () => <GeneralSection />,
  sidebar: () => <SidebarSection />,
  display: () => <BoardSection />,
  sound: () => <SoundSection />,
  voice: () => <VoiceSection />,
  learning: () => <LearningSection />,
  analysis: () => <AnalysisSection />,
  ai: () => <AiSetup />,
  engines: () => <EngineSettings />,
  accessibility: () => <AccessibilitySection />,
  data: () => <DataSection />,
  about: () => <AboutSection />,
};

export function SettingsPage() {
  const { t } = useTranslation('settings');
  const { section: param } = useParams();
  const { hash } = useLocation();
  const [query, setQuery] = useState('');
  const phone = usePhone();

  useEffect(() => {
    document.body.dataset.page = 'settings';
    return () => { document.body.dataset.page = 'board'; };
  }, []);

  // A search result opens its section at #setting-…: scroll the row into view, light it up, and put
  // the keyboard on its control.
  useEffect(() => {
    if (!hash.startsWith('#setting-')) return;
    const row = document.getElementById(hash.slice(1));
    if (!row) return;
    row.scrollIntoView?.({ block: 'center', behavior: motionReduced() ? 'auto' : 'smooth' });
    row.querySelector<HTMLElement>('input, select, button:not(.settings-info)')?.focus({ preventScroll: true });
    row.classList.add('settings-found');
    const timer = setTimeout(() => row.classList.remove('settings-found'), FOUND_MS);
    return () => { clearTimeout(timer); row.classList.remove('settings-found'); };
  }, [hash, param]);

  // Old links (/settings#engines, /settings/progress) and unknown sections land on a real section page.
  const legacy = sectionFor(hash.slice(1));
  if (!param && legacy) return <Navigate to={settingsPath(legacy)} replace />;
  if (param !== undefined && !isSection(param)) return <Navigate to={settingsPath(sectionFor(param) ?? undefined)} replace />;
  const section: SectionId = param ?? SETTINGS_SECTIONS[0];

  // A phone opens on the list of sections, and each section is a page of its own.
  if (phone) {
    if (param && !isPhoneSection(section)) return <Navigate to={settingsPath()} replace />;
    return (
      <section id="settings" className="settings phone-settings" aria-label={t('label')}>
        {param && isPhoneSection(section) ? <PhoneSettingsSection id={section}>{PANELS[section]()}</PhoneSettingsSection> : (
          <PhoneSettingsHome
            search={(
              <label className="phone-search">
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input type="search" className="settings-search" value={query} aria-label={t('search.label')} placeholder={t('search.placeholder')}
                  onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setQuery(''); }} />
              </label>
            )}
            results={query.trim() ? <SearchResults query={query} onPick={() => setQuery('')} /> : undefined} />
        )}
      </section>
    );
  }

  return (
    <section id="settings" className="settings" aria-label={t('label')}>
      <div className="settings-head">
        <h1>{t('title')}</h1>
        <input type="search" className="settings-search" value={query} aria-label={t('search.label')} placeholder={t('search.placeholder')}
          onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setQuery(''); }} />
      </div>
      <nav className="settings-index" aria-label={t('index')}>
        {SETTINGS_SECTIONS.map(id => (
          <Link key={id} to={settingsPath(id)} aria-current={!query && id === section ? 'page' : undefined}
            onClick={() => setQuery('')}>{t(`${id}.title`)}</Link>
        ))}
      </nav>

      <div className="settings-sections">
        {query.trim()
          ? <SearchResults query={query} onPick={() => setQuery('')} />
          : <Group key={section} id={section}>{PANELS[section]()}</Group>}
      </div>
    </section>
  );
}

/** One card of the page, titled from `<id>.title`. */
function Group({ id, children }: { id: SectionId; children: ReactNode }) {
  const { t } = useTranslation('settings');
  return (
    <section id={`settings-${id}`} className="settings-group" aria-labelledby={`settings-${id}-title`}>
      <h2 id={`settings-${id}-title`}>{t(`${id}.title`)}</h2>
      {children}
    </section>
  );
}

/** What the search box found: each setting with its section, linking straight to its row. */
function SearchResults({ query, onPick }: { query: string; onPick: () => void }) {
  const { t } = useTranslation('settings');
  const hits = searchSettings(t, query);
  const where = (hit: SearchHit) => `${settingsPath(hit.section)}${hit.labelKey ? `#${anchorId(hit.labelKey)}` : ''}`;
  return (
    <section className="settings-group settings-results" aria-labelledby="settings-results-title">
      <h2 id="settings-results-title" aria-live="polite">
        {hits.length ? t('search.found', { count: hits.length, query: query.trim() }) : t('search.none', { query: query.trim() })}
      </h2>
      {hits.length > 0 && (
        <ul>
          {hits.map(hit => (
            <li key={`${hit.section}-${hit.labelKey}`}>
              <Link to={where(hit)} onClick={onPick}>
                <strong>{hit.label}</strong>
                <small>{hit.labelKey ? t(`${hit.section}.title`) : t('search.section')}{hit.note ? ` · ${hit.note}` : ''}</small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GeneralSection() {
  const { t } = useTranslation('settings');
  const lang = language.use();
  return (
    <>
      <Row id={anchorId('language.title')} label={t('language.title')} note={t('language.note')}>
        <Choices label={t('language.title')} options={LANGUAGES.map(code => [code, <><Flag lang={code} size={20} /><span lang={code}>{LANGUAGE_NAMES[code]}</span></>])}
          value={lang} onChange={code => language.set(code)} />
      </Row>
      <ChoiceRow setting={startPage} values={START_PAGES} text="general.startPage" group="general.start" />
      <FlagSwitch setting={settingNotes} text="general.notes" />
    </>
  );
}

function LearningSection() {
  // Hard mode offers no help at all, so the help choice waits until it is off.
  const hard = hardMode.use();
  return (
    <>
      <FlagSwitch setting={hardMode} text="learning.hard" />
      <ChoiceRow setting={puzzleHelp} values={PUZZLE_HELP} text="learning.help" group="learning.helps" disabled={hard} />
      <FlagSwitch setting={puzzleAutoNext} text="learning.autoNext" />
      <FlagSwitch setting={showRatings} text="learning.ratings" />
      <FlagSwitch setting={puzzleBlindfold} text="learning.blindfold" />
      <FlagSwitch setting={playBlindfold} text="learning.playBlindfold" />
    </>
  );
}

function AnalysisSection() {
  const { analysis, setAutoAnalysis } = useAnalysis();
  const toast = useToast();
  const { t } = useTranslation('settings');
  return (
    <>
      <Switch id={anchorId('analysis.background')} label={t('analysis.background')} note={t('analysis.backgroundNote')} checked={analysis?.auto ?? true}
        onChange={on => { setAutoAnalysis(on).catch((e: Error) => toast(e.message)); }} />
      <FlagSwitch setting={autoAnalysis} text="analysis.auto" />
      <AnalysisEngineChoice />
      <ChoiceRow setting={analysisDepth} values={ANALYSIS_DEPTHS} text="analysis.depth" group="analysis.depths" />
      <ChoiceRow setting={engineLines} values={ENGINE_LINES} text="analysis.lines" group="analysis.lineCounts" />
      <FlagSwitch setting={evalBar} text="analysis.evalBar" />
      <FlagSwitch setting={bestArrow} text="analysis.best" />
      <FlagSwitch setting={nextArrow} text="analysis.next" />
      <FlagSwitch setting={squareControl} text="analysis.control" />
    </>
  );
}

function AccessibilitySection() {
  const { t } = useTranslation('settings');
  const contrast = boardTheme.use() === 'contrast';
  return (
    <>
      <ChoiceRow setting={uiSize} values={UI_SIZES} text="accessibility.size" group="accessibility.sizes" />
      <ChoiceRow setting={motion} values={MOTION_CHOICES} text="accessibility.motion" group="accessibility.motions" />
      <Switch id={anchorId('accessibility.contrast')} label={t('accessibility.contrast')} note={t('accessibility.contrastNote')} checked={contrast}
        onChange={on => boardTheme.set(on ? 'contrast' : boardTheme.fallback)} />
      <ChoiceRow setting={palette} values={PALETTES} text="accessibility.palette" group="accessibility.palettes" />
      <FlagSwitch setting={announceMoves} text="accessibility.announce" />
      <FlagSwitch setting={typedMoves} text="accessibility.typed" />
    </>
  );
}
