"""Translate the app's text into another language with an LLM, through Prompture.

    python translate_content.py                       # everything missing, into Spanish
    python translate_content.py --only lessons ui     # just some sources
    python translate_content.py --check               # list what is missing or stale; no model calls
    python translate_content.py --proofread           # fix gender agreement around torre/dama in the cache
    python translate_content.py --model ollama/qwen3.8:latest --lang es   # any Prompture model string

English is the source. Each source writes an overlay the app reads (see translations.py):
  lessons   lessons/<lang>/<slug>.json
  ui        web/src/i18n/locales/<lang>/<namespace>.json   (includes content.json: bots, openings, story chapters)
  themes    content/<lang>/themes.json
  awards    content/<lang>/awards.json
  messages  content/<lang>/messages.json

Every translation is checked before it is kept: the [move] cues, {{placeholders}}, <tags>, square
names and move notation must survive, and no em dash may appear. A batch that fails is retried line
by line; a line that still fails keeps its English text and is reported. Results are cached in
translations/<lang>.json by a hash of the English text and the glossary, so a re-run only sends
what changed. The glossary and style rules are in torre/tools/glossary_es.json. Lines that need a
hand-written translation (puns, song lines) go in translations/overrides/<lang>.json, keyed by the
English text; they always win over the model.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from torre import paths
from torre.learning import achievements
from torre.learning import lessons
from torre.learning import puzzles

ROOT = paths.REPO

UI_DIR = ROOT / 'web' / 'src' / 'i18n' / 'locales'
CONTENT_DIR = paths.CONTENT
CACHE_DIR = Path(__file__).resolve().parent / 'translations'
DEFAULT_MODEL = 'ollama/gemma3:12b'  # fits beside other GPU work and runs ~80 tok/s with good Spanish
LANGUAGE_NAMES = {'es': 'Spanish'}
BATCH_ITEMS = 12
BATCH_CHARS = 1800

SQUARE = re.compile(r'\b[a-h][1-8]\b')
SAN = re.compile(r'\b(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8]|O-O(?:-O)?)[+#]?')
PLACEHOLDER = re.compile(r'\{\{\s*\w+\s*\}\}')
TAG = re.compile(r'</?\w+\s*/?>')


# ── Sources: each yields (key, English text) and writes the translated overlay ──────────────────

def _lesson_items(lesson):
    for key in ('title', 'summary'):
        if lesson.get(key):
            yield (key,), lesson[key]
    if lesson.get('unit'):
        yield ('unit',), lesson['unit']
    for step in lesson['steps']:
        for key, value in step.items():
            if key in lessons.TEXT_FIELDS and isinstance(value, str) and value.strip():
                yield ('steps', step['id'], key), value
            elif isinstance(value, list):
                for i, item in enumerate(value):
                    if isinstance(item, dict):
                        for sub, text in item.items():
                            if sub in lessons.TEXT_FIELDS and isinstance(text, str) and text.strip():
                                yield ('steps', step['id'], key, i, sub), text


def _lesson_overlay(lesson, done):
    """The overlay file for one lesson: its text fields only, steps by id, lists by position."""
    out, steps = {}, {}
    for path, text in done.items():
        if path[0] != 'steps':
            out[path[0]] = text
            continue
        step = steps.setdefault(path[1], {'id': path[1]})
        if len(path) == 3:
            step[path[2]] = text
        else:
            items = step.setdefault(path[2], [])
            while len(items) <= path[3]:
                items.append({})
            items[path[3]][path[4]] = text
    out['steps'] = [steps[s['id']] for s in lesson['steps'] if s['id'] in steps]
    return out


class Source:
    name = ''

    def groups(self, lang):
        """[(label, context, {key: English}, write(done))] where `done` maps key to translation."""
        raise NotImplementedError


class Lessons(Source):
    name = 'lessons'

    def groups(self, lang):
        loaded, _ = lessons.load_all()
        for slug, lesson in loaded.items():
            items = dict(_lesson_items(lesson))
            target = lessons.LESSONS_DIR / lang / f'{slug}.json'
            yield (f'lessons/{slug}', f'a chess lesson called "{lesson["title"]}"', items,
                   lambda done, lesson=lesson, target=target: _write_json(target, _lesson_overlay(lesson, done)))


def _flatten(node, prefix=()):
    if isinstance(node, dict):
        for key, value in node.items():
            yield from _flatten(value, prefix + (key,))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            yield from _flatten(value, prefix + (i,))
    elif isinstance(node, str):
        yield prefix, node


def _unflatten(pairs, shape):
    """Rebuild `shape` (the English JSON) with translated strings where `pairs` has them."""
    def build(node, prefix):
        if isinstance(node, dict):
            return {k: build(v, prefix + (k,)) for k, v in node.items()}
        if isinstance(node, list):
            return [build(v, prefix + (i,)) for i, v in enumerate(node)]
        return pairs.get(prefix, node)
    return build(shape, ())


class JsonFolder(Source):
    """Every JSON file in an English folder, mirrored into the language's folder."""

    def __init__(self, name, folder, context):
        self.name, self.folder, self.context = name, folder, context

    # Written natively in each language, never translated: slang and quips do not survive translation.
    NATIVE = {'voice'}

    def groups(self, lang):
        for path in sorted((self.folder / 'en').glob('*.json')):
            if path.stem in self.NATIVE:
                continue
            shape = json.loads(path.read_text(encoding='utf-8'))
            items = dict(_flatten(shape))
            target = self.folder / lang / path.name
            yield (f'{self.name}/{path.stem}', f'{self.context} ("{path.stem}")', items,
                   lambda done, shape=shape, target=target: _write_json(target, _unflatten(done, shape)))


class Themes(Source):
    name = 'themes'

    def groups(self, lang):
        items = {}
        for slug, (_, title, summary, _) in puzzles.THEMES.items():
            items[(slug, 'title')], items[(slug, 'summary')] = title, summary
        yield ('themes', 'chess puzzle theme names and one-line descriptions', items,
               lambda done: _write_json(CONTENT_DIR / lang / 'themes.json', _keyed(done)))


class Awards(Source):
    name = 'awards'

    def groups(self, lang):
        items = {}
        for award, (_, title, description, unit, _) in achievements.AWARDS.items():
            items[(award, 'title')], items[(award, 'description')], items[(award, 'unit')] = title, description, unit
        yield ('awards', 'achievement badges: a title, what earns it, and the plural noun it counts', items,
               lambda done: _write_json(CONTENT_DIR / lang / 'awards.json', _keyed(done)))


class Messages(Source):
    """Literal error messages the API sends (f-strings with values stay English)."""
    name = 'messages'
    FILES = ('studio.py', 'api_board.py', 'api_coach.py', 'api_engines.py', 'api_games.py', 'api_training.py',
             'board_view.py', 'lessons.py', 'puzzles.py', 'story.py', 'drills.py')
    LITERAL = re.compile(r"""(?:'error':\s*|(?:Value|Lesson|Puzzle)Error\(|(?:BadRequest|NotFound|Conflict|Unavailable)\()'([^'{}\\]{6,})'""")

    def groups(self, lang):
        found = {}
        for name in self.FILES:
            path = ROOT / name
            if path.exists():
                for text in self.LITERAL.findall(path.read_text(encoding='utf-8')):
                    found[(text,)] = text
        yield ('messages', 'short error messages shown by a chess app', found,
               lambda done: _write_json(CONTENT_DIR / lang / 'messages.json', {k[0]: v for k, v in done.items()}))


def _keyed(done):
    out = {}
    for (key, field), text in done.items():
        out.setdefault(key, {})[field] = text
    return out


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


SOURCES = {s.name: s for s in (Lessons(), JsonFolder('ui', UI_DIR, 'the text of a chess app: buttons, labels, messages, bot characters, openings'),
                                Themes(), Awards(), Messages())}


# ── Checks ──────────────────────────────────────────────────────────────────────────────────────

def problems(english, translated):
    """Why a translation cannot be kept ([] when it is fine)."""
    issues = []
    if not translated or not translated.strip():
        return ['empty']
    if '—' in translated:
        issues.append('em dash')
    if english.count('[move]') != translated.count('[move]'):
        issues.append('[move] cues')
    if sorted(PLACEHOLDER.findall(english)) != sorted(PLACEHOLDER.findall(translated)):
        issues.append('{{placeholders}}')
    if sorted(TAG.findall(english)) != sorted(TAG.findall(translated)):
        issues.append('<tags>')
    if not set(SQUARE.findall(english)) <= set(SQUARE.findall(translated)):
        issues.append('square names')
    if not set(SAN.findall(english)) <= set(SAN.findall(translated)):
        issues.append('move notation')
    if SPAIN_MARKERS.search(translated):
        issues.append('Spain Spanish')
    return issues


def tidy(text):
    """Small fixes a model often needs: stray em dashes become commas, doubled spaces collapse, a
    sentence opened with ¡ closes with ! (not a full stop), and the accent of captúralo is put back."""
    text = re.sub(r'\s*—\s*', ', ', text)
    text = re.sub(r'¡([^!¡.?¿]*)\.', lambda m: f'¡{m.group(1)}!', text)
    text = text.replace('Cáptur', 'Captúr').replace('cáptur', 'captúr')
    text = latin_american(text)
    return re.sub(r'  +', ' ', text).strip()


# Spain-only Spanish that reads wrong (or, for coger, rude) in Latin America, after doblarr's
# dialect markers. Clear cases are rewritten; anything left fails the check and is re-translated.
SPAIN_FIXES = [
    (re.compile(r'\b([Cc])oge\b'), lambda m: f'{"T" if m.group(1) == "C" else "t"}oma'),
    (re.compile(r'\b([Cc])oger\b'), lambda m: f'{"T" if m.group(1) == "C" else "t"}omar'),
    (re.compile(r'\b([Cc])ogió\b'), lambda m: f'{"T" if m.group(1) == "C" else "t"}omó'),
    (re.compile(r'\b([Cc])ogerla\b'), lambda m: f'{"T" if m.group(1) == "C" else "t"}omarla'),
    (re.compile(r'\b([Cc])ogerlo\b'), lambda m: f'{"T" if m.group(1) == "C" else "t"}omarlo'),
    (re.compile(r'\ba por (el|la|los|las|un|una|tu|su)\b'), lambda m: f'por {m.group(1)}'),
    (re.compile(r'(^|(?<=[.!?¡¿] ))Vale\. '), lambda m: 'Bien. '),
    (re.compile(r'(^|(?<=[.!?¡¿] ))Vale, '), lambda m: 'Bien, '),
    (re.compile(r',? tío([.!?])'), lambda m: m.group(1)),
]
SPAIN_MARKERS = re.compile(r'\b(cog[eéií]\w*|coj[ao]\w*|vosotr[oa]s|guay|móvil|ordenador|coche|pillar|apetece|joder)\b'
                           r'|\ba por\b|(^|[.!?¡¿] )Vale[.,!]', re.IGNORECASE)


def latin_american(text):
    """Rewrite the clear Spain-only forms into Latin American ones."""
    for pattern, replacement in SPAIN_FIXES:
        text = pattern.sub(replacement, text)
    return text


def strip_artifacts(english, text):
    """Remove what a model adds from the prompt's shape: the item number ("4. "), quotes around the
    whole answer, and *markdown* emphasis (the proofreader marks its fixes), unless the English has them."""
    text = text.strip()
    if re.match(r'^\d+\.\s', text) and not re.match(r'^\d+\.', english):
        text = re.sub(r'^\d+\.\s+', '', text)
    if len(text) > 1 and text[0] == text[-1] == '"' and not english.startswith('"'):
        text = text[1:-1].strip()
    if '*' in text and '*' not in english:
        text = text.replace('*', '')
    return text


# ── Model calls ─────────────────────────────────────────────────────────────────────────────────

def _prompt(glossary, lang, context, texts):
    terms = '\n'.join(f'- {en}: {tr}' for en, tr in glossary['terms'].items())
    numbered = '\n'.join(f'{i + 1}. {json.dumps(t, ensure_ascii=False)}' for i, t in enumerate(texts))
    return (f'Translate each numbered item from English to {LANGUAGE_NAMES[lang]}. The items are {context}.\n'
            f'Style: {glossary["style"]}\nChess terms:\n{terms}\n{glossary["keep"]}\n'
            f'Return exactly {len(texts)} translations, in the same order, one per item, translating only the text.\n\n'
            f'Items:\n{numbered}')


def translate_batch(model, glossary, lang, context, texts):
    from pydantic import BaseModel
    from torre.ai import calls

    class Batch(BaseModel):
        translations: list[str]

    # think=False: a reasoning model (qwen3) spends most of its time thinking about short lines; off is ~8x faster.
    # The cap on the answer's length (Spanish runs ~30% longer than English, plus JSON) is what stops a
    # looping model. The timeout is long on purpose: a request the client gives up on keeps running in
    # Ollama, and retries queued behind abandoned requests once blocked it for an hour.
    budget = 200 + sum(len(text) for text in texts) // 2
    out = calls.ask(Batch, model, _prompt(glossary, lang, context, texts), max_tokens=budget, timeout=600, think=False)
    return list(out['translations'])


PROOFREAD_WORDS = re.compile(r'\b(torres?|damas?|reinas?)\b', re.IGNORECASE)


def proofread_batch(model, texts):
    """The same texts with only grammatical agreement fixed (local models slip on feminine pieces)."""
    from pydantic import BaseModel
    from torre.ai import calls

    class Batch(BaseModel):
        texts: list[str]

    numbered = '\n'.join(f'{i + 1}. {json.dumps(t, ensure_ascii=False)}' for i, t in enumerate(texts))
    prompt = ('Proofread each numbered Spanish text from a chess app. Fix ONLY errors of grammatical gender and number '
              'agreement: "torre" and "dama" (and "reina") are feminine, so their articles, adjectives, participles and '
              'pronouns must be feminine (la torre negra, la torre está clavada, captúrala, la otra torre). "Rey", '
              '"alfil", "caballo" and "peón" are masculine. Change nothing else: keep every other word, square names, '
              f'move notation, [move], {{{{placeholders}}}} and <tags> exactly. Return exactly {len(texts)} texts in order.\n\n{numbered}')
    budget = 300 + sum(len(text) for text in texts)  # the answer repeats every text, so allow the full length
    out = calls.ask(Batch, model, prompt, max_tokens=budget, timeout=600, think=False)
    return list(out['texts'])


def proofread(model, cache, cache_path):
    """Run every cached translation that mentions a feminine piece through proofread_batch; keep a
    correction only if it passes the usual checks and changes little (agreement fixes are small)."""
    import difflib
    keys = [k for k, v in cache.items() if PROOFREAD_WORDS.search(v)]
    fixed = 0
    size = 4  # small batches: the answer is as long as the question
    for start in range(0, len(keys), size):
        batch = keys[start:start + size]
        texts = [cache[k] for k in batch]
        try:
            results = proofread_batch(model, texts)
        except Exception as exc:
            print(f'  proofread batch at {start} skipped: {str(exc)[:80]}')
            continue
        if len(results) != len(texts):
            continue
        for key, before, after in zip(batch, texts, results):
            after = strip_artifacts(before, tidy(after))
            if after == before or problems(before, after):
                continue
            if difflib.SequenceMatcher(None, before, after).ratio() < 0.9:
                continue  # more than an agreement fix: keep the original
            cache[key] = after
            fixed += 1
        cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding='utf-8')
        if start % 100 == 0:
            print(f'  proofread {min(start + size, len(keys))} of {len(keys)}, {fixed} fixed')
    return fixed


def batches(keys, items):
    batch, size = [], 0
    for key in keys:
        if batch and (len(batch) >= BATCH_ITEMS or size + len(items[key]) > BATCH_CHARS):
            yield batch
            batch, size = [], 0
        batch.append(key)
        size += len(items[key])
    if batch:
        yield batch


# ── Main ────────────────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Translate the app text with an LLM (Prompture).')
    parser.add_argument('--lang', default='es', choices=sorted(LANGUAGE_NAMES))
    parser.add_argument('--model', default=DEFAULT_MODEL, help=f'Prompture model string (default {DEFAULT_MODEL})')
    parser.add_argument('--only', nargs='*', choices=sorted(SOURCES), help='sources to translate (default: all)')
    parser.add_argument('--check', action='store_true', help='report missing translations without calling the model')
    parser.add_argument('--limit', type=int, default=0, help='stop after this many groups (for a trial run)')
    parser.add_argument('--proofread', action='store_true', help='fix gender agreement in cached translations, then rewrite the overlays')
    args = parser.parse_args()

    glossary = json.loads((Path(__file__).resolve().parent / f'glossary_{args.lang}.json').read_text(encoding='utf-8'))
    cache_path = CACHE_DIR / f'{args.lang}.json'
    cache = json.loads(cache_path.read_text(encoding='utf-8')) if cache_path.exists() else {}
    stamp = f'{glossary["version"]}:'
    digest = lambda text: hashlib.sha1((stamp + text).encode('utf-8'), usedforsecurity=False).hexdigest()  # noqa: E731

    # Hand-written translations win over the model's, every run (a pun or a song line is rewritten,
    # not translated): translations/overrides/<lang>.json maps the English text to the wording to use.
    overrides_path = CACHE_DIR / 'overrides' / f'{args.lang}.json'
    overrides = json.loads(overrides_path.read_text(encoding='utf-8')) if overrides_path.exists() else {}
    for english, wording in overrides.items():
        cache[digest(english)] = wording

    if args.proofread:
        print(f'{proofread(args.model, cache, cache_path)} translations corrected.')

    missing_total, failed, groups_done = 0, [], 0
    for name in args.only or SOURCES:
        for label, context, items, write in SOURCES[name].groups(args.lang):
            todo = [key for key, text in items.items() if digest(text) not in cache]
            missing_total += len(todo)
            if args.check:
                if todo:
                    print(f'  {label}: {len(todo)} of {len(items)} missing')
                continue
            if args.limit and groups_done >= args.limit:
                continue
            for batch in batches(todo, items):
                texts = [items[k] for k in batch]
                try:
                    results = translate_batch(args.model, glossary, args.lang, context, texts)
                except Exception as exc:  # a malformed answer: fall back to one line at a time
                    print(f'  {label}: batch failed ({str(exc)[:80]}), retrying line by line')
                    results = []
                if len(results) != len(texts):
                    results = [None] * len(texts)
                for key, english, translated in zip(batch, texts, results):
                    attempt = strip_artifacts(english, tidy(translated)) if translated else ''
                    tries = 0
                    while problems(english, attempt) and tries < 2:
                        tries += 1
                        try:
                            attempt = strip_artifacts(english, tidy(translate_batch(args.model, glossary, args.lang, context, [english])[0]))
                        except Exception:
                            attempt = ''
                    if problems(english, attempt):
                        failed.append((label, english[:70], problems(english, attempt)))
                        continue
                    cache[digest(english)] = attempt
                CACHE_DIR.mkdir(exist_ok=True)
                cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding='utf-8')
            done = {key: cache[digest(text)] for key, text in items.items() if digest(text) in cache}
            if done:
                write(done)
            groups_done += 1
            print(f'  {label}: {len(done)} of {len(items)} translated')

    if args.check:
        print(f'\n{missing_total} strings missing or stale for {args.lang}.')
        return 1 if missing_total else 0
    if failed:
        print(f'\n{len(failed)} strings kept in English (checks failed):')
        for label, text, why in failed[:40]:
            print(f'  {label}: {text!r} ({", ".join(why)})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
