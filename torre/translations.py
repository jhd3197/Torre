"""Server-side text in the reader's language.

English is the source everywhere. Translations are overlays that only hold text:

    lessons/<lang>/<slug>.json      a lesson's titles, texts, narration... (same step ids)
    content/<lang>/themes.json      puzzle themes: {slug: {"title", "summary"}}
    content/<lang>/awards.json      awards: {id: {"title", "description", "unit"}}
    content/<lang>/messages.json    API messages: {"English message": "translation"}

Anything missing falls back to English, so a half-translated language still works.
translate_content.py writes these files.
"""
import json
import threading
from pathlib import Path
from torre import paths

ROOT = Path(__file__).resolve().parents[1]
CONTENT_DIR = paths.CONTENT
LANGS = ('en', 'es')
DEFAULT = 'en'

_cache = {}
_lock = threading.Lock()


def language(value):
    """A supported language code from a header value such as 'es' or 'es-MX'; English otherwise."""
    code = (value or '').strip().lower()[:2]
    return code if code in LANGS else DEFAULT


def load(path):
    """A JSON overlay file, cached until it changes on disk; {} when missing or broken."""
    path = Path(path)
    try:
        stamp = path.stat().st_mtime_ns
    except OSError:
        return {}
    with _lock:
        hit = _cache.get(path)
        if hit and hit[0] == stamp:
            return hit[1]
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        data = {}
    with _lock:
        _cache[path] = (stamp, data if isinstance(data, dict) else {})
    return _cache[path][1]


def content(lang, name):
    """content/<lang>/<name>.json, or {} for English and missing files."""
    return {} if lang == DEFAULT else load(CONTENT_DIR / lang / f'{name}.json')


def message(text, lang):
    """An API message in `lang` (messages are keyed by their English text)."""
    return content(lang, 'messages').get(text, text) if isinstance(text, str) else text


def entry(lang, name, key, field, fallback):
    """One translated field of a keyed item (a theme's title...), or the English fallback."""
    value = content(lang, name).get(key, {}).get(field) if lang != DEFAULT else None
    return value if isinstance(value, str) and value.strip() else fallback
