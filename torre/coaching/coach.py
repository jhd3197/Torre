"""An AI chess coach: a compact brief of your numbers, turned into advice by an LLM through Prompture.

    python coach.py                      # print the brief (no model needed)
    python coach.py --ask                # ask the configured model, print the advice
    python coach.py --ask --lang es --model ollama/qwen3:8b

brief(data_dir) gathers the facts that matter for coaching from game_stats (weaknesses, phase
accuracy, where errors peak, results by opponent strength and color, tilt, time trouble), the
puzzle progress (rating trend, first-try rate per theme) and lesson and drill progress. The model
gets that brief and answers with a headline, strengths, three focus areas each tied to a drill
(puzzles, lessons, openings or play), in the app's language. The app supplies tracked task goals.

The model is the one Settings > AI picks for the coach (torre.ai.config: the coach's own
choice, else the default, else a model served on this computer), asked through torre.ai.calls.
The advice is cached in data/coach.json under a hash of the brief, the language and the model,
so it is only asked again on request when your data changes. Without Prompture or a model,
view() says so (available: false) instead of failing.
"""
import argparse
import contextlib
import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path

from torre.ai import calls, config, runtime
from torre.learning import drills
from torre.server import jobs
from torre.analysis import game_stats
from torre.learning import lessons
from torre.learning import puzzles
from torre import jsonio
CACHE_FILE = 'coach.json'
DRILL_KINDS = ('puzzles', 'lessons', 'openings', 'play')
LANGUAGE_NAMES = {'en': 'English', 'es': 'Spanish'}
FOCUS_AREAS = 3
MIN_THEME_TRIES = 5  # a theme's first-try rate is only reported over at least this many puzzles
LOCK = threading.Lock()


def _now():
    return datetime.now(timezone.utc)


def _read_json(path):
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


# ---- the brief ---------------------------------------------------------------

def _games_brief(stats):
    summary, acc, perf = stats['summary'], stats['accuracy'], stats['performance']
    phases = {p: {k: acc[p].get(k) for k in ('accuracy', 'acpl', 'blunder_rate', 'moves')}
              for p in game_stats.PHASES if acc.get(p, {}).get('moves')}
    peak = next((r for r in stats['heatmap']['by_move'] if r['bucket'] == stats['heatmap']['peak']), None)
    tt = stats['time']['time_trouble']
    openings = [o for o in perf['by_opening'] if o['games'] >= game_stats.MIN_OPENING_GAMES]
    worst = sorted(openings, key=lambda o: (o['score_pct'], -o['games']))[:3]
    best = [o for o in sorted(openings, key=lambda o: (-o['score_pct'], -o['games'])) if o not in worst][:2]
    brief_op = lambda rows: [{k: o[k] for k in ('eco', 'name', 'games', 'score_pct')} for o in rows]
    pick = lambda rows: {k: {'games': r['games'], 'score_pct': r['score_pct']} for k, r in rows.items() if r.get('games')}
    return {
        'games': summary['games'], 'analyzed': summary['analyzed_games'], 'score_pct': summary['score_pct'],
        'accuracy': summary['accuracy'], 'acpl': summary['acpl'],
        'weaknesses': summary['weaknesses'], 'facts': summary['facts'],
        'phase_accuracy': phases,
        'error_peak': peak and {'moves': peak['bucket'], 'error_rate': peak['error_rate'],
                                'overall_error_rate': acc['overall'].get('error_rate')},
        'by_rating': pick(perf['by_rating']), 'by_color': pick(perf['by_color']),
        'by_time_control': pick(perf['by_time_control']),
        'worst_openings': brief_op(worst), 'best_openings': brief_op(best),
        'tilt': stats['tilt']['recommendation'],
        'blind_spots': _blind_spots(stats.get('motifs')),
        'time': None if not stats['time']['timed_moves'] else {'timed_moves': stats['time']['timed_moves'],
                 'blunder_rate_in_time_trouble': tt['in'].get('blunder_rate') if tt['in'].get('moves') else None,
                 'blunder_rate_otherwise': tt['out'].get('blunder_rate') if tt['out'].get('moves') else None,
                 'avg_think_s': stats['time']['avg_think_s']},
    }


def _blind_spots(found):
    """The tactics most often allowed and missed in mistakes and blunders (motifs.py), with the puzzle
    theme slug that trains each."""
    if not found or not found.get('errors'):
        return None
    top = lambda rows: [{'tactic': r['tag'], 'times': r['count'], 'puzzle_theme': r['slug'],
                         'lately': (r.get('trend') or {}).get('direction') or 'unchanged'} for r in rows[:3]]
    return {'errors_read': found['errors'], 'allowed': top(found['allowed']), 'missed': top(found['missed'])}


def _puzzles_brief(data_dir):
    state = puzzles.load_state(Path(data_dir) / 'puzzles.json')
    cat = puzzles.catalog(puzzles.load_packs(), state)
    themes = [{'theme': t['slug'], 'tried': t['attempted'], 'first_try_pct': round(100 * t['solved_first'] / t['attempted'])}
              for t in cat['themes'] if t['attempted'] >= MIN_THEME_TRIES]
    themes.sort(key=lambda t: t['first_try_pct'])
    trend = cat['trend']
    return {
        'rating': cat['rating'], 'rated_attempts': cat['rated'], 'missed_to_retry': cat['missed'],
        'rating_change_recent': trend[-1] - trend[0] if len(trend) >= 2 else None,
        'weakest_themes': themes[:4], 'strongest_themes': themes[::-1][:3] if len(themes) > 4 else [],
        'untried_themes': [t['slug'] for t in cat['themes'] if not t['attempted']],
    }


def lesson_index(folder=None):
    """{slug: {title, category, level, practice}} read straight from the lesson files (no full parse)."""
    out = {}
    for path in sorted(Path(folder or lessons.LESSONS_DIR).glob('*.json')):
        if path.name == lessons.UNITS_FILE:
            continue
        raw = _read_json(path)
        if raw.get('category'):
            out[path.stem] = {k: raw.get(k) for k in ('title', 'category', 'level', 'practice')}
    return out


def _lessons_brief(data_dir, index):
    progress = lessons.load_state(Path(data_dir) / 'lessons.json')['lessons']
    done = {slug for slug, p in progress.items() if p.get('completed')}
    started = [slug for slug, p in progress.items() if p.get('step') and slug not in done and slug in index]
    todo = {}
    for slug, info in index.items():
        if slug not in done:
            todo.setdefault(info['category'], []).append(slug)
    return {'completed': len(done & set(index)), 'total': len(index), 'in_progress': started[:5],
            'not_done_by_category': todo}


def _drills_brief(data_dir):
    state = drills.load_state(Path(data_dir) / 'drills.json')
    return {'cards_learned': len(state['cards']), 'lesson_cards': len(state['lesson_cards'])}


def brief(data_dir='data', stats=None):
    """The JSON facts the coach works from. `stats` is game_stats.load_stats(data_dir) if already built."""
    stats = stats or game_stats.load_stats(data_dir)
    out = {'games': _games_brief(stats) if stats['counts']['games'] else None}
    # What the coach is working on with the player right now (coach_focus.py): the advice should back it.
    from torre.coaching import coach_focus
    out['focus_skills'] = [f['skill'] for f in coach_focus.load(data_dir)['active']]
    for key, part in (('puzzles', lambda: _puzzles_brief(data_dir)), ('lessons', lambda: _lessons_brief(data_dir, lesson_index())),
                      ('drills', lambda: _drills_brief(data_dir))):
        try:
            out[key] = part()
        except (OSError, ValueError, KeyError, TypeError):  # one broken file never hides the rest
            out[key] = None
    return out


def brief_key(data, lang, model):
    blob = json.dumps({'brief': data, 'lang': lang, 'model': model}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode('utf-8')).hexdigest()[:16]


# ---- asking the model ----------------------------------------------------------

def prompt(data, lang):
    return (
        'You are a friendly, concrete chess coach. Below is a JSON brief of one player\'s numbers from their own '
        'games (accuracy by phase, where errors peak, results by opponent strength and color, tilt, time trouble, '
        'blind_spots: the tactics their mistakes most often allowed the opponent or missed, with the puzzle theme that trains each), '
        'their puzzle progress (rating, first-try success per theme) and their lesson progress. '
        'focus_skills lists the skills the app is already training with them; back those up in your advice.\n'
        f'Write: a one-sentence headline; 2 or 3 strengths; exactly {FOCUS_AREAS} focus areas, each with a short title, '
        'a "why" that cites the numbers from the brief, and one drill. The app turns these drills into tracked tasks; '
        'leave weekly_plan empty. Do not invent schedules, rewards, task counts or destinations.\n'
        'Each drill has a kind and a target:\n'
        '- "puzzles": target is a puzzle theme slug, from the themes in the brief or one of: '
        f'{", ".join(puzzles.THEMES)}, or "missed" to retry missed puzzles.\n'
        '- "lessons": target is a lesson slug from lessons.not_done_by_category.\n'
        '- "openings": target is empty; the app opens its repertoire review. Name a relevant opening in the reason.\n'
        '- "play": target is empty; the app opens its bot selector. Only untimed bot games are currently available.\n'
        'Only use facts from the brief; never invent numbers. Check the direction of numeric comparisons; '
        'a smaller error rate is not a higher error rate. Keep slugs exactly as written. '
        f'Write every text in {LANGUAGE_NAMES.get(lang, "English")}, except slugs and ECO codes.\n\n'
        f'Brief:\n{json.dumps(data, ensure_ascii=False)}'
    )


def _extract(model, text):
    """Ask `model` for the advice through Prompture; a dict. Tests replace this."""
    from pydantic import BaseModel, Field

    class Drill(BaseModel):
        kind: str
        target: str = ''

    class Focus(BaseModel):
        title: str
        why: str
        drill: Drill

    class Advice(BaseModel):
        headline: str
        strengths: list[str] = Field(default_factory=list)
        focus: list[Focus] = Field(default_factory=list)
        weekly_plan: list[str] = Field(default_factory=list)

    return calls.ask(Advice, model, text)


def clean_advice(raw):
    """The model's answer with drills checked against what exists: a puzzle theme, a lesson slug..."""
    themes = set(puzzles.THEMES) | {puzzles.MISSED, puzzles.MIXED}
    known_lessons = set(lesson_index())
    text = lambda v: v.strip() if isinstance(v, str) else ''
    focus = []
    for item in (raw.get('focus') or [])[:FOCUS_AREAS]:
        if not isinstance(item, dict) or not text(item.get('title')):
            continue
        drill = item.get('drill') if isinstance(item.get('drill'), dict) else {}
        kind, target = text(drill.get('kind')).lower(), text(drill.get('target'))
        if kind not in DRILL_KINDS:
            kind, target = 'play', ''
        if kind == 'puzzles' and target.lower() not in themes:
            target = ''
        if kind == 'lessons' and target.lower() not in known_lessons:
            target = ''
        focus.append({'title': text(item['title']), 'why': text(item.get('why')),
                      'drill': {'kind': kind, 'target': target.lower() if kind in ('puzzles', 'lessons') else target}})
    lines = lambda key: [text(v) for v in (raw.get(key) or []) if text(v)]
    return {'headline': text(raw.get('headline')), 'strengths': lines('strengths')[:5], 'focus': focus,
            'weekly_plan': lines('weekly_plan')[:7]}


def ask(data, lang, model):
    return clean_advice(_extract(model, prompt(data, lang)))


# ---- cache and view ------------------------------------------------------------

def load_cache(data_dir):
    return _read_json(Path(data_dir) / CACHE_FILE)


def cached_entry(cache, key=None, lang=None, model=None):
    entries = cache.get('entries') or {}
    if key and key in entries:
        return entries[key]
    if key and cache.get('key') == key:
        return {k: v for k, v in cache.items() if k != 'entries'}
    candidates = [entry for entry in entries.values() if entry.get('lang') == lang and entry.get('model') == model]
    if cache.get('lang') == lang and cache.get('model') == model and cache.get('advice'):
        candidates.append({k: v for k, v in cache.items() if k != 'entries'})
    return max(candidates, key=lambda entry: entry.get('generated_at', ''), default={})


def save_cache(data_dir, entry):
    # Preserve results across language/model switches and returning to earlier data.
    old = load_cache(data_dir)
    entries = dict(old.get('entries') or {})
    if old.get('key') and old.get('advice'):
        entries[old['key']] = {k: v for k, v in old.items() if k != 'entries'}
    entries[entry['key']] = entry
    entries = dict(sorted(entries.items(), key=lambda item: item[1].get('generated_at', ''))[-24:])
    entry = {**entry, 'entries': entries}
    path = Path(data_dir) / CACHE_FILE
    jsonio.write_json(path, entry, indent=1, ensure_ascii=False)


def generate(data_dir='data', lang='en', model=None, data=None, force=False):
    """Ask the model unless the cache already answers this brief; returns the cache entry.
    Raises RuntimeError when the coach is unavailable."""
    model = model or config.choose_model(data_dir, 'coach')[0]
    if not runtime.prompture_installed():
        raise calls.AiError(runtime.MISSING_PROMPTURE)
    if not model:
        raise calls.AiError(runtime.NO_MODEL)
    data = data if data is not None else brief(data_dir)
    key = brief_key(data, lang, model)
    cached = cached_entry(load_cache(data_dir), key, lang, model)
    if not force and cached.get('key') == key and cached.get('advice'):
        return cached
    entry = {'key': key, 'lang': lang, 'model': model, 'generated_at': _now().isoformat(timespec='seconds'),
             'advice': ask(data, lang, model)}
    with LOCK:
        save_cache(data_dir, entry)
    return entry


class CoachJob(jobs.BackgroundJob):
    """Asks the model, one request at a time."""
    busy_message = 'The coach is already writing.'
    label = 'Asking the coach'

    def __init__(self):
        super().__init__({'running': False, 'error': None, 'key': None})

    def start(self, data_dir, lang, model, data, force=False):
        self.launch({'running': True, 'error': None, 'key': brief_key(data, lang, model)}, data_dir, lang, model, data, force)

    def work(self, data_dir, lang, model, data, force):
        generate(data_dir, lang, model, data, force)


JOB = CoachJob()


def view(data_dir='data', lang='en', stats=None, job=None, auto=False):
    """What GET /api/coach sends: availability, the brief, the cached advice (fresh when it answers
    this very brief) and the job. With `auto`, a stale or missing answer is asked for in the
    background, unless the last try at this same brief failed."""
    job = job or JOB
    data = brief(data_dir, stats)
    out = {**config.availability(data_dir, 'coach'), 'brief': data}
    key = brief_key(data, lang, out['model']) if out['model'] else None
    cached = cached_entry(load_cache(data_dir), key, lang, out['model'])
    out['advice'] = cached.get('advice')
    out['generated_at'] = cached.get('generated_at')
    out['fresh'] = bool(key and cached.get('key') == key and cached.get('advice'))
    status = job.status()
    if auto and out['available'] and not out['fresh'] and not status['running'] and data.get('games') \
            and not (status['error'] and status['key'] == key):
        with contextlib.suppress(jobs.JobBusy):
            job.start(data_dir, lang, out['model'], data)
        status = job.status()
    out['job'] = status
    out['install'] = runtime.INSTALL.status()
    from torre.coaching import coach_focus
    from torre.coaching import coach_plan
    focus_skills = [f['skill'] for f in coach_focus.load(data_dir)['active']]
    out['tasks'] = coach_plan.view(data_dir, out['advice'], data, lang, focus_skills)
    if not out['available']:
        out['error'] = runtime.MISSING_PROMPTURE if out['reason'] == 'prompture_missing' else runtime.NO_MODEL
    return out


def regenerate(data_dir='data', lang='en', stats=None, job=None):
    """POST /api/coach: update only when the saved result no longer matches."""
    job = job or JOB
    status = config.availability(data_dir, 'coach')
    if status['available']:
        data = brief(data_dir, stats)
        key = brief_key(data, lang, status['model'])
        if cached_entry(load_cache(data_dir), key, lang, status['model']).get('key') != key:
            with contextlib.suppress(jobs.JobBusy):  # already asking
                job.start(data_dir, lang, status['model'], data)
    return view(data_dir, lang, stats, job, auto=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--data-dir', default='data')
    parser.add_argument('--ask', action='store_true', help='ask the model (otherwise print the brief)')
    parser.add_argument('--lang', default='en', choices=sorted(LANGUAGE_NAMES))
    parser.add_argument('--model', help='Prompture model string (default: the model Settings > AI picks for the coach)')
    parser.add_argument('--force', action='store_true', help='ask even if the cached advice is current')
    args = parser.parse_args()
    if args.ask:
        print(json.dumps(generate(args.data_dir, args.lang, args.model, force=args.force), indent=2, ensure_ascii=False))
    else:
        print(json.dumps(brief(args.data_dir), indent=2, ensure_ascii=False))
