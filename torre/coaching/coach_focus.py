"""The focus: the one to three skills the coach works on with you, picked from the ledger.

A focus is rolling. Once picked, a skill stays at least MIN_DAYS so the plan does not jump
around between visits; it leaves by graduating, by being skipped, or after MAX_DAYS. Graduating is
judged on fresh evidence, what you did since the skill became a focus: at least FRESH_EVENTS
pieces of it and GRADUATE_AT percent of them clean. (Long-term mastery carries months of games,
so a week of practice alone could never move it far enough.) Free slots are filled by score: the weaker, the surer the ledger is, the more recent
the slips and the worse the trend, the higher a skill ranks. Only skills there is something to
practise with are picked, and no family takes more than its share (FAMILY_CAP).

State lives in coach-focus.json:

    {"active": [{"skill", "since", "start"}], "graduated": [{"skill", "on", "from", "to"}],
     "pinned": [skill], "skipped": {skill: until}}
"""
import json
import threading
from datetime import date, timedelta
from pathlib import Path

from torre.coaching import skills
from torre import jsonio
FILE = 'coach-focus.json'
SLOTS = 3
MIN_DAYS = 3
MAX_DAYS = 21
GRADUATE_AT = 75
FRESH_EVENTS = 6
SKIP_DAYS = 7
FAMILY_CAP = {'tactics': 2}
LOCK = threading.Lock()


def load(data_dir):
    try:
        state = json.loads((Path(data_dir) / FILE).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        state = {}
    if not isinstance(state, dict):
        state = {}
    for key, empty in (('active', []), ('graduated', []), ('pinned', []), ('skipped', {})):
        if not isinstance(state.get(key), type(empty)):
            state[key] = empty
    state['active'] = [a for a in state['active'] if isinstance(a, dict) and a.get('skill') in skills.SKILLS]
    state['pinned'] = [s for s in state['pinned'] if s in skills.SKILLS]
    return state


def save(data_dir, state):
    path = Path(data_dir) / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    jsonio.write_json(path, state, indent=1)


def score(row):
    """How much a skill needs work: weakness weighted by how sure the ledger is."""
    value = (100 - row['mastery']) * (0.25 + row['confidence'])
    if row['trend'] == 'worse':
        value *= 1.3
    if row['week']['missed']:
        value *= 1.2
    return value


def _fits(skill, chosen):
    family = skills.SKILLS[skill]['family']
    taken = sum(1 for s in chosen if skills.SKILLS[s]['family'] == family)
    return taken < FAMILY_CAP.get(family, 1)


def _days(since, today):
    try:
        return (today - date.fromisoformat(since)).days
    except (TypeError, ValueError):
        return MAX_DAYS


def fresh(skill, since, events):
    """{count, ok, pct}: the evidence for a skill since a date (events from coach_ledger.all_events),
    and the weighted share of it that was clean."""
    found = [e for e in events if e['skill'] == skill and e['at'].date().isoformat() >= (since or '')]
    weight = sum(e['w'] for e in found)
    good = sum(e['w'] for e in found if e['ok'])
    return {'count': len(found), 'ok': sum(1 for e in found if e['ok']),
            'pct': round(100 * good / weight) if weight else None}


def ready(skill, since, events):
    got = fresh(skill, since, events)
    return got['count'] >= FRESH_EVENTS and got['pct'] is not None and got['pct'] >= GRADUATE_AT


def update(state, ledger, today, theme_counts, events=()):
    """Advance the focus for a day: graduate, retire and refill. Returns (state, changes), where each
    change is {"kind": "graduated" | "added" | "expired", "skill", ...} for the coach to announce."""
    changes = []
    state['skipped'] = {s: until for s, until in state['skipped'].items() if isinstance(until, str) and until > today.isoformat()}
    kept = []
    for focus in state['active']:
        skill, row = focus['skill'], ledger.get(focus['skill'])
        days = _days(focus.get('since'), today)
        if row is None or skill in state['skipped']:
            continue
        if days >= 1 and row['trend'] != 'worse' and ready(skill, focus.get('since'), events):
            done = {'skill': skill, 'on': today.isoformat(), 'from': focus.get('start', row['mastery']), 'to': row['mastery']}
            state['graduated'].append(done)
            changes.append({'kind': 'graduated', **done})
            continue
        if days >= MAX_DAYS and skill not in state['pinned']:
            changes.append({'kind': 'expired', 'skill': skill})
            continue
        kept.append(focus)
    # A pinned skill is always in focus.
    for skill in state['pinned']:
        if skill not in {f['skill'] for f in kept} and skill in ledger:
            kept.insert(0, {'skill': skill, 'since': today.isoformat(), 'start': ledger[skill]['mastery']})
            changes.append({'kind': 'added', 'skill': skill})
    recently_done = {g['skill'] for g in state['graduated'] if _days(g.get('on'), today) < MIN_DAYS * 2}
    candidates = sorted((row for skill, row in ledger.items()
                         if skill not in {f['skill'] for f in kept} and skill not in state['skipped']
                         and skill not in recently_done and skills.practiceable(skill, theme_counts)),
                        key=lambda r: (-score(r), r['skill']))
    for row in candidates:
        if len(kept) >= SLOTS:
            break
        if _fits(row['skill'], [f['skill'] for f in kept]):
            kept.append({'skill': row['skill'], 'since': today.isoformat(), 'start': row['mastery']})
            changes.append({'kind': 'added', 'skill': row['skill']})
    state['active'] = kept[:SLOTS]
    return state, changes


def act(state, action, skill, today):
    """The player's say: pin a skill (always in focus), unpin it, or skip it for SKIP_DAYS."""
    if skill not in skills.SKILLS:
        raise ValueError('There is no such skill.')
    if action == 'pin':
        if skill not in state['pinned']:
            state['pinned'] = [skill] + state['pinned'][:SLOTS - 1]
        state['skipped'].pop(skill, None)
    elif action == 'unpin':
        state['pinned'] = [s for s in state['pinned'] if s != skill]
    elif action == 'skip':
        state['pinned'] = [s for s in state['pinned'] if s != skill]
        state['active'] = [f for f in state['active'] if f['skill'] != skill]
        state['skipped'][skill] = (today + timedelta(days=SKIP_DAYS)).isoformat()
    else:
        raise ValueError('"action" must be pin, unpin or skip.')
    return state


def view(state, ledger, events=()):
    """The active focus with each skill's ledger entry and its progress since it became a focus."""
    out = []
    for focus in state['active']:
        row = ledger.get(focus['skill'])
        if row:
            out.append({**row, 'since': focus.get('since'), 'start': focus.get('start', row['mastery']),
                        'pinned': focus['skill'] in state['pinned'],
                        'fresh': fresh(focus['skill'], focus.get('since'), events),
                        'goal': {'count': FRESH_EVENTS, 'pct': GRADUATE_AT}})
    return out
