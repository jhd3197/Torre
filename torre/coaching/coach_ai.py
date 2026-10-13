"""Which AI the coach writes with: the providers on offer, each player's own API keys, and the
models a provider has for that key.

Keys live in <data>/secrets.json, readable by the owner only, and never leave the server: the
interface sees which providers have a key and its last four characters. The coach's calls pass
the key straight to Prompture (coach.ask_model), so nothing goes into the environment.
"""
import importlib
import json
import os
import re
import time
from pathlib import Path

SECRETS_FILE = 'secrets.json'
MODELS_TTL_S = 600
HOSTED_ENV = 'TORRE_HOSTED'  # set by a hosting gateway: there is no local Ollama to offer

# Prompture provider id, name, where to get a key, and models to offer when the provider
# cannot list its own (the list from the provider wins when it answers).
PROVIDERS = [
    {'id': 'ollama', 'name': 'Ollama', 'local': True, 'key_url': 'https://ollama.com/download', 'suggested': []},
    {'id': 'openai', 'name': 'OpenAI', 'key_url': 'https://platform.openai.com/api-keys',
     'suggested': ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o']},
    {'id': 'claude', 'name': 'Anthropic Claude', 'key_url': 'https://console.anthropic.com/settings/keys',
     'suggested': ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest']},
    {'id': 'google', 'name': 'Google Gemini', 'key_url': 'https://aistudio.google.com/apikey',
     'suggested': ['gemini-2.0-flash', 'gemini-1.5-flash']},
    {'id': 'groq', 'name': 'Groq', 'key_url': 'https://console.groq.com/keys', 'suggested': ['llama-3.3-70b-versatile']},
    {'id': 'openrouter', 'name': 'OpenRouter', 'key_url': 'https://openrouter.ai/keys', 'suggested': ['openai/gpt-4o-mini']},
    {'id': 'deepseek', 'name': 'DeepSeek', 'key_url': 'https://platform.deepseek.com/api_keys', 'suggested': ['deepseek-chat']},
]
BY_ID = {p['id']: p for p in PROVIDERS}
# Chat models only: a provider's list also holds embeddings, speech, images...
NOT_CHAT = ('embed', 'whisper', 'tts', 'dall-e', 'image', 'audio', 'moderation', 'realtime', 'transcribe', 'search')

_models_cache = {}
_featured_cache = {}
# The Arena's model picker: per provider, the newest current chat model of each family.
ARENA_PROVIDERS = ('claude', 'openai', 'google', 'deepseek', 'groq')
ARENA_PER_PROVIDER = 5
EFFORTS = ('low', 'medium', 'high', 'xhigh', 'max')  # what arena.AI_EFFORTS takes
_SNAPSHOT = re.compile(r'-(\d{8}|\d{4}-\d{2}-\d{2})$|-latest$|preview|-exp')


def hosted():
    return os.environ.get(HOSTED_ENV) == '1'


def _path(data_dir):
    return Path(data_dir) / SECRETS_FILE


def saved_keys(data_dir):
    try:
        keys = json.loads(_path(data_dir).read_text(encoding='utf-8')).get('keys', {})
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in keys.items() if k in BY_ID and isinstance(v, str) and v}


def save_key(data_dir, provider, key):
    """Keep `key` for `provider`, or forget it when the key is empty."""
    keys = saved_keys(data_dir)
    if key:
        keys[provider] = key
    else:
        keys.pop(provider, None)
    path = _path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps({'keys': keys}, indent=1), encoding='utf-8')
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)
    _models_cache.pop(provider, None)


def key_for(data_dir, model):
    """The saved key for a model's provider ('openai/gpt-4o-mini' -> the OpenAI key), or None."""
    provider = model.split('/', 1)[0] if isinstance(model, str) else ''
    return saved_keys(data_dir).get(provider)


def hint(key):
    return f'…{key[-4:]}' if len(key) > 8 else '…'


def _driver_class(provider):
    """Prompture's driver class for a provider, for its list_models(); None when unavailable."""
    try:
        discovery = importlib.import_module('prompture.infra.discovery')
        return discovery._get_driver_class(provider)
    except (ImportError, AttributeError):
        return None


def _chat_only(models):
    return [m for m in models if isinstance(m, str) and not any(word in m.lower() for word in NOT_CHAT)]


def list_models(provider, key):
    """Model ids the provider offers this key, newest listing within MODELS_TTL_S. Raises ValueError
    when the provider does not accept the key. Tests replace this."""
    cached = _models_cache.get(provider)
    if cached and cached['key'] == key and time.monotonic() - cached['at'] < MODELS_TTL_S:
        return list(cached['models'])
    cls = _driver_class(provider)
    try:
        models = cls.list_models(api_key=key, timeout=10) if cls else None
    except Exception as error:  # a provider's client raises its own errors for a bad key
        raise ValueError(str(error)) from error
    if models is None:
        if cls is None:
            return list(BY_ID[provider]['suggested'])
        raise ValueError('The provider did not accept this key.')
    models = sorted(set(_chat_only(models)))
    _models_cache[provider] = {'key': key, 'at': time.monotonic(), 'models': models}
    return models


def providers(data_dir, local_models):
    """What the setup screen shows: each provider, whether a key is saved (its last characters only)
    and, for Ollama, the local models. Ollama is left out where the coach runs hosted."""
    keys = saved_keys(data_dir)
    out = []
    for p in PROVIDERS:
        if p.get('local'):
            if hosted():
                continue
            out.append({'id': p['id'], 'name': p['name'], 'local': True, 'key_url': p['key_url'],
                        'models': [m.split('/', 1)[1] for m in local_models]})
            continue
        key = keys.get(p['id'])
        out.append({'id': p['id'], 'name': p['name'], 'local': False, 'key_url': p['key_url'],
                    'has_key': bool(key), 'key_hint': hint(key) if key else None, 'suggested': p['suggested']})
    return out


def _catalogue_entry(rates, provider, model_id):
    """One model from Prompture's catalogue (models.dev) as the Arena offers it, or None when it
    is not a current chat model: an image, speech or embedding model, a guard, a preview, an
    alias or dated snapshot, or a model past its prime."""
    if _SNAPSHOT.search(model_id) or any(word in model_id.lower() for word in NOT_CHAT):
        return None
    info = rates.get_model_info(provider, model_id) or {}
    life = rates.get_model_lifecycle(provider, model_id) or {}
    if (info.get('modalities') or {}).get('output') != ['text'] or not info.get('tool_call'):
        return None
    if life.get('status') != 'current' or info.get('status') in ('deprecated', 'beta', 'alpha'):
        return None
    efforts = next((o.get('values') or [] for o in info.get('reasoning_options') or [] if o.get('type') == 'effort'), [])
    cost = info.get('cost') or {}
    return {'id': f'{provider}/{model_id}', 'name': info.get('name') or model_id,
            'family': life.get('family') or info.get('family') or model_id, 'released': info.get('release_date') or '',
            'efforts': [e for e in EFFORTS if e in efforts] if info.get('reasoning') else [],
            'cost': {'input': cost.get('input'), 'output': cost.get('output')} if cost.get('input') is not None else None}


def featured_models(provider, per_provider=ARENA_PER_PROVIDER):
    """The newest current chat model of each family a provider has, newest first, at most
    per_provider, kept for MODELS_TTL_S. Empty when Prompture has no catalogue. Tests replace this."""
    cached = _featured_cache.get((provider, per_provider))
    if cached and time.monotonic() - cached[0] < MODELS_TTL_S:
        return [dict(e) for e in cached[1]]
    try:
        rates = importlib.import_module('prompture.infra.model_rates')
        entries = [e for e in (_catalogue_entry(rates, provider, m) for m in rates.get_all_provider_models(provider)) if e]
    except Exception:  # an older Prompture, or a catalogue that will not load
        return []
    newest = {}
    for entry in sorted(entries, key=lambda e: (e['released'], e['id']), reverse=True):
        newest.setdefault(entry['family'], entry)
    picked = [{k: v for k, v in e.items() if k != 'family'} for e in list(newest.values())[:per_provider]]
    _featured_cache[(provider, per_provider)] = (time.monotonic(), picked)
    return [dict(e) for e in picked]


def arena_models(data_dir, local_models):
    """The Arena's AI picker: for each provider, whether a key is saved and a short list of its
    current models (the local Ollama models for Ollama, unless the coach runs hosted)."""
    keys = saved_keys(data_dir)
    out = []
    for provider in ARENA_PROVIDERS:
        models = featured_models(provider) or [{'id': f'{provider}/{m}', 'name': m, 'released': '', 'efforts': [], 'cost': None}
                                                for m in BY_ID[provider]['suggested']]
        out.append({'id': provider, 'name': BY_ID[provider]['name'], 'local': False, 'has_key': provider in keys, 'models': models})
    if not hosted() and local_models:
        out.append({'id': 'ollama', 'name': BY_ID['ollama']['name'], 'local': True, 'has_key': True,
                    'models': [{'id': m, 'name': m.split('/', 1)[1], 'released': '', 'efforts': [], 'cost': None} for m in local_models]})
    return out
