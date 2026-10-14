"""Which model Torre uses: one default for everything, and optionally another for a feature.

Kept in data/settings.json under "ai": {"model": the default, "features": {feature: model},
"setup_seen": the one-time setup was shown}. Without a default, a model served on this computer
is picked automatically (catalogue.local_models), so Torre works with Ollama and no setup.
TORRE_AI_MODEL in the environment stands in for a default that was never saved.

Earlier versions kept the coach's model in "coach_model" and the dialog flag in
"coach_setup_seen"; they are read as the default and the flag until the first save moves them.
"""
import json
import os
from pathlib import Path

from torre.ai import catalogue, keys, runtime

FEATURES = ('coach', 'explain')  # the coach's advice; move explanations and game reviews
ENV_MODEL = 'TORRE_AI_MODEL'
LEGACY_ENV_MODEL = 'CHESS_COACH_MODEL'


def _settings(data_dir):
    try:
        data = json.loads((Path(data_dir) / 'settings.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def valid_model(model):
    """A Prompture model string worth saving: provider/name, no spaces."""
    return (isinstance(model, str) and 3 <= len(model) <= 200 and '/' in model.strip('/')
            and not any(c.isspace() for c in model))


def read(data_dir):
    """{'model', 'features', 'setup_seen'}: what the player chose (legacy keys included)."""
    return read_block(_settings(data_dir))


def apply(settings, model=..., features=None, setup_seen=None):
    """Change the "ai" block of a settings dict in place (inside appdata.update_settings). `model`
    None clears the default; a feature set to None follows the default again."""
    current = read_block(settings)
    if model is not ...:
        current['model'] = model
    for feature, chosen in (features or {}).items():
        if chosen:
            current['features'][feature] = chosen
        else:
            current['features'].pop(feature, None)
    if setup_seen is not None:
        current['setup_seen'] = bool(setup_seen)
    settings['ai'] = {k: v for k, v in current.items() if v not in (None, {}, False)}
    settings.pop('coach_model', None)
    settings.pop('coach_setup_seen', None)


def read_block(settings):
    """read() over a settings dict already loaded."""
    block = settings.get('ai') if isinstance(settings.get('ai'), dict) else {}
    model = block.get('model') if 'model' in block else settings.get('coach_model')
    features = block.get('features') if isinstance(block.get('features'), dict) else {}
    return {'model': model if valid_model(model) else None,
            'features': {f: m for f, m in features.items() if f in FEATURES and valid_model(m)},
            'setup_seen': bool(block.get('setup_seen', settings.get('coach_setup_seen')))}


def forget_provider(settings, provider):
    """Clear every choice that used a provider (its key was removed)."""
    current = read_block(settings)
    gone = lambda m: isinstance(m, str) and m.startswith(provider + '/')
    apply(settings, model=None if gone(current['model']) else current['model'],
          features={f: None for f, m in current['features'].items() if gone(m)})


def choose_model(data_dir, feature=None):
    """(model, source) for a feature: source is 'feature' (its own pick), 'default', 'auto' (a
    local model, nothing chosen) or None when there is no model at all."""
    chosen = read(data_dir)
    if feature and chosen['features'].get(feature):
        return chosen['features'][feature], 'feature'
    if chosen['model']:
        return chosen['model'], 'default'
    env = (os.environ.get(ENV_MODEL) or os.environ.get(LEGACY_ENV_MODEL) or '').strip()
    if valid_model(env):
        return env, 'default'
    if keys.hosted():
        return None, None
    found = catalogue.local_models()
    return (found[0], 'auto') if found else (None, None)


def availability(data_dir, feature=None):
    """{available, model, source, reason, setup_seen, hosted}: whether a feature can ask a model.
    reason is 'prompture_missing' or 'no_model' when it cannot."""
    model, source = choose_model(data_dir, feature)
    reason = None if runtime.prompture_installed() else 'prompture_missing'
    reason = reason or (None if model else 'no_model')
    return {'available': reason is None, 'model': model, 'source': source, 'reason': reason,
            'setup_seen': read(data_dir)['setup_seen'], 'hosted': keys.hosted()}
