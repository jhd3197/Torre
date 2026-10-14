"""Routes for Torre's AI (torre/ai): the providers and their keys, the models on offer, which
model Torre uses, installing Prompture, and a quick test of a model. Settings > AI is built on
GET /api/ai; the coach, explanations and the Arena ask /api/ai/status whether a model is ready."""
import contextlib

from torre.ai import calls, catalogue, config, keys, runtime
from torre.server import appdata
from torre.server import jobs
from torre.server.access import admin
from torre.server.routes import BadRequest, Routes

ROUTES = Routes()


def _chosen_models(data_dir, chosen):
    """What the catalogue knows about each model in use, for names and efforts in the interface."""
    found = [m for m in (chosen['model'], *chosen['features'].values()) if m]
    return {m: catalogue.describe(m) for m in found} if runtime.prompture_installed() else {}


def view(data_dir):
    """Everything Settings > AI shows."""
    installed = runtime.prompture_installed()
    chosen = config.read(data_dir)
    model, source = config.choose_model(data_dir)
    features = {f: dict(zip(('model', 'source'), config.choose_model(data_dir, f))) for f in config.FEATURES}
    return {
        'hosted': keys.hosted(),
        'prompture': {'installed': installed, 'version': runtime.prompture_version(), 'install': runtime.INSTALL.status()},
        'desk': runtime.desk() if installed and not keys.hosted() else {'running': False, 'version': None},
        'providers': catalogue.providers(data_dir) if installed else [],
        'settings': chosen,
        'model': model, 'source': source, 'features': features,
        'models': _chosen_models(data_dir, {'model': model, 'features': {f: v['model'] for f, v in features.items()}}),
    }


@ROUTES.get('/api/ai')
def ai_view(req):
    return view(appdata.DATA_DIR)


@ROUTES.get('/api/ai/status')
def ai_status(req):
    feature = req.arg('feature') or None
    if feature is not None and feature not in config.FEATURES:
        raise BadRequest('Unknown AI feature.')
    return config.availability(appdata.DATA_DIR, feature)


def _provider(value):
    known = {p['id'] for p in catalogue.providers(appdata.DATA_DIR)} | set(catalogue.CLOUD)
    if value not in known:
        raise BadRequest('Unknown AI provider.')
    return value


@ROUTES.get('/api/ai/models')
def ai_models(req):
    """Every model a provider offers you (its full list for your key), or the featured ones when
    the key is refused."""
    provider = _provider(req.arg('provider'))
    try:
        return {'models': catalogue.provider_models(appdata.DATA_DIR, provider)}
    except ValueError:
        return {'models': catalogue.featured_models(provider), 'error': 'key'}


def _check_key(provider, key):
    """'valid', 'unverified' or 'unchecked' for a key the provider did not refuse; raises BadRequest
    when it did."""
    try:
        from prompture.infra.provider_keys import validate_key
    except ImportError:
        try:
            from prompture.cli.setup_cmd import validate_key
        except ImportError:
            validate_key = None
    if validate_key is not None:
        result = validate_key(provider, key)
        if result.status == 'invalid':
            raise BadRequest(f'{catalogue.CLOUD.get(provider, (provider,))[0]} did not accept that key. Check it and try again.')
        return result.status
    try:
        catalogue._listed(provider, key)
    except ValueError as error:
        raise BadRequest(f'{catalogue.CLOUD.get(provider, (provider,))[0]} did not accept that key. Check it and try again.') from error
    return 'valid'


@ROUTES.post('/api/ai/key')
def ai_key(req):
    """Save a provider's key once the provider accepts it; an empty key forgets it, and every
    choice that used the provider."""
    provider = _provider(req.payload.get('provider'))
    if provider not in keys.key_vars() and provider not in catalogue.CLOUD:
        raise BadRequest('This provider does not take an API key.')
    key = req.payload.get('key')
    key = key.strip() if isinstance(key, str) else ''
    if any(c.isspace() for c in key) or len(key) > 400:
        raise BadRequest('That does not look like an API key.')
    check = _check_key(provider, key) if key else None
    keys.save_key(appdata.DATA_DIR, provider, key)
    catalogue.clear()
    if not key:
        appdata.update_settings(lambda s: config.forget_provider(s, provider))
    return {**view(appdata.DATA_DIR), 'check': check}


@ROUTES.post('/api/ai/settings')
def ai_settings(req):
    """Choose the default model ({"model": "provider/name"}, null for the automatic pick) and a
    model per feature ({"features": {"coach": ...}}, null to follow the default)."""
    payload = req.payload
    changes = {}
    if 'model' in payload:
        model = payload['model']
        if model is not None and not config.valid_model(model):
            raise BadRequest('A model looks like provider/name, for example ollama/qwen3:8b.')
        changes['model'] = model
    features = payload.get('features')
    if features is not None:
        if not isinstance(features, dict) or not set(features) <= set(config.FEATURES):
            raise BadRequest(f'"features" takes {", ".join(config.FEATURES)}.')
        if any(m is not None and not config.valid_model(m) for m in features.values()):
            raise BadRequest('A model looks like provider/name, for example ollama/qwen3:8b.')
        changes['features'] = features
    appdata.update_settings(lambda s: config.apply(s, **changes))
    return view(appdata.DATA_DIR)


@ROUTES.post('/api/ai/test')
def ai_test(req):
    model = req.payload.get('model')
    if not config.valid_model(model):
        raise BadRequest('A model looks like provider/name, for example ollama/qwen3:8b.')
    return calls.test(model, appdata.DATA_DIR)


@ROUTES.get('/api/ai/usage')
def ai_usage(req):
    return {'usage': runtime.usage()}


@ROUTES.post('/api/ai/install')
@admin
def ai_install(req):
    with contextlib.suppress(jobs.JobBusy):  # already installing
        runtime.INSTALL.start(appdata.DATA_DIR)
    return view(appdata.DATA_DIR)


@ROUTES.post('/api/ai/seen')
def ai_seen(req):
    """The one-time setup dialog was shown; do not offer it again."""
    appdata.update_settings(lambda s: config.apply(s, setup_seen=True))
    return config.availability(appdata.DATA_DIR)
