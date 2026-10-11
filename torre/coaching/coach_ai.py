"""Which AI the coach writes with: the providers on offer, each player's own API keys, and the
models a provider has for that key.

Keys live in <data>/secrets.json, readable by the owner only, and never leave the server: the
interface sees which providers have a key and its last four characters. The coach's calls pass
the key straight to Prompture (coach.ask_model), so nothing goes into the environment.
"""
import importlib
import json
import os
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
