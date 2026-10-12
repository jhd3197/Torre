"""The per-step result ledger and the XP profile.

Every scored step (see lessons.is_scored) the user finishes posts its run here: story.json
keeps one entry per lesson step — the user's best run — and profile.json keeps
the lifetime XP total, the daily-goal streak and a per-day XP history. Stars,
level and progress bars are all derived from these files, never stored. Lesson completion itself still lives in lessons.json
(see lessons.py); this ledger only grades the scored steps.
"""

import json
from torre import jsonio
from torre.learning import lessons
from datetime import date

# Which steps are graded is the lesson format's call (lessons.WATCHED lists the rest).
is_scored = lessons.is_scored
XP_PER_STEP = 10
XP_PER_PUZZLE = 5   # a puzzle solved cleanly on the first attempt
XP_PER_REVIEW = 5   # a drill card graded Good
# A day counts toward the streak once this much XP is earned (any source).
DAILY_GOAL = 30
# Streak freezes: one is earned every FREEZE_EVERY days of streak, MAX_FREEZES at most, and each
# covers one missed day on its own. Reviews of other apps told of long streaks lost to one bad day.
FREEZE_EVERY = 7
MAX_FREEZES = 2


def load(path):
    try:
        story = json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        story = {}
    if not isinstance(story.get('steps'), dict):
        story['steps'] = {}
    return story


def save(path, story):
    jsonio.write_json(path, story, indent=1)


def load_profile(path):
    try:
        profile = json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        profile = {}
    xp = profile.get('xp')
    if not isinstance(xp, int) or isinstance(xp, bool) or xp < 0:
        xp = 0
    streak = profile.get('streak')
    if not isinstance(streak, dict):
        streak = {}
    count = streak.get('count')
    if not isinstance(count, int) or isinstance(count, bool) or count < 0:
        count = 0
    last = streak.get('lastActiveDate')
    if not isinstance(last, str):
        last = None
    freezes = streak.get('freezes')
    freezes = freezes if isinstance(freezes, int) and not isinstance(freezes, bool) and 0 < freezes <= MAX_FREEZES else 0
    history = profile.get('history')
    if not isinstance(history, dict):
        history = {}
    return {'xp': xp, 'streak': {'count': count, 'lastActiveDate': last, **({'freezes': freezes} if freezes else {})}, 'history': history}


def _missed(streak, today):
    """Whole days missed between the streak's last active day and `today` (0 when it was yesterday
    or today); None when there is no streak yet."""
    last = streak.get('lastActiveDate')
    if not last or not streak.get('count'):
        return None
    return max(0, (today - date.fromisoformat(last)).days - 1)


def live_streak(streak, today):
    """The streak as it stands on `today`: its count while the missed days since it was last
    extended are within its freezes, 0 once they are not."""
    missed = _missed(streak, today)
    if missed is None:
        return 0
    return streak.get('count', 0) if missed <= streak.get('freezes', 0) else 0


def save_profile(path, profile):
    jsonio.write_json(path, profile, indent=1)


def award_xp(profile, amount, now):
    """Pay XP, log it to the day, and grow the streak once the daily goal is met.

    Every source of XP goes through here (lesson steps, clean puzzle solves,
    drill reviews), so the streak and the per-day history stay in one place.
    The streak updates lazily, on award: a day that reaches DAILY_GOAL extends
    it when yesterday was active (or the missed days are covered by freezes, which
    are spent), starts it over otherwise. Every FREEZE_EVERY days earns a freeze.
    """
    if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
        raise ValueError('"amount" must be a positive whole number.')
    profile['xp'] = profile.get('xp', 0) + amount
    history = profile.setdefault('history', {})
    streak = profile.setdefault('streak', {'count': 0, 'lastActiveDate': None})
    today = now.date().isoformat()
    day = history.setdefault(today, {'xp': 0})
    day['xp'] += amount
    if day['xp'] >= DAILY_GOAL and streak.get('lastActiveDate') != today:
        missed = _missed(streak, now.date())
        freezes = streak.get('freezes', 0)
        if missed is not None and missed <= freezes:
            # Yesterday was active, or the days between are covered by freezes, spent now.
            freezes -= missed
            streak['count'] = streak.get('count', 0) + 1
        else:
            streak['count'] = 1
            freezes = 0
        if streak['count'] % FREEZE_EVERY == 0:
            freezes = min(MAX_FREEZES, freezes + 1)
        if freezes:
            streak['freezes'] = freezes
        else:
            streak.pop('freezes', None)
        streak['lastActiveDate'] = today


def level(xp):
    """Level for a lifetime XP total. Level n to n+1 costs 100*n XP, so reaching
    level n takes 50*n*(n-1) XP in all (100, then 200, then 300...)."""
    n = 1
    while 50 * n * (n + 1) <= xp:
        n += 1
    return n


def profile_view(profile, now):
    xp = profile['xp']
    n = level(xp)
    today = now.date().isoformat()
    xp_today = profile.get('history', {}).get(today, {}).get('xp', 0)
    return {'xp': xp, 'level': n, 'xpIntoLevel': xp - 50 * n * (n - 1), 'xpForLevel': 100 * n,
            'streak': {'count': live_streak(profile.get('streak', {}), now.date()), 'doneToday': xp_today >= DAILY_GOAL,
                       'goal': DAILY_GOAL, 'xpToday': xp_today, 'freezes': profile.get('streak', {}).get('freezes', 0)}}


def record_step(lesson, step, story, profile, run, now):
    """Merge one finished run into the ledger; returns the response with the XP earned.

    The ledger keeps the best run: fewer reveals beat more, then fewer hints, then
    a first-try solve. The completion date stays the first one. XP is for the
    first completion only — repeating a step can improve the entry but pays nothing.
    """
    if not is_scored(step):
        raise ValueError(f'A "{step["kind"]}" step is watched, not scored.')
    first_try = run.get('firstTry')
    if not isinstance(first_try, bool):
        raise ValueError('"firstTry" must be true or false.')
    counts = {}
    for key in ('hintsUsed', 'revealsUsed', 'attempts'):
        value = run.get(key, 0)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ValueError(f'"{key}" must be a whole number, zero or more.')
        counts[key] = value
    key = f"{lesson['slug']}/{step['id']}"
    old = story['steps'].get(key)
    gained = 0 if old else XP_PER_STEP
    rank = (counts['revealsUsed'], counts['hintsUsed'], not first_try)
    if old is None or rank < (old.get('revealsUsed', 0), old.get('hintsUsed', 0), not old.get('firstTry', False)):
        story['steps'][key] = {'firstTry': first_try, **counts,
                               'completedAt': old['completedAt'] if old else now.isoformat()}
    if gained:
        award_xp(profile, gained, now)
    return {'ok': True, 'xpGained': gained, 'xp': profile['xp'], 'level': level(profile['xp'])}


def step_results(lesson, story):
    """Ledger entries for the lesson's scored steps, keyed by step id."""
    slug = lesson['slug']
    return {s['id']: story['steps'][f'{slug}/{s["id"]}'] for s in lesson['steps']
            if is_scored(s) and f'{slug}/{s["id"]}' in story['steps']}


def stars(lesson, story, completed):
    """0-3 stars for a lesson, derived from the ledger and the completion flag.

    3: every scored step solved first-try with no hints or reveals. 2: completed
    with hints but no reveals. 1: completed. A lesson finished before the ledger
    existed has no entries, so it keeps its single star.
    """
    if not completed:
        return 0
    results = step_results(lesson, story)
    if not results:
        return 1
    scored = [s for s in lesson['steps'] if is_scored(s)]
    if all(s['id'] in results and results[s['id']].get('firstTry') is True
           and not results[s['id']].get('hintsUsed') and not results[s['id']].get('revealsUsed')
           for s in scored):
        return 3
    if all(not r.get('revealsUsed') for r in results.values()):
        return 2
    return 1
