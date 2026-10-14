// /settings/:section: one section per page, picked from the index; Engines has its own tests (components/EngineSettings.test.tsx).
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import i18n from '../i18n';
import { resetPieceSet } from '../lib/pieces';
import { boardTheme, settingNotes } from '../lib/settings';
import { fakeServer, renderAt } from '../test/harness';
import { anchorId } from './settings/controls';
import { SEARCH_INDEX, SETTINGS_SECTIONS } from './settings/search';

afterEach(() => {
  resetPieceSet();
  boardTheme.reset();
  for (const key of ['boardTheme', 'motion', 'uiSize', 'palette']) delete document.documentElement.dataset[key];
});

const switchNamed = (name: RegExp) => screen.getByRole('switch', { name });
const slider = (name: string) => screen.getByRole('slider', { name });
const choice = (group: string, name: string) => within(screen.getByRole('group', { name: group })).getByRole('button', { name });

test('each section is its own page, Engines included', async () => {
  fakeServer();
  const { location } = renderAt('/settings');
  const index = await screen.findByRole('navigation', { name: 'Settings sections' });
  expect(within(index).getAllByRole('link').map(link => link.textContent)).toEqual(
    ['General', 'Sidebar', 'Board & pieces', 'Sound', 'Coach & voice', 'Learning & puzzles', 'Analysis', 'AI', 'Engines', 'Accessibility', 'Data', 'About']);
  fireEvent.click(within(index).getByRole('link', { name: 'Engines' }));
  expect(location().pathname).toBe('/settings/engines');
  expect(within(index).getByRole('link', { name: 'Engines' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('heading', { level: 2, name: 'Engines' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 2, name: 'General' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
});

test('old links and unknown sections land on a section page', async () => {
  fakeServer();
  const { location } = renderAt('/settings#sound');
  await screen.findByRole('switch', { name: /Sound effects/ });
  expect(location().pathname).toBe('/settings/sound');
  const moved = renderAt('/settings/progress');
  await waitFor(() => expect(moved.location().pathname).toBe('/settings/data'));
  const language = renderAt('/settings/language');
  await waitFor(() => expect(language.location().pathname).toBe('/settings/general'));
  const unknown = renderAt('/settings/nope');
  await waitFor(() => expect(unknown.location().pathname).toBe('/settings'));
});

test('General: the language and the start page', async () => {
  fakeServer();
  renderAt('/settings');
  fireEvent.click(await screen.findByRole('button', { name: 'Español' }));
  expect(localStorage.getItem('chess-jd-language')).toBe('es');
  expect(document.documentElement.lang).toBe('es');
  expect(screen.getByRole('button', { name: 'Español' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(document.documentElement.lang).toBe('en');

  fireEvent.click(choice('Start page', 'Puzzles'));
  expect(localStorage.getItem('chess-jd-start-page')).toBe('puzzles');
});

test('Board & pieces: the piece set, the colours and how the board behaves, shown on the preview', async () => {
  fakeServer();
  renderAt('/settings/display');
  const staunton = await screen.findByRole('radio', { name: /Staunton/ });
  expect(staunton).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(screen.getByRole('radio', { name: /Classic/ }));
  expect(localStorage.getItem('chess-jd-piece-set')).toBe('classic');
  expect(screen.getByRole('radio', { name: /Classic/ })).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(screen.getByRole('radio', { name: /Walnut/ }));
  expect(document.documentElement.dataset.boardTheme).toBe('walnut');
  fireEvent.click(screen.getByRole('radio', { name: /High contrast/ }));
  expect(localStorage.getItem('chess-jd-board-theme')).toBe('contrast');
  expect(screen.getByRole('heading', { level: 3, name: 'Piece set' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Board colours' })).toBeInTheDocument();

  const preview = screen.getByRole('img', { name: /Preview of the board/ });
  expect(preview.querySelectorAll('.coordinate')).toHaveLength(16);
  expect(preview.querySelectorAll('.last-move')).toHaveLength(2);
  fireEvent.click(switchNamed(/Coordinates/));
  fireEvent.click(switchNamed(/Highlight the last move/));
  expect(preview.querySelectorAll('.coordinate')).toHaveLength(0);
  expect(preview.querySelectorAll('.last-move')).toHaveLength(0);
  expect(localStorage.getItem('chess-jd-coordinates')).toBe('0');

  fireEvent.click(choice('Move animation', 'Fast'));
  expect(localStorage.getItem('chess-jd-move-animation')).toBe('fast');
  fireEvent.click(switchNamed(/Always promote to a queen/));
  expect(localStorage.getItem('chess-jd-auto-queen')).toBe('1');
});

test('Sound: one main volume and mute over effects and music, with their own levels', async () => {
  fakeServer();
  renderAt('/settings/sound');
  fireEvent.change(await screen.findByRole('slider', { name: 'Main volume' }), { target: { value: '60' } });
  expect(localStorage.getItem('chess-jd-master-volume')).toBe('60');
  fireEvent.change(slider('Effects volume'), { target: { value: '40' } });
  expect(localStorage.getItem('chess-jd-effects-volume')).toBe('40');
  fireEvent.click(choice('Move sound', 'Soft'));
  expect(localStorage.getItem('chess-jd-move-sound')).toBe('soft');
  fireEvent.change(slider('Music volume'), { target: { value: '80' } });
  expect(localStorage.getItem('chess-jd-music-level')).toBe('80');

  fireEvent.click(switchNamed(/Background music/));
  expect(localStorage.getItem('chess-jd-music')).toBe('off');
  expect(slider('Music volume')).toBeDisabled();
  fireEvent.click(switchNamed(/Sound effects/));
  expect(localStorage.getItem('chess-jd-sound-effects')).toBe('off');
  expect(slider('Effects volume')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Play a sample' })).toBeDisabled();

  fireEvent.click(switchNamed(/Mute everything/));
  expect(localStorage.getItem('chess-jd-mute')).toBe('1');
  expect(slider('Main volume')).toBeDisabled();
  fireEvent.click(switchNamed(/Quiet in the background/));
  expect(localStorage.getItem('chess-jd-quiet-hidden')).toBe('0');
});

test('the old Low / Medium / High music volume carries over to the slider', async () => {
  vi.resetModules();
  localStorage.setItem('chess-jd-music-volume', 'medium');
  const { musicLevel } = await import('../lib/music');
  expect(musicLevel.get()).toBe(65);
  expect(localStorage.getItem('chess-jd-music-volume')).toBeNull();
});

test('Coach & voice: who speaks, how fast and how loud, captions, and when', async () => {
  fakeServer();
  renderAt('/settings/voice');
  fireEvent.click(await screen.findByRole('button', { name: 'Male' }));
  expect(localStorage.getItem('chess-jd-coach-voice')).toBe('male');
  fireEvent.click(choice('Speech speed', 'Slow'));
  expect(localStorage.getItem('chess-jd-speech-speed')).toBe('slow');
  fireEvent.change(slider('Voice volume'), { target: { value: '55' } });
  expect(localStorage.getItem('chess-jd-voice-volume')).toBe('55');
  fireEvent.click(choice('Music under the voice', 'No change'));
  expect(localStorage.getItem('chess-jd-music-dip')).toBe('none');
  fireEvent.click(switchNamed(/Captions/));
  expect(localStorage.getItem('chess-jd-captions')).toBe('1');
  fireEvent.click(switchNamed(/Narrate game reviews/));
  expect(localStorage.getItem('chess-jd-review-voice')).toBe('0');
  fireEvent.click(switchNamed(/Quiet coach/));
  expect(localStorage.getItem('chess-jd-quiet-coach')).toBe('1');
  expect(screen.getByRole('heading', { level: 3, name: 'Voice packs' })).toBeInTheDocument();

  // With the coach silent, the rest of its choices wait.
  fireEvent.click(switchNamed(/^Coach voice/));
  expect(localStorage.getItem('chess-jd-lesson-sound')).toBe('off');
  expect(slider('Voice volume')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Hear the coach' })).toBeDisabled();
});

test('Learning & puzzles: hard mode takes the help choice away', async () => {
  fakeServer();
  renderAt('/settings/learning');
  fireEvent.click(await screen.findByRole('button', { name: 'Hint only' }));
  expect(localStorage.getItem('chess-jd-puzzle-help')).toBe('hint');
  fireEvent.click(switchNamed(/Hard mode/));
  expect(choice('Puzzle help', 'Hint and solution')).toBeDisabled();
  for (const [name, key, value] of [[/Next puzzle automatically/, 'chess-jd-puzzle-auto-next', '1'], [/Show puzzle rating/, 'chess-jd-show-ratings', '0'],
    [/Blindfold puzzles/, 'chess-jd-puzzle-blindfold', '1'], [/Blindfold games/, 'chess-jd-play-blindfold', '1']] as const) {
    fireEvent.click(switchNamed(name));
    expect(localStorage.getItem(key)).toBe(value);
  }
});

test('Analysis: the helpers the boards read, the depth and the number of lines', async () => {
  fakeServer();
  renderAt('/settings/analysis');
  fireEvent.click(await screen.findByRole('switch', { name: /Best-move arrow/ }));
  expect(localStorage.getItem('chess-jd-best-arrow')).toBe('0');
  fireEvent.click(choice('Analysis depth', 'Deep'));
  expect(localStorage.getItem('chess-jd-analysis-depth')).toBe('deep');
  fireEvent.click(choice('Engine lines', '1'));
  expect(localStorage.getItem('chess-jd-engine-lines')).toBe('1');
  fireEvent.click(switchNamed(/Evaluation bar/));
  expect(localStorage.getItem('chess-jd-eval-bar')).toBe('0');
});

test('Accessibility: size, motion and colours apply to the whole page at once', async () => {
  fakeServer();
  renderAt('/settings/accessibility');
  fireEvent.click(await screen.findByRole('button', { name: 'Larger' }));
  expect(document.documentElement.dataset.uiSize).toBe('larger');
  fireEvent.click(choice('Interface size', 'Normal'));
  expect(document.documentElement.dataset.uiSize).toBeUndefined();
  fireEvent.click(choice('Animations', 'Reduced'));
  expect(document.documentElement.dataset.motion).toBe('reduce');
  fireEvent.click(choice('Arrow and highlight colours', 'Colour-blind safe'));
  expect(document.documentElement.dataset.palette).toBe('colorblind');
  fireEvent.click(switchNamed(/High-contrast board/));
  expect(document.documentElement.dataset.boardTheme).toBe('contrast');
  fireEvent.click(switchNamed(/High-contrast board/));
  expect(document.documentElement.dataset.boardTheme).toBe('forest');
  fireEvent.click(switchNamed(/Type moves/));
  expect(localStorage.getItem('chess-jd-typed-moves')).toBe('1');
});

test('Data: clearing bot stars asks first', async () => {
  fakeServer();
  localStorage.setItem('chess-jd-stars-v1', JSON.stringify({ 'baron-blunder': 3 }));
  renderAt('/settings/data');
  fireEvent.click(await screen.findByRole('button', { name: 'Clear stars' }));
  expect(localStorage.getItem('chess-jd-stars-v1')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Yes, clear stars' }));
  expect(localStorage.getItem('chess-jd-stars-v1')).toBeNull();
  expect(screen.getByText(/0 ★ earned/)).toBeInTheDocument();
});

test('Data: Reset settings puts every setting back but keeps the language and progress', async () => {
  fakeServer();
  renderAt('/settings/accessibility');
  fireEvent.click(await screen.findByRole('button', { name: 'Larger' }));
  fireEvent.click(screen.getByRole('link', { name: 'Data' }));
  localStorage.setItem('chess-jd-stars-v1', JSON.stringify({ 'baron-blunder': 3 }));
  localStorage.setItem('chess-jd-language', 'en');
  fireEvent.click(await screen.findByRole('button', { name: 'Reset settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, reset' }));
  expect(document.documentElement.dataset.uiSize).toBeUndefined();
  expect(localStorage.getItem('chess-jd-ui-size')).toBe('normal');
  expect(localStorage.getItem('chess-jd-stars-v1')).not.toBeNull();
  expect(await screen.findByText('Settings are back to their defaults.')).toBeInTheDocument();
});

test('Data: a backup file restores, and anything else is turned away', async () => {
  fakeServer();
  renderAt('/settings/data');
  const input = await screen.findByLabelText('Restore a backup');
  const file = (text: string) => new File([text], 'backup.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file('{"hello": 1}')] } });
  expect(await screen.findByText('That file is not a Torre backup.')).toBeInTheDocument();

  const saved = { app: 'torre', version: 1, saved: '2026-10-11T00:00:00Z', data: { 'chess-jd-piece-set': 'clay' } };
  fireEvent.change(input, { target: { files: [file(JSON.stringify(saved))] } });
  await waitFor(() => expect(localStorage.getItem('chess-jd-piece-set')).toBe('clay'));
});

test('the app opens on the chosen start page once, and Home stays reachable after', async () => {
  fakeServer();
  localStorage.setItem('chess-jd-start-page', 'puzzles');
  const opened = renderAt('/');
  await waitFor(() => expect(opened.location().pathname).toBe('/puzzles'));
  opened.unmount();
  const home = renderAt('/');
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(home.location().pathname).toBe('/');
});

const ABOUT = { name: 'Torre', version: '0.2.0', dataDir: 'C:\\Torre\\data', release: { title: 'Move ratings', date: '2026-10-07', summary: 'Ratings agree everywhere.' } };

test('every setting the search knows has its text in both languages and its row on its section page', async () => {
  const server = fakeServer();
  server.on('api/about', () => ABOUT);
  for (const section of SETTINGS_SECTIONS) {
    const view = renderAt(`/settings/${section}`);
    for (const entry of SEARCH_INDEX[section]) {
      const [label, note] = typeof entry === 'string' ? [entry, `${entry}Note`] : entry;
      for (const lng of ['en', 'es']) {
        expect(i18n.exists(`settings:${label}`, { lng }), `${lng} ${label}`).toBe(true);
        if (note) expect(i18n.exists(`settings:${note}`, { lng }) || i18n.exists(`settings:${note}_other`, { lng }), `${lng} ${note}`).toBe(true);
      }
      await waitFor(() => expect(document.getElementById(anchorId(label)), `${section}: ${label}`).not.toBeNull());
    }
    view.unmount();
  }
});

test('descriptions sit behind an (i) unless Show descriptions is on; a greyed-out row says why', async () => {
  fakeServer();
  renderAt('/settings/sound');
  const info = await screen.findByRole('button', { name: 'About Main volume' });
  expect(info).toHaveAttribute('data-tip', 'Turns effects, music and the coach up or down together.');
  expect(screen.queryByText('Turns effects, music and the coach up or down together.')).not.toBeInTheDocument();
  // Clicking the (i) inside a switch's label leaves the switch alone.
  fireEvent.click(screen.getByRole('button', { name: 'About Mute everything' }));
  expect(switchNamed(/Mute everything/)).not.toBeChecked();
  fireEvent.click(switchNamed(/Background music/));
  expect(screen.getByText('Only while background music is on.')).toBeInTheDocument();

  settingNotes.set(true);
  expect(await screen.findByText('Turns effects, music and the coach up or down together.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'About Main volume' })).not.toBeInTheDocument();
});

test('search finds settings in every section and opens the one picked at its row', async () => {
  fakeServer();
  const { location } = renderAt('/settings');
  const box = await screen.findByRole('searchbox', { name: 'Search settings' });
  fireEvent.change(box, { target: { value: 'volume' } });
  const results = screen.getByRole('heading', { level: 2, name: /settings match “volume”/ }).closest('section')!;
  const names = within(results).getAllByRole('link').map(link => link.querySelector('strong')!.textContent);
  expect(names).toEqual(expect.arrayContaining(['Main volume', 'Effects volume', 'Music volume', 'Voice volume']));
  expect(screen.queryByRole('heading', { level: 2, name: 'General' })).not.toBeInTheDocument();

  fireEvent.click(within(results).getByRole('link', { name: /^Music volume/ }));
  expect(location().pathname).toBe('/settings/sound');
  expect(location().hash).toBe('#setting-sound-musicVolume');
  expect(box).toHaveValue('');
  await waitFor(() => expect(document.getElementById('setting-sound-musicVolume')).toHaveClass('settings-found'));
  expect(slider('Music volume')).toHaveFocus();

  fireEvent.change(box, { target: { value: 'zzzz' } });
  expect(screen.getByRole('heading', { level: 2, name: 'No setting matches “zzzz”.' })).toBeInTheDocument();
  fireEvent.keyDown(box, { key: 'Escape' });
  expect(screen.getByRole('heading', { level: 2, name: 'Sound' })).toBeInTheDocument();
});

test('search ignores accents and matches every word', async () => {
  fakeServer();
  renderAt('/settings');
  fireEvent.click(await screen.findByRole('button', { name: 'Español' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar en los ajustes' }), { target: { value: 'musica volumen' } });
  const results = screen.getByRole('heading', { level: 2, name: /coincide/ }).closest('section')!;
  expect(within(results).getAllByRole('link').map(link => link.querySelector('strong')!.textContent)).toEqual(['Volumen general', 'Volumen de la música']);
});

test('Sidebar: reorder, hide and add pages, and the rail follows at once', async () => {
  fakeServer();
  renderAt('/settings/sidebar');
  const rail = () => within(screen.getByRole('navigation', { name: 'Studio sections' })).getAllByRole('link').map(link => link.textContent);
  await screen.findByRole('button', { name: 'Move Story up' });
  expect(rail()).toEqual(['Home', 'Story', 'Play', 'Puzzles', 'Arena', 'Coach', 'Profile']);
  expect(screen.getByRole('button', { name: 'Reset sidebar' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Move Puzzles up' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hide Arena' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Openings' }));
  expect(rail()).toEqual(['Home', 'Story', 'Puzzles', 'Play', 'Coach', 'Profile', 'Openings']);
  expect(localStorage.getItem('chess-jd-nav')).toBe('home,story,puzzles,play,coach,profile,openings');
  expect(screen.getByRole('button', { name: 'Add Arena' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Move Home up' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Move Openings down' })).toBeDisabled();

  fireEvent.click(choice('Sidebar', 'Folded'));
  expect(localStorage.getItem('chess-jd-rail-folded')).toBe('1');
  fireEvent.click(screen.getByRole('button', { name: 'Reset sidebar' }));
  expect(rail()).toEqual(['Home', 'Story', 'Play', 'Puzzles', 'Arena', 'Coach', 'Profile']);
});

test('Sidebar: the last link cannot be hidden, and a stored list it cannot read falls back', async () => {
  fakeServer();
  localStorage.setItem('chess-jd-nav', 'home,home,nope');
  renderAt('/settings/sidebar');
  expect(await screen.findByRole('button', { name: 'Hide Profile' })).toBeEnabled();
  for (const name of ['Story', 'Play', 'Puzzles', 'Arena', 'Coach', 'Profile']) fireEvent.click(screen.getByRole('button', { name: `Hide ${name}` }));
  expect(screen.getByRole('button', { name: 'Hide Home' })).toBeDisabled();
});

test('About: the version and release, the data folder, engines, shortcuts and credits', async () => {
  const server = fakeServer();
  server.on('api/about', () => ABOUT);
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  renderAt('/settings/about');
  expect(await screen.findByText('Torre 0.2.0')).toBeInTheDocument();
  expect(screen.getByText('Released 2026-10-07')).toBeInTheDocument();
  expect(screen.getByText('Ratings agree everywhere.')).toBeInTheDocument();
  expect(screen.getByText('C:\\Torre\\data')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));
  expect(writeText).toHaveBeenCalledWith('C:\\Torre\\data');
  expect(await screen.findByText('Path copied.')).toBeInTheDocument();
  expect(await screen.findByText('Stockfish')).toBeInTheDocument();
  expect(screen.getByText('Flip the board')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'CC0' })).toHaveAttribute('href', 'https://database.lichess.org/#puzzles');
});

test('About says so when the studio cannot be reached', async () => {
  fakeServer();
  renderAt('/settings/about');
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be reached');
});
