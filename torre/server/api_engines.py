"""Routes for engines (install, custom binaries, models, option profiles), the legends' games
and the engine Arena."""
import chess.engine

from torre.server import appdata
from torre.games import arena
from torre.analysis import engines
from torre.learning import ladder
from torre.ai import catalogue
from torre.games import masters
from torre.server.access import admin
from torre.server.routes import BadRequest, Conflict, NotFound, Routes

ROUTES = Routes()


def _engine_id(req):
    return str(req.payload.get('engineId') or '')


@ROUTES.get('/api/engines')
def catalog(req):
    return {'engines': engines.catalog()}


@ROUTES.get('/api/engines/profiles')
def profiles(req):
    return {'profiles': engines.load_profiles()}


@ROUTES.get('/api/engines/profile')
def profile(req):
    # One engine's saved options, with the options its binary reports to edit them against.
    engine_id = req.arg('engineId')
    if engines.get(engine_id) is None:
        raise BadRequest(f'Unknown engine: {engine_id}.')
    try:
        reported = engines.reported_options(engine_id)
    except (chess.engine.EngineError, OSError):
        reported = None
    return {'engineId': engine_id, 'options': engines.get_profile(engine_id), 'reported': reported}


@ROUTES.post('/api/engines/profile')
def save_profile(req):
    engine_id = _engine_id(req)
    options = engines.save_profile(engine_id, req.payload.get('options'))
    return {'engineId': engine_id, 'options': options, 'profiles': engines.load_profiles()}


@ROUTES.post('/api/engines/profile/delete')
def delete_profile(req):
    engines.delete_profile(_engine_id(req))
    return {'profiles': engines.load_profiles()}


@ROUTES.get('/api/engines/install')
def install_status(req):
    return engines.INSTALL_JOB.status()


@ROUTES.post('/api/engines/install')
@admin
def install(req):
    try:
        engines.INSTALL_JOB.start(_engine_id(req))
    except engines.InstallError as exc:  # already installed (another download running is a JobBusy, also 409)
        raise Conflict(str(exc)) from exc
    return engines.INSTALL_JOB.status()


@ROUTES.post('/api/engines/models/install')
@admin
def install_model(req):
    try:
        engines.INSTALL_JOB.start_model(_engine_id(req), str(req.payload.get('modelId') or ''))
    except engines.InstallError as exc:
        raise Conflict(str(exc)) from exc
    return engines.INSTALL_JOB.status()


# engines.InstallError from the routes below is a 400 (see studio.answer).
@ROUTES.post('/api/engines/uninstall')
@admin
def uninstall(req):
    engines.uninstall(_engine_id(req))
    return {'engines': engines.catalog()}


@ROUTES.post('/api/engines/models/uninstall')
@admin
def uninstall_model(req):
    engines.uninstall_model(_engine_id(req), str(req.payload.get('modelId') or ''))
    return {'engines': engines.catalog()}


@ROUTES.post('/api/engines/custom')
@admin
def add_custom(req):
    entry = engines.add_custom_engine(req.payload.get('name'), req.payload.get('path'))
    return {'engine': entry, 'engines': engines.catalog()}


@ROUTES.post('/api/engines/custom/delete')
@admin
def remove_custom(req):
    engines.remove_custom_engine(_engine_id(req))
    return {'engines': engines.catalog()}


def _masters():
    return {'masters': masters.available(), 'missing': masters.missing(), 'fill': masters.fill_status()}


@ROUTES.get('/api/masters')
def masters_view(req):
    return _masters()


@ROUTES.post('/api/masters/prepare')
def master_prepare(req):
    return {'master': masters.profile(str(req.payload.get('id') or ''))}


@ROUTES.post('/api/masters/download')
def master_download(req):
    masters.download(str(req.payload.get('id') or ''))
    return _masters()


@ROUTES.get('/api/arena')
def arena_view(req):
    return {**arena.JOB.status(), 'recent': arena.JOB.recent()}


@ROUTES.get('/api/arena/ladder')
def arena_ladder(req):
    return ladder.load_ladder(appdata.DATA_DIR)


@ROUTES.get('/api/arena/models')
def arena_models(req):
    """The AI models the Arena offers, by provider: the ones ready to play (a key saved, a server
    running, a CLI signed in) and the cloud ones still waiting for a key (catalogue.providers)."""
    return {'providers': [{'id': p['id'], 'name': p['name'], 'local': p['kind'] != 'cloud', 'has_key': p['ready'], 'models': p['models']}
                          for p in catalogue.providers(appdata.DATA_DIR) if p['models'] and (p['ready'] or p['kind'] == 'cloud')]}


@ROUTES.get('/api/arena/matches/(?P<rest>.*)')
def arena_match(req):
    match = arena.JOB.saved(req.path.rsplit('/', 1)[-1])
    if match is None:
        raise NotFound('Match not found.')
    return match


@ROUTES.post('/api/arena/start')
def arena_start(req):
    return {**arena.JOB.start(req.payload, appdata.DATA_DIR), 'recent': arena.JOB.recent()}


@ROUTES.post('/api/arena/stop')
def arena_stop(req):
    arena.JOB.stop()
    return {**arena.JOB.status(), 'recent': arena.JOB.recent()}
