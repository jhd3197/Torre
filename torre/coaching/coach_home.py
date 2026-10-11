"""The Coach page's loop, end to end: ledger → focus → session, and what Rooky says about it.

studio.py serves these:

    home(data_dir, lang)          GET  /api/coach/home       briefing, focus, today's session, game lessons
    act(data_dir, payload)        POST /api/coach/focus      pin, unpin or skip a skill
    session(data_dir, skill)      POST /api/coach/session    the day's session for a focus skill
    game(data_dir, id, lang)      GET  /api/games/<id>/coach  the lesson from a game and Rooky's recap tail

Each visit moves the focus on (coach_focus.update) and keeps what changed for the day, so the
briefing can announce a graduation or a new focus once, on the day it happened.
"""
import threading
from pathlib import Path

from torre.coaching import coach_focus
from torre.coaching import coach_ledger
from torre.coaching import coach_lessons
from torre.learning import lessons
from torre.learning import puzzles
from torre.coaching import skills
LOCK = threading.Lock()
GRADUATION_XP = 50
SHELF = 6  # recent games offered as lessons


def _theme_counts():
    try:
        return {slug: len(pack) for slug, pack in puzzles.load_packs()['themes'].items()}
    except puzzles.PuzzleError:
        return {}


def _snapshot(data_dir, now):
    return coach_ledger.cached(data_dir, now), coach_ledger.cached_events(data_dir, now)


def _games_total(data_dir):
    return sum(len(coach_ledger._jsonl(Path(data_dir) / name)) for name in ('games.jsonl', 'played.jsonl'))


def advance(data_dir, now=None, award=None):
    """Move the focus on for today. Returns (state, ledger, events). `award(xp)` pays a graduation."""
    now = now or coach_ledger.now_utc()
    today = now.date()
    ledger, events = _snapshot(data_dir, now)
    with coach_focus.LOCK:
        state = coach_focus.load(data_dir)
        state, changes = coach_focus.update(state, ledger, today, _theme_counts(), events)
        news = state.get('news') if isinstance(state.get('news'), dict) else {}
        if news.get('day') != today.isoformat():
            news = {'day': today.isoformat(), 'changes': []}
        news['changes'] = (news['changes'] + changes)[-6:]
        state['news'] = news
        # Games since the last day you came by: the count at the start of today's first visit.
        total = _games_total(data_dir)
        visit = state.get('visit') if isinstance(state.get('visit'), dict) else {}
        if visit.get('day') != today.isoformat():
            visit = {'day': today.isoformat(), 'before': visit.get('games', total), 'games': total}
        visit['games'] = total
        state['visit'] = visit
        coach_focus.save(data_dir, state)
    graduations = [c for c in changes if c['kind'] == 'graduated']
    if graduations and award:
        award(GRADUATION_XP * len(graduations))
    return state, ledger, events


def _lesson_progress(data_dir, slug):
    return lessons.load_state(Path(data_dir) / 'lessons.json')['lessons'].get(slug, {})


def _session_card(data_dir, slug, lang):
    lesson = coach_lessons.render(data_dir, slug, lang)
    if not lesson:
        return None
    progress = _lesson_progress(data_dir, slug)
    return {'slug': slug, 'title': lesson['title'], 'skill': lesson['coach'].get('skill'), 'steps': len(lesson['steps']),
            'minutes': lesson['minutes'], 'step': min(progress.get('step', 0), len(lesson['steps'])),
            'completed': progress.get('completed'), 'kinds': [s['kind'] for s in lesson['steps']]}


def session(data_dir, skill, now=None):
    """The slug of today's session on a skill (planned the first time it is asked for)."""
    if skill not in skills.SKILLS:
        raise ValueError('There is no such skill.')
    now = now or coach_ledger.now_utc()
    ledger = coach_ledger.cached(data_dir, now)
    return coach_lessons.ensure_session(data_dir, skill, now.date(), ledger.get(skill))


def _recent_games(data_dir, limit):
    """The newest analyzed games, newest first: (id, record)."""
    analyses = coach_ledger._analyses(data_dir)
    games = coach_ledger._games(data_dir)
    rows = [(gid, games[gid]) for gid in analyses if gid in games]
    rows.sort(key=lambda r: (r[1].get('end_time_unix') or 0, str(r[1].get('date') or '')), reverse=True)
    return rows[:limit]


def game_shelf(data_dir, lang):
    """Lessons from your newest analyzed games that have a slip worth one."""
    scan = coach_ledger.scan_games(data_dir)
    shelf = []
    for game_id, rec in _recent_games(data_dir, SHELF * 2):
        slug = coach_lessons.ensure_game(data_dir, game_id, scan.get(game_id, []))
        if not slug:
            continue
        progress = _lesson_progress(data_dir, slug)
        plan = coach_lessons.load(data_dir)['lessons'].get(slug, {})
        found = sorted({s.get('skill') for s in plan.get('steps', []) if s.get('skill')})
        shelf.append({'slug': slug, 'game': game_id, 'opponent': rec.get('opponent'), 'date': rec.get('date'),
                      'result': rec.get('user_result'), 'color': rec.get('user_color'),
                      'moments': sum(1 for s in plan.get('steps', []) if s.get('type') == 'moment-show'),
                      'skills': found, 'completed': progress.get('completed'), 'step': progress.get('step', 0)})
        if len(shelf) >= SHELF:
            break
    return shelf


def home(data_dir, lang='en', now=None, award=None):
    now = now or coach_ledger.now_utc()
    state, ledger, events = advance(data_dir, now, award)
    focus = coach_focus.view(state, ledger, events)
    lines = coach_lessons.Lines(lang)
    today_session = None
    if focus:
        slug = session(data_dir, focus[0]['skill'], now)
        today_session = _session_card(data_dir, slug, lang)
    has_games = bool(coach_ledger._analyses(data_dir))
    games_since = max(0, state['visit']['games'] - state['visit'].get('before', state['visit']['games']))
    briefing = coach_lessons.briefing(lines, focus, state['news']['changes'], games_since,
                                      bool(today_session and today_session['completed']), has_games,
                                      seed=now.date().toordinal())
    name = lambda skill: {'name': lines.skill(skill), 'title': lines.skill(skill, 'title'), 'idea': lines.skill(skill, 'idea')}
    return {
        'briefing': briefing, 'day': now.date().isoformat(),
        'focus': [{**row, **name(row['skill']), 'themes': skills.SKILLS[row['skill']]['puzzle_themes'],
                   'lessons': skills.teaching_lessons(row['skill'])[:3]} for row in focus],
        'session': today_session,
        'changes': [{**c, **name(c['skill'])} for c in state['news']['changes']],
        'graduated': [{**g, **name(g['skill'])} for g in state['graduated'][-6:][::-1]],
        'skills': [{**row, **name(row['skill'])} for row in ledger.values()],
        'games': game_shelf(data_dir, lang),
        'hasGames': has_games,
    }


def act(data_dir, payload, now=None):
    now = now or coach_ledger.now_utc()
    with coach_focus.LOCK:
        state = coach_focus.load(data_dir)
        coach_focus.act(state, str(payload.get('action') or ''), str(payload.get('skill') or ''), now.date())
        coach_focus.save(data_dir, state)


def game(data_dir, game_id, lang='en', now=None):
    """The lesson from one game (planned on first ask) and the lines Rooky adds to its recap."""
    now = now or coach_ledger.now_utc()
    scan = coach_ledger.scan_games(data_dir)
    rows = scan.get(game_id, [])
    slug = coach_lessons.ensure_game(data_dir, game_id, rows)
    with coach_focus.LOCK:
        active = [f['skill'] for f in coach_focus.load(data_dir)['active']]
    touched = [skills.skill_for_tag(r['tag']) for r in sorted(rows, key=lambda r: r['ply'])]
    focus_skill = next((s for s in touched if s in active), None)
    lines = coach_lessons.Lines(lang)
    progress = _lesson_progress(data_dir, slug) if slug else {}
    return {'lesson': slug, 'focusSkill': focus_skill, 'lines': coach_lessons.recap_lines(lines, focus_skill, slug),
            'completed': progress.get('completed'),
            'skills': sorted({s for s in touched if s})}


def lesson(data_dir, slug, lang='en'):
    """A generated lesson by slug (coach_lessons.render), or None."""
    return coach_lessons.render(data_dir, slug, lang) if coach_lessons.is_generated(slug) else None

