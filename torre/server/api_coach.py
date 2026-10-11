"""Routes for the coach: its view of your play, the home page plan, the skill ledger, the
model it writes with, and its words on a whole game."""
import contextlib

from torre.analysis import analyze
from torre.server import appdata
from torre.coaching import coach
from torre.coaching import coach_ai
from torre.coaching import coach_home
from torre.coaching import coach_ledger
from torre.coaching import explain
from torre.server import jobs
from torre.server.access import admin
from torre.server.routes import BadRequest, NotFound, Routes, Unavailable

ROUTES = Routes()


@ROUTES.get('/api/coach')
def view(req):
    return coach.view(appdata.DATA_DIR, req.lang, appdata.current_stats())


@ROUTES.post('/api/coach')
def regenerate(req):
    return coach.regenerate(appdata.DATA_DIR, req.lang, appdata.current_stats())


@ROUTES.get('/api/coach/status')
def status(req):
    return coach.availability(appdata.DATA_DIR)


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


@ROUTES.post('/api/coach/install')
@admin
def install(req):
    with contextlib.suppress(jobs.JobBusy):  # already installing
        coach.INSTALL.start(appdata.DATA_DIR)
    return coach.view(appdata.DATA_DIR, req.lang, appdata.current_stats(), auto=False)


@ROUTES.post('/api/coach/model')
def model(req):
    # An empty model goes back to the automatic pick (a local Ollama model).
    chosen = req.payload.get('model') or ''
    chosen = chosen.strip() if isinstance(chosen, str) else None
    if chosen is None or (chosen and not coach.valid_model(chosen)):
        raise BadRequest('A model looks like provider/name, for example ollama/qwen3:8b.')
    appdata.update_settings(lambda s: s.__setitem__('coach_model', chosen) if chosen else s.pop('coach_model', None))
    return coach.view(appdata.DATA_DIR, req.lang, appdata.current_stats())


def _ai_view():
    found = coach.availability(appdata.DATA_DIR)
    return {'providers': coach_ai.providers(appdata.DATA_DIR, coach.local_models()),
            'model': found['model'], 'auto': found['auto'], 'setup_seen': found['setup_seen'], 'hosted': found['hosted']}


def _provider(req):
    provider = req.payload.get('provider')
    if provider not in coach_ai.BY_ID or (coach_ai.BY_ID[provider].get('local') and coach_ai.hosted()):
        raise BadRequest('Unknown AI provider.')
    return provider


@ROUTES.get('/api/coach/ai')
def ai(req):
    return _ai_view()


@ROUTES.post('/api/coach/ai/models')
def ai_models(req):
    """The models a provider offers: Ollama's local ones, or the list for the saved key."""
    provider = _provider(req)
    if coach_ai.BY_ID[provider].get('local'):
        return {'models': [m.split('/', 1)[1] for m in coach.local_models()]}
    key = coach_ai.saved_keys(appdata.DATA_DIR).get(provider)
    if not key:
        return {'models': []}
    try:
        return {'models': coach_ai.list_models(provider, key)}
    except ValueError:
        return {'models': coach_ai.BY_ID[provider]['suggested'], 'error': 'key'}


@ROUTES.post('/api/coach/ai/key')
def ai_key(req):
    """Save a provider's key once the provider accepts it; an empty key forgets it (and its model)."""
    provider = _provider(req)
    key = req.payload.get('key')
    key = key.strip() if isinstance(key, str) else ''
    if any(c.isspace() for c in key) or len(key) > 400:
        raise BadRequest('That does not look like an API key.')
    models = []
    if key:
        try:
            models = coach_ai.list_models(provider, key)
        except ValueError:
            raise BadRequest(f'{coach_ai.BY_ID[provider]["name"]} did not accept that key. Check it and try again.')
    coach_ai.save_key(appdata.DATA_DIR, provider, key)
    if not key:
        appdata.update_settings(lambda s: s.pop('coach_model', None) if str(s.get('coach_model', '')).startswith(provider + '/') else None)
    return {**_ai_view(), 'models': models}


@ROUTES.post('/api/coach/ai/seen')
def ai_seen(req):
    """The one-time setup dialog was shown; do not offer it again."""
    appdata.update_settings(lambda s: s.__setitem__('coach_setup_seen', True))
    return _ai_view()


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
