"""Routes for the game archive: listing and opening games, downloads, importing, the background
analysis, Insights and Stats, and the first-run setup."""
import contextlib
import io
import json
import logging

import chess
import chess.pgn

import torre
from torre.analysis import analyze
from torre.server import appdata
from torre.analysis import board_view
from torre.analysis import bot_report
from torre.coaching import coach_home
from torre.analysis import engine_service
from torre.analysis import limits
from torre.analysis import game_export
from torre.analysis import game_rating
from torre.games import importer
from torre.server import jobs
from torre import jsonio
from torre.analysis import pgn_export
from torre.learning import puzzles
from torre import translations
from torre.server.routes import BadRequest, NotFound, Response, Routes

ROUTES = Routes()
IMPORT_JOB = importer.JOB
MINE_EVERY = 10  # games analyzed between two mining passes
# The background analysis asks for half the cores (the engine budget may give it fewer while
# the board's own engines are busy), leaving the rest for them and the browser.
BACKGROUND_THREADS = max(1, limits.total_threads() // 2)
SUMMARY_FIELDS = ('id', 'date', 'opponent', 'user_color', 'user_result', 'user_rating', 'opp_rating', 'plies', 'user_accuracy', 'type')


@ROUTES.get('/api/games')
def games(req):
    summaries = [{k: g.get(k) for k in SUMMARY_FIELDS} for g in appdata.records('games.jsonl')]
    summaries.sort(key=lambda g: g.get('date') or '', reverse=True)
    return {'games': summaries, 'engine': engine_service.ENGINE_PATH.exists()}


def _game(game_id):
    game = appdata.game_record(game_id)
    if not game:
        raise NotFound('Game not found.')
    return game


@ROUTES.get('/api/games/(?P<rest>.*)/coach')
def game_coach(req):
    return coach_home.game(appdata.DATA_DIR, req.path.split('/')[-2], req.lang)


@ROUTES.get('/api/games/(?P<rest>.*)/export')
def game_download(req):
    game_id = req.path.split('/')[-2]
    game = _game(game_id)
    report = game_export.game_report(game['pgn'], appdata.analysis_record(game_id), record=game)
    data = (json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')
    return Response.file(data, 'application/json; charset=utf-8',
                         disposition=f'attachment; filename="{game_export.filename(report)}"')


@ROUTES.get('/api/games/(?P<rest>.*)/pgn')
def game_pgn(req):
    game_id = req.path.split('/')[-2]
    game = _game(game_id)
    text = pgn_export.annotated_pgn(game['pgn'], appdata.analysis_record(game_id))
    name = pgn_export.filename(chess.pgn.read_game(io.StringIO(text)).headers)
    return Response.file(text.encode(), 'application/x-chess-pgn; charset=utf-8', disposition=f'attachment; filename="{name}"')


@ROUTES.get('/api/games/(?P<rest>.*)')
def game_detail(req):
    game_id = req.path.rsplit('/', 1)[-1]
    game = _game(game_id)
    analysis = appdata.analysis_record(game_id)
    detail = board_view.with_clocks(board_view.parse_pgn(game['pgn']), game)
    card = _phase_card(detail, game, analysis)
    return {**detail, 'record': game, 'analysis': analysis, 'phases': card and card['phases'],
            'phase_starts': card and card['starts'], 'rating': game_rating.for_game(game, analysis) if analysis else None}


def _phase_card(detail, game, analysis):
    """Accuracy, errors and a grade by phase for you ('you') and your opponent ('bot'), and the
    ply each phase starts at, from the stored evals (bot_report.report); None until analysed."""
    evals = (analysis or {}).get('evals') or []
    ucis = [m['uci'] for m in detail['moves']]
    if game.get('user_color') not in ('white', 'black') or len(evals) != len(ucis) + 1:
        return None
    try:
        return bot_report.report(detail['initialFen'], ucis, game['user_color'], evals, grades=analysis.get('move_grades'))
    except (ValueError, TypeError):
        return None


@ROUTES.get('/api/insights')
def insights(req):
    return appdata.current_insights()


@ROUTES.get('/api/stats')
def stats(req):
    return appdata.current_stats()


@ROUTES.post('/api/import')
def import_pgn(req):
    return board_view.parse_pgn(req.payload.get('pgn', ''))


@ROUTES.post('/api/export')
def export_game(req):
    payload = req.payload
    game = chess.pgn.Game.from_board(board_view.position(payload))
    headers = payload.get('headers') or {}
    for key in ('White', 'Black', 'Date', 'Result', 'TimeControl', 'Termination'):
        if key in headers:
            value = headers[key]
            if not isinstance(value, str) or len(value) > 200 or any(c in value for c in '\r\n"'):
                raise BadRequest('Invalid game header.')
            game.headers[key] = value
    report = game_export.game_report(str(game) + '\n', timings=payload.get('timings'),
                                     record={'user_color': payload.get('playerColor')})
    return {'filename': game_export.filename(report), 'report': report}


# --- the background analysis ----------------------------------------------------------

def _archive():
    return appdata.DATA_DIR / 'games.jsonl', appdata.DATA_DIR / 'analysis.jsonl'


class AnalysisJob(jobs.BackgroundJob):
    """Analyzes the archive's pending games (analyze.analyze_archive), mining puzzles as it goes."""
    busy_message = 'The analysis is already running.'
    label = 'The background analysis'

    def __init__(self):
        super().__init__({'running': False, 'total': 0, 'done': 0, 'failed': 0, 'current': None, 'error': None})
        self.stopped_by_user = False

    def status(self):
        state = super().status()
        if not state['running']:
            games, _, outdated = analyze.pending(*_archive())
            state.update(remaining=len(games), outdated=outdated)
        state['engine'] = engine_service.ENGINE_PATH.exists()
        return state

    def start(self):
        if not engine_service.ENGINE_PATH.exists():
            raise ValueError('Stockfish is not installed.')
        games, _, _ = analyze.pending(*_archive())
        self.launch({'running': True, 'total': len(games), 'done': 0, 'failed': 0, 'current': None, 'error': None}, games)
        self.stopped_by_user = False

    def stop(self):
        super().stop()
        self.stopped_by_user = True  # no automatic restart until the user starts it again

    def work(self, games):
        analyze.analyze_archive(games, engine_service.ENGINE_PATH, *_archive(), puzzles.MINE_FILE,
                                threads=BACKGROUND_THREADS, batch=MINE_EVERY, progress=self._progress,
                                on_mine=self._mined, should_stop=lambda: self.stopping)

    def finished(self):
        self.update(current=None)

    def _progress(self, index, game, result, error):
        with self.lock:
            self.state['done'] = index
            self.state['failed'] += 1 if error else 0
            self.state['current'] = {'opponent': game.get('opponent'), 'date': game.get('date')}

    def _mined(self, stage, value):
        """Turning the new analyses into puzzles from the player's own games (my_puzzles.py)."""
        if stage == 'start':
            self.update(current={'mining': True})
        elif stage == 'failed':  # a failed mine never hides the analysis itself
            logging.getLogger(__name__).error('Mining puzzles from the new analyses failed', exc_info=value)
            self.update(mine_error=str(value) or type(value).__name__)
        else:
            pack, mined = value
            with self.lock:
                self.state['puzzles_mined'] = self.state.get('puzzles_mined', 0) + mined
                self.state['my_puzzles'] = len(pack['puzzles'])
                self.state['current'] = None


ANALYSIS_JOB = AnalysisJob()


def auto_enabled():
    """Whether new games are analyzed without a click: the host allows it and the player's
    setting is on. "Analyze all" works either way."""
    return limits.background_analysis() and appdata.read_settings().get('auto_analyze') is not False


def auto_analyze():
    """Start analyzing unanalyzed games in the background, unless turned off in settings or by
    TORRE_BACKGROUND_ANALYSIS=0 (a shared host), already running, stopped by the user this session, or without Stockfish. True when it started."""
    if not auto_enabled() or ANALYSIS_JOB.stopped_by_user or not engine_service.ENGINE_PATH.exists():
        return False
    if ANALYSIS_JOB.busy() or not analyze.pending(*_archive())[0]:
        return False
    try:
        ANALYSIS_JOB.start()
    except jobs.JobBusy:
        return False
    return True


# --- importing --------------------------------------------------------------------------

def import_view(status, lang):
    """The import job for the page, with each unreadable game's reason in the page's language."""
    return {**status, 'failed': [{**f, 'error': translations.message(f.get('error'), lang)} for f in status.get('failed', [])]}


@ROUTES.get('/api/import/status')
def import_status(req):
    return import_view(IMPORT_JOB.status(), req.lang)


@ROUTES.post('/api/import/fetch')
def import_fetch(req):
    payload = req.payload
    IMPORT_JOB.fetch(payload.get('source'), payload.get('username'), payload.get('since'),
                     _archive()[0], on_success=appdata.remember_account)
    return import_view(IMPORT_JOB.status(), req.lang)


@ROUTES.post('/api/import/files')
def import_files(req):
    """Parse uploaded files into the import preview, or ask which player you are."""
    payload = req.payload
    files = payload.get('files')
    if not isinstance(files, list) or not files or not all(isinstance(f, dict) and isinstance(f.get('text'), str) for f in files):
        raise importer.ImportProblem('Choose a PGN file or paste a game.')
    if IMPORT_JOB.busy():
        raise jobs.JobBusy(IMPORT_JOB.busy_message)
    me = payload.get('me')
    if isinstance(me, str) and me.strip():
        appdata.remember_alias(me.strip())
    names = appdata.my_names()
    pgn_text = '\n'.join(f['text'] for f in files if not f['text'].lstrip().startswith('{'))
    players = importer.pgn_players(pgn_text)
    if players and not any(name.lower() in names for name, _ in players):
        status = {**IMPORT_JOB.status(), 'phase': 'choose', 'players': [{'name': n, 'games': c} for n, c in players[:12]]}
        return import_view(status, req.lang)
    records, failed = [], []
    for f in files:
        found, broken = importer.read_file(str(f.get('name') or 'file'), f['text'], names)
        records += found
        failed += broken
    if not records and not failed:
        raise importer.ImportProblem('No games were found in this file.')
    IMPORT_JOB.load(records, failed, _archive()[0], source='file')
    return import_view(IMPORT_JOB.status(), req.lang)


@ROUTES.post('/api/import/link')
def import_link(req):
    """One game from its chess.com or Lichess link, saved to the library: its id, to open its
    review, or the two players when the page must ask which one you were."""
    payload = req.payload
    me = payload.get('me')
    accounts = appdata.setup_state()['accounts']
    try:
        record = importer.link_game(payload.get('url'), appdata.my_names(), me, accounts.get('chesscom'))
    except importer.ChooseSide as choose:
        return {'choose': choose.players}
    if isinstance(me, str) and me.strip():
        appdata.remember_alias(me.strip())
    added, _ = importer.append([record], _archive()[0])
    if added:
        auto_analyze()
    return {'id': record['id'], 'added': bool(added)}


@ROUTES.post('/api/import/commit')
def import_commit(req):
    ids = req.payload.get('ids')
    if not isinstance(ids, list):
        raise BadRequest('"ids" must be a list.')
    result = IMPORT_JOB.commit(ids, _archive()[0])
    if result.get('added'):
        auto_analyze()  # new games become drills and puzzles without a click
    return import_view(result, req.lang)


@ROUTES.post('/api/import/cancel')
def import_cancel(req):
    IMPORT_JOB.cancel()
    return import_view(IMPORT_JOB.status(), req.lang)


@ROUTES.get('/api/analysis')
def analysis_status(req):
    return {**ANALYSIS_JOB.status(), 'auto': auto_enabled()}


@ROUTES.post('/api/analysis/start')
def analysis_start(req):
    with contextlib.suppress(jobs.JobBusy):  # already running: the page just shows it
        ANALYSIS_JOB.start()
    return ANALYSIS_JOB.status()


@ROUTES.post('/api/analysis/stop')
def analysis_stop(req):
    ANALYSIS_JOB.stop()
    return ANALYSIS_JOB.status()


@ROUTES.post('/api/settings/auto-analyze')
def auto_analyze_setting(req):
    enabled = req.payload.get('enabled')
    appdata.update_settings(lambda s: s.__setitem__('auto_analyze', bool(enabled)))
    if enabled:
        auto_analyze()
    return {**ANALYSIS_JOB.status(), 'auto': auto_enabled()}


@ROUTES.get('/api/setup')
def setup(req):
    return appdata.setup_state()


@ROUTES.post('/api/setup')
def setup_answer(req):
    appdata.update_settings(lambda s: s.__setitem__('onboarded', bool(req.payload.get('onboarded', True))))
    return appdata.setup_state()


def release_notes(text):
    """The newest release in RELEASE_NOTES.md: its title, date and opening paragraph."""
    lines = text.splitlines()
    heading = next((line[2:].strip() for line in lines if line.startswith('# ')), '')
    title, _, date = heading.partition(' — ')
    start = next((i for i, line in enumerate(lines) if line.startswith('# ')), len(lines)) + 1
    paragraph = []
    for line in lines[start:]:
        if line.startswith('#') or (not line.strip() and paragraph):
            break
        if line.strip():
            paragraph.append(line.strip())
    return {'title': title.strip(), 'date': date.strip() or None, 'summary': ' '.join(paragraph)}


@ROUTES.get('/api/about')
def about(req):
    """Settings → About: the app's version, where its data lives, and what the latest release changed."""
    notes = appdata.ROOT / 'RELEASE_NOTES.md'  # in a source checkout; an installed package has none
    return {
        'name': 'Torre', 'version': torre.__version__, 'dataDir': str(appdata.DATA_DIR),
        'release': release_notes(notes.read_text(encoding='utf-8')) if notes.exists() else None,
    }
