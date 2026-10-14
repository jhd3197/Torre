"""Routes for the coach: its view of your play, the home page plan, the skill ledger, and its
words on a whole game. Which model it writes with is Settings > AI's (api_ai.py)."""
from torre.analysis import analyze
from torre.server import appdata
from torre.coaching import coach
from torre.coaching import coach_home
from torre.coaching import coach_ledger
from torre.coaching import explain
from torre.server.routes import NotFound, Routes, Unavailable

ROUTES = Routes()


@ROUTES.get('/api/coach')
def view(req):
    return coach.view(appdata.DATA_DIR, req.lang, appdata.current_stats())


@ROUTES.post('/api/coach')
def regenerate(req):
    return coach.regenerate(appdata.DATA_DIR, req.lang, appdata.current_stats())


@ROUTES.get('/api/coach/home')
def home(req):
    return coach_home.home(appdata.DATA_DIR, req.lang, award=appdata.award_profile_xp)


@ROUTES.get('/api/coach/ledger')
def ledger(req):
    return {'skills': list(coach_ledger.cached(appdata.DATA_DIR).values())}


@ROUTES.post('/api/coach/focus')
def focus(req):
    coach_home.act(appdata.DATA_DIR, req.payload)
    return coach_home.home(appdata.DATA_DIR, req.lang, award=appdata.award_profile_xp)


@ROUTES.post('/api/coach/session')
def session(req):
    return {'slug': coach_home.session(appdata.DATA_DIR, str(req.payload.get('skill') or ''))}


@ROUTES.post('/api/coach/game')
def game(req):
    game_id = str(req.payload.get('id') or '')
    record = appdata.game_record(game_id)
    analysis = appdata.analysis_record(game_id, analyze.SCORING_VERSION)
    if not record or not analysis:
        raise NotFound('Analyze this game first.')
    try:
        return explain.answer(appdata.DATA_DIR, 'game', {'game': game_id, 'scoring': analyze.SCORING_VERSION},
                              lambda: explain.game_facts(record, analysis), req.lang,
                              cached_only=bool(req.payload.get('cachedOnly')))
    except RuntimeError as exc:  # no coach model to ask
        raise Unavailable(str(exc)) from exc
