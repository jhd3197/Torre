"""API keys for the cloud providers.

On your own computer, keys live in Prompture's shared store (~/.prompture/credentials.yaml,
readable by you only), under the provider's variable name (CLAUDE_API_KEY, OPENAI_API_KEY...):
a key saved here also works in other Prompture apps and in the prompture CLI, and one saved
there shows up here. A key set in the environment is used too, but is not Torre's to change.

Where Torre is hosted for several people (TORRE_HOSTED=1), each player's keys stay in their own
data folder (<data>/secrets.json, owner-only) and never reach the shared store. So do keys saved
before Prompture is installed; they move to the shared store once it is (migrate).

Keys never leave the server: the interface sees which providers have one and its last four
characters.
"""
import json
import os
from pathlib import Path

SECRETS_FILE = 'secrets.json'
HOSTED_ENV = 'TORRE_HOSTED'  # set by a hosting gateway: keys per player, no local servers or logins

# Each cloud provider's key variable, used when Prompture's own catalogue cannot be read
# (an older Prompture). The catalogue, when available, adds every other key-based provider.
KNOWN_VARS = {
    'claude': 'CLAUDE_API_KEY', 'openai': 'OPENAI_API_KEY', 'google': 'GOOGLE_API_KEY', 'grok': 'GROK_API_KEY',
    'deepseek': 'DEEPSEEK_API_KEY', 'mistral': 'MISTRAL_API_KEY', 'groq': 'GROQ_API_KEY',
    'openrouter': 'OPENROUTER_API_KEY', 'moonshot': 'MOONSHOT_API_KEY', 'cohere': 'COHERE_API_KEY',
}
# The vendors' own names for the same keys, read from the environment as well.
ALIASES = {'claude': ('ANTHROPIC_API_KEY',), 'google': ('GEMINI_API_KEY',), 'grok': ('XAI_API_KEY',)}

STORE_PATH = None  # tests point the shared store elsewhere


def hosted():
    return os.environ.get(HOSTED_ENV) == '1'


def env_var(provider):
    """The variable a provider's key goes by ('claude' -> 'CLAUDE_API_KEY'), or None."""
    return key_vars().get(provider)


def key_vars():
    """{provider: key variable} for every chat provider that takes an API key."""
    found = dict(KNOWN_VARS)
    for entry in _catalogue():
        if entry.llm:
            found.setdefault(entry.provider, entry.env_var)
    return found


def _catalogue():
    """Prompture's key-based providers (infra.provider_keys, or the CLI module before it moved)."""
    for module in ('prompture.infra.provider_keys', 'prompture.cli.setup_cmd'):
        try:
            return __import__(module, fromlist=['provider_key_catalogue']).provider_key_catalogue()
        except Exception:  # not installed, too old, or the CLI's own imports are missing
            continue
    return []


def _store():
    """Prompture's shared credential store, or None without Prompture (or where Torre is hosted)."""
    if hosted():
        return None
    try:
        from prompture.infra.credentials import CredentialStore
    except ImportError:
        return None
    return CredentialStore(STORE_PATH) if STORE_PATH else CredentialStore()


def _file(data_dir):
    return Path(data_dir) / SECRETS_FILE


def _file_keys(data_dir):
    try:
        keys = json.loads(_file(data_dir).read_text(encoding='utf-8')).get('keys', {})
    except (OSError, ValueError, AttributeError):
        return {}
    return {k: v for k, v in keys.items() if isinstance(k, str) and isinstance(v, str) and v}


def _write_file(data_dir, keys):
    path = _file(data_dir)
    if not keys:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps({'keys': keys}, indent=1), encoding='utf-8')
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)


def keys(data_dir):
    """{provider: {'key', 'source'}} for every provider with a key: source is 'saved' (Torre or
    another Prompture app saved it) or 'environment' (a variable Torre cannot change)."""
    out = {}
    store = _store()
    if store is None:
        return {p: {'key': k, 'source': 'saved'} for p, k in _file_keys(data_dir).items()}
    try:
        saved = store.effective()
    except Exception:  # an unreadable store reads as empty; Prompture logs why
        saved = {}
    for provider, var in key_vars().items():
        for name in (var, *ALIASES.get(provider, ())):
            if os.environ.get(name, '').strip():
                out[provider] = {'key': os.environ[name].strip(), 'source': 'environment'}
                break
            if saved.get(name):
                out[provider] = {'key': saved[name], 'source': 'saved'}
                break
    return out


def key_for(data_dir, model):
    """The key for a model's provider ('openai/gpt-6-luna' -> the OpenAI key), or None."""
    provider = model.split('/', 1)[0] if isinstance(model, str) else ''
    found = keys(data_dir).get(provider)
    return found['key'] if found else None


def hint(key):
    return f'…{key[-4:]}' if len(key) > 8 else '…'


def save_key(data_dir, provider, key):
    """Keep `key` for `provider`, or forget it when the key is empty."""
    store = _store()
    var = env_var(provider)
    if store is None or var is None:
        saved = _file_keys(data_dir)
        if key:
            saved[provider] = key
        else:
            saved.pop(provider, None)
        _write_file(data_dir, saved)
        return
    if key:
        store.set(var, key)
    else:
        store.unset(var)
        if provider in _file_keys(data_dir):  # a copy left from before the move
            _write_file(data_dir, {p: k for p, k in _file_keys(data_dir).items() if p != provider})


def migrate(data_dir):
    """Move keys Torre kept in its data folder into the shared store (once Prompture is there),
    without replacing a key the store already has, then delete the file. Returns the providers moved."""
    store = _store()
    old = _file_keys(data_dir)
    if store is None or not old:
        return []
    moved, kept = [], {}
    try:
        present = store.effective()
        for provider, key in old.items():
            var = env_var(provider)
            if var is None:
                kept[provider] = key
                continue
            if not present.get(var):
                store.set(var, key)
                moved.append(provider)
    except Exception:  # the store cannot be written: keep using the file
        return []
    _write_file(data_dir, kept)
    return moved
