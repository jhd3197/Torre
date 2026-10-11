"""The data folder the studio serves (games, analysis, settings, progress) and the reads every
area of the API shares. studio.py points it at --data-dir with use_data_dir()."""
import json
import threading
from functools import lru_cache
from pathlib import Path

from torre.learning import achievements
from torre.games import arena
from torre.coaching import coach
from torre.coaching import coach_home
from torre.analysis import engines
from torre.analysis import game_stats
from torre.analysis import insights
from torre import jsonio
from torre.learning import lessons
from torre.games import masters
from torre.learning import puzzles
from torre.learning import story
from torre import paths
ROOT = paths.REPO
DATA_DIR = ROOT / 'data'


def use_data_dir(path):
    """Point the studio, and every module that keeps files there, at another data folder."""
    global DATA_DIR
    DATA_DIR = Path(path).expanduser().resolve()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    engines.use_data_dir(DATA_DIR)
    masters.use_data_dir(DATA_DIR)
    arena.JOB.data_dir = DATA_DIR
    puzzles.MINE_FILE = DATA_DIR / 'my-puzzles.json'
    coach.use_data_dir(DATA_DIR)


def records(name):
    """Every record of a JSONL file in the data folder (lines cut short by a crash are skipped).
    Parsed once per version of the file and shared: read-only."""
    return jsonio.read_jsonl(DATA_DIR / name)


def _by_id(path):
    """{id: [record, ...]} in file order."""
    index = {}
    for record in jsonio.read_jsonl(path):
        if isinstance(record, dict) and 'id' in record:
            index.setdefault(record['id'], []).append(record)
    return index


def game_record(game_id):
    """The archived game with this id, or None."""
    found = jsonio.cached(DATA_DIR / 'games.jsonl', _by_id).get(game_id)
    return found[0] if found else None


def analysis_record(game_id, scoring_version=None):
    """The game's first analysis record (of `scoring_version` when given), or None."""
    found = jsonio.cached(DATA_DIR / 'analysis.jsonl', _by_id).get(game_id, [])
    return next((a for a in found if scoring_version is None or a.get('scoring_version') == scoring_version), None)


def stamps(*names):
    """Modification stamps of data files, for caches rebuilt when one changes."""
    return tuple((DATA_DIR / name).stat().st_mtime_ns if (DATA_DIR / name).exists() else 0 for name in names)


@lru_cache(maxsize=1)
def insights_data(data_dir, *stamps_):
    return insights.build_data(data_dir)


def current_insights():
    return insights_data(DATA_DIR, *stamps('games.jsonl', 'analysis.jsonl', 'settings.json'))


@lru_cache(maxsize=1)
def stats_data(data_dir, *stamps_):
    """game_stats over the data folder, rebuilt when a games or analysis file changes."""
    return game_stats.load_stats(data_dir)


def current_stats():
    return stats_data(DATA_DIR, *stamps('games.jsonl', 'played.jsonl', 'analysis.jsonl'))


def read_settings():
    try:
        data = json.loads((DATA_DIR / 'settings.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        data = {}
    return data if isinstance(data, dict) else {}


SETTINGS_LOCK = threading.Lock()


def update_settings(change):
    with SETTINGS_LOCK:
        settings = read_settings()
        change(settings)
        jsonio.write_json(DATA_DIR / 'settings.json', settings)


def setup_state():
    """First-run state (whether the welcome screen was answered) and the accounts games are imported from."""
    data = read_settings()
    accounts = data.get('accounts') if isinstance(data.get('accounts'), dict) else {}
    return {'onboarded': bool(data.get('onboarded')), 'accounts': {k: accounts.get(k) for k in ('chesscom', 'lichess')}}


def my_names():
    """Every name you play under (lowercase): your accounts, names chosen at import, and the archive's owner."""
    data = read_settings()
    accounts = data.get('accounts') if isinstance(data.get('accounts'), dict) else {}
    names = [*accounts.values(), *(data.get('aliases') or []), insights.DEFAULT_USER]
    return {n.lower() for n in names if isinstance(n, str) and n}


def remember_account(source, username):
    update_settings(lambda s: s.setdefault('accounts', {}).update({source: username}))


def remember_alias(name):
    update_settings(lambda s: s.__setitem__('aliases', sorted({*(s.get('aliases') or []), name})))


def award_profile_xp(amount):
    """Pay XP from puzzles, drills or lessons into the profile (streak and
    history update in story.award_xp). Call without holding another lock."""
    with lessons.LOCK:
        profile_path = DATA_DIR / 'profile.json'
        profile = story.load_profile(profile_path)
        story.award_xp(profile, amount, lessons.now_utc())
        story.save_profile(profile_path, profile)


def award_counts():
    """Award counts over every game and puzzle (see achievements.py)."""
    with puzzles.LOCK:
        state = puzzles.load_state(DATA_DIR / 'puzzles.json')
    try:
        tags = {pid: raw.get('themes', []) for pid, raw in puzzles.load_packs()['by_id'].items()}
    except puzzles.PuzzleError:
        tags = {}
    return achievements.counts(DATA_DIR, state, tags)[0]


def find_lesson(slug, lang=None):
    """A lesson by slug: a hand-written one (localized when `lang` is given), or one the coach
    generated (coach_lessons.py, always in a language); None when there is no such lesson."""
    generated = coach_home.lesson(DATA_DIR, slug, lang or 'en')
    if generated is not None:
        return generated
    lesson = lessons.load_all()[0].get(slug)
    if not lesson:
        return lesson
    # load_all's lessons are shared; callers get their own copy.
    return lessons.localize(lesson, lang) if lang else json.loads(json.dumps(lesson))
