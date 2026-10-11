"""Record the coach's voice packs with a local Kokoro TTS server, loudness-normalized with ffmpeg.

    torre narrate --lang en                 # record what is missing for English (the female voice)
    torre narrate --lang en --gender male   # the same lines in the male voice
    torre narrate --lang es --force         # re-record everything for Spanish
    torre narrate --lang en --list          # print the lines without recording

It records from a source checkout: the lines come from the lessons and from the interface's
text in web/src/i18n/locales, and the packs land in dist/voice.

A pack holds one mp3 per spoken sentence, named by a hash of the sentence (voice_key, the same
64-bit FNV-1a as web/src/lib/voice.ts), plus manifest.json. The app looks a line up by hashing
what it is about to say, so every fixed line finds its recording without ids:

    dist/voice/<lang>/<key>.mp3                 the female voice (the original packs)
    dist/voice/<lang>-male/<key>.mp3            the male voice
    dist/voice/<folder>/manifest.json           {"lang", "gender", "voice", "lines": {key: {"text", "seconds"}}}

Lines come from the lessons (with lessons/<lang>/ translations merged in): narration, split at
[move] cues as the app speaks it, success lines, answer explanations, guess prompts; and from the
app's own spoken strings in web/src/i18n/locales/<lang>/ (the sound check, the lesson closing
line, the puzzle coach, and every line in voice.json, the home for extra spoken lines such as
quips); from coachlines.json, Rooky's coaching (coach_lessons.py), its placeholders expanded too;
and from commentary.json, the game-review commentary, whose {{placeholders}} are expanded over
every value they can take (each square, percent, move number, opening name...) so every sentence the
review can build out of its lines finds a recording. Every file is trimmed of silence and normalized to -16 LUFS so all lines
sound equally loud. torre/tools/build_packs.py zips a pack for download.

Start Kokoro first (docker run -d --gpus all -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu).
"""
import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from torre import paths
from torre.coaching import coach_lessons
from torre.learning import lessons

OUT_DIR = paths.REPO / 'dist' / 'voice'
LOCALES = paths.REPO / 'web' / 'src' / 'i18n' / 'locales'
DEFAULT_BASE_URL = 'http://127.0.0.1:8880/v1'
# The coach's voices: the player picks a female or a male coach (Settings), each its own pack.
VOICES = {'en': {'female': 'af_heart', 'male': 'am_michael'}, 'es': {'female': 'ef_dora', 'male': 'em_alex'}}
GENDERS = ('female', 'male')


def pack_folder(lang, gender):
    """dist/voice/<folder>: "en" for the female voice (the packs that came first), "en-male" for the male one."""
    return lang if gender == 'female' else f'{lang}-{gender}'
TIMEOUT = 120
BITRATE = 64_000
# Trim silence at both ends, then normalize loudness (EBU R128) the same way for every line. Short
# clips need two passes: the first measures the line, the second applies the exact gain.
TRIM = ('silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,'
        'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.12,areverse')
LOUDNESS = 'I=-16:TP=-1.5:LRA=11'
TARGET_LUFS = -16.0
PEAK_LIMIT = 0.84  # about -1.5 dBFS
MOVE_CUE = lessons.MOVE_CUE
ATTEMPTS = 3  # tries per line before it counts as failed
MAX_GUESSES = 8  # the guess-step summary is recorded for every score up to this many questions
OPENING_BOOK = paths.CONTENT / 'opening-book.json'
SQUARES = [f'{file}{rank}' for file in 'abcdefgh' for rank in range(1, 9)]


def spoken_form(text):
    return re.sub(r'\s+', ' ', text).strip()


def voice_key(text):
    """64-bit FNV-1a of the UTF-8 text as 16 hex digits (web/src/lib/voice.ts voiceKey)."""
    value = 0xcbf29ce484222325
    for byte in spoken_form(text).encode('utf-8'):
        value ^= byte
        value = (value * 0x100000001b3) & 0xffffffffffffffff
    return f'{value:016x}'


# ── What the app says ────────────────────────────────────────────────────────────────────────────

def _ui(lang, namespace):
    path = LOCALES / lang / f'{namespace}.json'
    english = json.loads((LOCALES / 'en' / f'{namespace}.json').read_text(encoding='utf-8'))
    translated = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    return english, translated


def _get(tree, dotted):
    for part in dotted.split('.'):
        if isinstance(tree, list) and part.isdigit() and int(part) < len(tree):
            tree = tree[int(part)]
        elif isinstance(tree, dict) and part in tree:
            tree = tree[part]
        else:
            return None
    return tree


def ui_line(lang, namespace, key):
    english, translated = _ui(lang, namespace)
    return _get(translated, key) or _get(english, key)


def _strings(tree, prefix=''):
    """(dotted key, text) for every string in a translation file, list items included."""
    items = tree.items() if isinstance(tree, dict) else enumerate(tree) if isinstance(tree, list) else []
    for key, value in items:
        path = f'{prefix}.{key}' if prefix else str(key)
        if isinstance(value, str):
            yield path, value
        else:
            yield from _strings(value, path)


def fill(template, **values):
    return re.sub(r'\{\{\s*(\w+)\s*\}\}', lambda m: str(values.get(m.group(1), m.group(0))), template)


def lesson_lines(lesson):
    """Everything the lesson player can say for one (localized) lesson."""
    for step in lesson['steps']:
        narration = step.get('narration')
        if narration:
            pieces = [p.strip() for p in narration.split(MOVE_CUE)]
            yield from (p for p in pieces if p)
            yield ' '.join(p for p in pieces if p)  # the Listen button reads the whole line
        for key in ('text', 'prompt', 'question', 'success'):
            if step.get(key) and (key == 'success' or not narration):
                yield step[key]
        for option in step.get('options', []):
            if option.get('why'):
                yield option['why']
        for guess in step.get('guesses', []):
            for key in ('prompt', 'why'):
                if guess.get(key):
                    yield guess[key]


def all_lines(lang):
    lines = set()
    loaded, _ = lessons.load_all()
    closing = ui_line(lang, 'lessons', 'finished.closing')
    for lesson in loaded.values():
        localized = lessons.localize(lesson, lang)
        lines.update(lesson_lines(localized))
        if closing:
            lines.add(fill(closing, title=localized['title']))
    for key in ('intro.soundCheck', 'play.wellDone', 'choose.right', 'guess.thatWasTheMove'):
        if ui_line(lang, 'lessons', key):
            lines.add(ui_line(lang, 'lessons', key))
    summary = ui_line(lang, 'lessons', 'guess.summary')
    if summary:
        lines.update(fill(summary, score=score, total=total) for total in range(1, MAX_GUESSES + 1) for score in range(total + 1))
    for group in (ui_line(lang, 'puzzles', 'coach') or {}).values():
        lines.update(line for line in group if isinstance(line, str))
    # voice.json holds the coach's quips and reactions, written natively per language (not translated),
    # so each language's own file is recorded in full.
    path = LOCALES / lang / 'voice.json'
    if path.exists():
        lines.update(text for _, text in _strings(json.loads(path.read_text(encoding='utf-8'))))
    lines.update(commentary_lines(lang))
    # Rooky's coaching lines (coachlines.json): the briefing, the recap tail and the generated lessons.
    lines.update(coach_lessons.all_lines(lang))
    return sorted(spoken_form(line) for line in lines if line and line.strip())


def opening_families():
    """The openings as the review names them: the family, as web/src/lib/commentary.ts openingFamily()."""
    book = json.loads(OPENING_BOOK.read_text(encoding='utf-8'))
    return sorted({re.split(r'[:,]', entry['name'])[0].strip() for entry in book['positions'].values()})


def _merged(english, translated):
    """The translation over English, key by key, so a line not yet translated is recorded in English."""
    if isinstance(english, dict) and isinstance(translated, dict):
        return {key: _merged(value, translated.get(key)) for key, value in english.items()}
    return english if translated is None else translated


def commentary_lines(lang):
    """Every line the review commentary can say: each template expanded over its placeholders' domains."""
    english, translated = _ui(lang, 'commentary')
    tree = _merged(english, translated)
    domains = {name: [str(n) for n in range(low, high + 1)] for name, (low, high) in tree.pop('_domains').items()}
    domains.update(square=SQUARES, opening=opening_families())
    for _, template in _strings(tree):
        names = sorted(set(re.findall(r'\{\{\s*(\w+)\s*\}\}', template)))
        unknown = [name for name in names if name not in domains]
        if unknown:
            raise ValueError(f'commentary.json: no domain for {{{{{unknown[0]}}}}} in {template!r}')
        texts = [template]
        for name in names:
            texts = [fill(text, **{name: value}) for text in texts for value in domains[name]]
        yield from texts


# ── Recording ────────────────────────────────────────────────────────────────────────────────────

def speech(base_url, voice, text):
    """mp3 bytes for `text` from Kokoro's OpenAI-compatible /audio/speech."""
    request = urllib.request.Request(
        f'{base_url.rstrip("/")}/audio/speech',
        data=json.dumps({'model': 'kokoro', 'voice': voice, 'input': text, 'response_format': 'mp3'}).encode('utf-8'),
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read()


def _ffmpeg(audio, filters, output):
    return subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'info', '-i', 'pipe:0', '-af', filters, *output],
                          input=audio, capture_output=True, check=True)


def normalize(audio):
    """Trimmed, -16 LUFS, mono mp3 bytes."""
    measured = _ffmpeg(audio, f'{TRIM},loudnorm={LOUDNESS}:print_format=json', ['-f', 'null', '-'])
    stats = json.loads(re.search(r'\{[^{}]*"input_i"[^{}]*\}', measured.stderr.decode('utf-8', 'replace')).group(0))
    # Exact gain to the target, with a limiter for the peaks of short, punchy lines (loudnorm alone
    # refuses to raise a line whose peaks would clip, so short exclamations came out quieter).
    gain = TARGET_LUFS - float(stats['input_i'])
    second = f'{TRIM},volume={gain:.2f}dB,alimiter=limit={PEAK_LIMIT}:level=false'
    result = _ffmpeg(audio, second, ['-ac', '1', '-ar', '24000', '-b:a', f'{BITRATE // 1000}k', '-f', 'mp3', 'pipe:1'])
    return result.stdout


def run(lang='en', gender='female', voice=None, base_url=None, force=False, list_only=False, workers=4):
    """Record what is missing from one pack (`torre narrate`); 0 when every line is recorded."""
    if not LOCALES.is_dir():
        raise RuntimeError('torre narrate records from a source checkout of Torre: web/src/i18n/locales is missing.')
    base_url = base_url or os.environ.get('KOKORO_URL', DEFAULT_BASE_URL)
    lines = all_lines(lang)
    if list_only:
        print('\n'.join(lines))
        print(f'\n{len(lines)} lines.')
        return 0
    if not shutil.which('ffmpeg'):
        print('ffmpeg is needed to normalize the audio: install it and make sure it is on PATH.')
        return 1
    voice = voice or VOICES[lang][gender]
    folder = OUT_DIR / pack_folder(lang, gender)
    folder.mkdir(parents=True, exist_ok=True)
    manifest_path = folder / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
    if manifest.get('voice') != voice:
        manifest = {}  # a different voice: every line is re-recorded
    known = manifest.get('lines', {})

    wanted = {voice_key(line): line for line in lines}
    # Recordings left by an interrupted run are kept: same text, same voice, so no need to redo them.
    for key, text in wanted.items():
        path = folder / f'{key}.mp3'
        if key not in known and path.exists() and not force:
            known[key] = {'text': text, 'seconds': round(path.stat().st_size * 8 / BITRATE, 2)}
    todo = [(key, text) for key, text in wanted.items()
            if force or key not in known or not (folder / f'{key}.mp3').exists()]
    print(f'{len(wanted)} lines for {lang}, {gender} ({voice}); recording {len(todo)}.')

    def record(item):
        key, text = item
        # Under load Kokoro now and then returns a cut-off mp3 that ffmpeg cannot read; asking again fixes it.
        for attempt in range(ATTEMPTS):
            try:
                audio = normalize(speech(base_url, voice, text))
                break
            except subprocess.CalledProcessError:
                if attempt == ATTEMPTS - 1:
                    raise
        (folder / f'{key}.mp3').write_bytes(audio)
        return key, {'text': text, 'seconds': round(len(audio) * 8 / BITRATE, 2)}

    def save():
        manifest_path.write_text(json.dumps({'lang': lang, 'gender': gender, 'voice': voice, 'lines': known}, ensure_ascii=False, indent=0),
                                 encoding='utf-8')

    failures = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(record, item): item for item in todo}
        for count, future in enumerate(futures, start=1):
            key, text = futures[future]
            try:
                done_key, entry = future.result()
                known[done_key] = entry
            except urllib.error.URLError as exc:
                failures.append((text, f'Kokoro unreachable ({exc.reason})'))
            except Exception as exc:  # one bad line should not stop the pack
                failures.append((text, str(exc)[:120]))
            if count % 50 == 0:
                print(f'  {count} / {len(todo)}')
                save()

    # Lines no lesson says any more are dropped from the pack.
    for stale in set(known) - set(wanted):
        known.pop(stale)
        (folder / f'{stale}.mp3').unlink(missing_ok=True)
    save()
    print(f'{len(known)} lines in the pack, {len(failures)} failed.')
    for text, error in failures[:20]:
        print(f'  FAILED {text[:60]!r}: {error}')
    return 1 if failures else 0
