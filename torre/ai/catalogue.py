"""Which AI providers Torre offers, whether each is ready, and their models.

Three kinds of provider:
- cloud: a provider you reach with an API key (keys.py). Featured models come from Prompture's
  catalogue (models.dev): per provider, the newest current chat model of each family, with its
  price and the reasoning efforts it takes. With a key saved, the provider's full list is one
  request away (provider_models).
- local: a model server on this computer (Ollama, LM Studio), free and private. Prompture checks
  which are running and what they serve.
- login: a coding-agent CLI you are signed in to (Claude Code, Codex), used as a model through
  Prompture's claude-code/ and codex/ drivers: your subscription, no API key.

Where Torre is hosted (keys.hosted()), only cloud providers are offered.
"""
import importlib
import json
import os
import re
import time

from torre import net
from torre.ai import keys

TTL_S = 600        # the catalogue and the providers' own lists
LOCAL_TTL_S = 30   # local servers come and go
PER_PROVIDER = 5
EFFORTS = ('low', 'medium', 'high', 'xhigh', 'max')  # the efforts Torre offers (arena.AI_EFFORTS)

# Cloud providers in the order Torre lists them, with where to get a key. Any other provider
# Prompture knows is listed after these once it has a key.
CLOUD = {
    'claude': ('Anthropic Claude', 'https://console.anthropic.com/settings/keys'),
    'openai': ('OpenAI', 'https://platform.openai.com/api-keys'),
    'google': ('Google Gemini', 'https://aistudio.google.com/apikey'),
    'grok': ('xAI Grok', 'https://console.x.ai'),
    'deepseek': ('DeepSeek', 'https://platform.deepseek.com/api_keys'),
    'mistral': ('Mistral', 'https://console.mistral.ai/api-keys'),
    'groq': ('Groq', 'https://console.groq.com/keys'),
    'openrouter': ('OpenRouter', 'https://openrouter.ai/keys'),
    'moonshot': ('Moonshot Kimi', 'https://platform.moonshot.ai/console/api-keys'),
}
# OpenRouter resells hundreds of models: feature only the main labs'.
OPENROUTER_LABS = ('anthropic/', 'openai/', 'google/', 'x-ai/', 'deepseek/', 'mistralai/', 'qwen/', 'moonshotai/', 'meta-llama/')
LOCAL = {'ollama': ('Ollama', 'https://ollama.com/download'), 'lmstudio': ('LM Studio', 'https://lmstudio.ai')}
LOGINS = {
    'claude-code': ('Claude Code', 'https://claude.com/claude-code', 'ClaudeCodeDriver'),
    'codex': ('Codex', 'https://developers.openai.com/codex/cli', 'CodexDriver'),
}
LOGIN_MODELS = {
    'claude-code': [('default', 'Claude Code (its default)'), ('opus', 'Claude Code · Opus'), ('sonnet', 'Claude Code · Sonnet'), ('haiku', 'Claude Code · Haiku')],
    'codex': [('default', 'Codex (its default)')],
}
LOGIN_EFFORTS = {'claude-code': [], 'codex': ['low', 'medium', 'high', 'xhigh']}
# An automatic local pick prefers these model families, in order, then any other chat model.
PREFERRED = ('qwen3', 'llama3', 'gemma3', 'mistral', 'phi4', 'gemma', 'llama')
SPECIALIZED = ('-vl', 'coder', 'cline', 'tools', '-base', 'embed')  # picked only when nothing general is served
NOT_CHAT = ('embed', 'whisper', 'tts', 'dall-e', 'image', 'audio', 'moderation', 'realtime', 'transcribe', 'search', 'guard', 'rerank')
_SNAPSHOT = re.compile(r'-(\d{8}|\d{4}-\d{2}-\d{2})$|-latest$|preview|-exp')

_cache = {}


def _cached(key, ttl, build):
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    value = build()
    _cache[key] = (time.monotonic(), value)
    return value


def clear():
    _cache.clear()


def entry(model_id, name, provider, *, released='', efforts=(), cost=None):
    """One model as the interface shows it."""
    return {'id': model_id, 'name': name, 'provider': provider, 'released': released,
            'efforts': list(efforts), 'cost': cost}


# ---- the catalogue (cloud models) ------------------------------------------------

def _rates():
    return importlib.import_module('prompture.infra.model_rates')


def _info(rates, provider, model_id):
    """A current chat model from the catalogue as an entry (with its family), or None: an image,
    speech or embedding model, a guard, a preview, an alias or dated snapshot, or one past its prime."""
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
    return {**entry(f'{provider}/{model_id}', info.get('name') or model_id, provider, released=info.get('release_date') or '',
                    efforts=[e for e in EFFORTS if e in efforts] if info.get('reasoning') else [],
                    cost={'input': cost.get('input'), 'output': cost.get('output')} if cost.get('input') is not None else None),
            'family': life.get('family') or info.get('family') or model_id}


def featured_models(provider, limit=PER_PROVIDER):
    """The newest current chat model of each family a cloud provider has, newest first. Empty
    when Prompture has no catalogue. Tests replace this."""
    def build():
        try:
            rates = _rates()
            ids = rates.get_all_provider_models(provider)
            if provider == 'openrouter':
                ids = [m for m in ids if m.startswith(OPENROUTER_LABS)]
            entries = [e for e in (_info(rates, provider, m) for m in ids) if e]
        except Exception:  # an older Prompture, or a catalogue that will not load
            return []
        newest = {}
        for item in sorted(entries, key=lambda e: (e['released'], e['id']), reverse=True):
            newest.setdefault(item['family'], item)
        return [{k: v for k, v in e.items() if k != 'family'} for e in list(newest.values())[:limit]]
    return [dict(e) for e in _cached(('featured', provider, limit), TTL_S, build)]


def describe(model):
    """What the catalogue knows about a model string, as an entry (a bare one when it knows nothing)."""
    provider, _, name = model.partition('/')
    if provider in LOGINS:
        label = dict(LOGIN_MODELS.get(provider, [])).get(name) or f'{LOGINS[provider][0]} · {name}'
        return entry(model, label, provider, efforts=LOGIN_EFFORTS.get(provider, []))
    try:
        found = _info(_rates(), provider, name)
    except Exception:
        found = None
    if found:
        return {k: v for k, v in found.items() if k != 'family'}
    return entry(model, name or model, provider)


def provider_models(data_dir, provider):
    """Every chat model a provider offers you: the full list for your key (cloud), what a server
    serves (local), or what a CLI takes (login). Raises ValueError when the key is refused."""
    if provider in LOCAL:
        return [entry(m, m.split('/', 1)[1], provider) for m in local_models() if m.startswith(provider + '/')]
    if provider in LOGINS:
        return login_models(provider)
    key = keys.key_for(data_dir, provider + '/')
    if not key:
        return featured_models(provider)
    listed = _cached(('listed', provider, key[-6:]), TTL_S, lambda: _listed(provider, key))
    return [describe(f'{provider}/{m}') for m in listed]


def _listed(provider, key):
    """The provider's own model list for a key (chat models only). Raises ValueError for a refused key."""
    try:
        cls = importlib.import_module('prompture.infra.discovery')._get_driver_class(provider)
    except (ImportError, AttributeError):
        cls = None
    if cls is None:
        return [e['id'].split('/', 1)[1] for e in featured_models(provider)]
    try:
        models = cls.list_models(api_key=key, timeout=10)
    except Exception as error:  # a provider's client raises its own errors for a bad key
        raise ValueError(str(error)) from error
    if models is None:
        raise ValueError('The provider did not accept this key.')
    return sorted({m for m in models if isinstance(m, str) and not any(w in m.lower() for w in NOT_CHAT)})


# ---- servers on this computer ------------------------------------------------------

def ollama_url():
    host = (os.environ.get('OLLAMA_HOST') or '127.0.0.1:11434').strip().rstrip('/')
    host = host if host.startswith(('http://', 'https://')) else 'http://' + host
    return host.replace('://0.0.0.0', '://127.0.0.1')


def _ollama_tags():
    """The local Ollama's /api/tags models (chat models only); [] when it is not running. Tests replace this."""
    try:
        with net.urlopen(ollama_url() + '/api/tags', timeout=1.5) as response:
            entries = json.loads(response.read()).get('models') or []
    except (OSError, ValueError):
        return []
    return [e['name'] for e in entries if isinstance(e, dict) and isinstance(e.get('name'), str)
            and 'completion' in (e.get('capabilities') or ['completion'])]


def local_servers():
    """[{id, name, running, url, models}] for Ollama and LM Studio. Tests replace this."""
    def build():
        try:
            from prompture.infra.local_servers import probe_local_servers
        except ImportError:  # an older Prompture: Torre asks Ollama itself
            names = _ollama_tags()
            return [{'id': 'ollama', 'name': 'Ollama', 'running': bool(names), 'url': ollama_url(), 'models': names}]
        return [{'id': s.provider, 'name': s.name, 'running': s.running, 'url': s.url,
                 'models': [m for m in s.models if not any(w in m.lower() for w in NOT_CHAT)]}
                for s in probe_local_servers()]
    return [] if keys.hosted() else _cached('local', LOCAL_TTL_S, build)


def _local_rank(model):
    name = model.split('/', 1)[1]
    family = next((i for i, f in enumerate(PREFERRED) if name.startswith(f)), len(PREFERRED))
    return any(tag in name for tag in SPECIALIZED), model.startswith('lmstudio/'), family, name


def local_models():
    """Model strings for the chat models local servers serve, best automatic pick first."""
    found = [f"{server['id']}/{m}" for server in local_servers() if server['running'] for m in server['models']]
    return sorted(found, key=_local_rank)


# ---- signed-in CLIs ----------------------------------------------------------------

def login_installed(provider):
    """Whether a coding-agent CLI is installed and Prompture can use it as a model. Tests replace this."""
    if keys.hosted():
        return False
    try:
        drivers = importlib.import_module('prompture.drivers.coding_agent_driver')
    except ImportError:  # a Prompture without the claude-code/ and codex/ drivers
        return None
    return _cached(('login', provider), TTL_S, lambda: bool(getattr(drivers, LOGINS[provider][2]).available()))


def login_models(provider):
    return [entry(f'{provider}/{m}', label, provider, efforts=LOGIN_EFFORTS.get(provider, [])) for m, label in LOGIN_MODELS[provider]]


# ---- all providers ---------------------------------------------------------------

def providers(data_dir):
    """Every provider Torre offers, ready ones first within each kind: {id, name, kind, ready,
    detail, url, key ({hint, source} or None, for cloud), models (a short list to pick from)}."""
    saved = keys.keys(data_dir)
    out = []
    if not keys.hosted():
        for provider, (name, url, _) in LOGINS.items():
            installed = login_installed(provider)
            if installed is None:
                continue  # this Prompture cannot use the logins yet
            out.append({'id': provider, 'name': name, 'kind': 'login', 'ready': installed, 'url': url, 'key': None,
                        'detail': 'signed_in' if installed else 'not_installed',
                        'models': login_models(provider) if installed else []})
        servers = {s['id']: s for s in local_servers()}
        for provider, (name, url) in LOCAL.items():
            server = servers.get(provider)
            if server is None:
                continue
            models = [entry(f'{provider}/{m}', m, provider) for m in server['models']]
            out.append({'id': provider, 'name': name, 'kind': 'local', 'ready': server['running'] and bool(models),
                        'url': url, 'key': None, 'models': sorted(models, key=lambda e: _local_rank(e['id'])),
                        'detail': ('running' if models else 'no_models') if server['running'] else 'not_running'})
    # Other providers Prompture knows show up once they have a key and chat models to offer.
    others = [p for p in saved if p not in CLOUD and p not in LOCAL and p not in LOGINS and featured_models(p)]
    for provider in [*CLOUD, *others]:
        name, url = CLOUD.get(provider, (_display_name(provider), None))
        found = saved.get(provider)
        out.append({'id': provider, 'name': name, 'kind': 'cloud', 'ready': bool(found), 'url': url,
                    'key': {'hint': keys.hint(found['key']), 'source': found['source']} if found else None,
                    'detail': 'key_saved' if found else 'needs_key', 'models': featured_models(provider)})
    return out


def _display_name(provider):
    """Prompture's name for a provider ("Z.ai"), else the id."""
    try:
        from prompture.drivers.provider_descriptors import PROVIDER_DESCRIPTOR_MAP
        return PROVIDER_DESCRIPTOR_MAP[provider].display_name or provider
    except Exception:
        return provider
