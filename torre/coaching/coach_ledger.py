"""The skill ledger: how good you are at each skill (skills.py), and the moments that show it.

    .venv/Scripts/python coach_ledger.py      # print the ledger for data/

Nothing here is stored twice. Every piece of evidence is read from the files the rest of the app
already writes:

    games      analysis.jsonl + motifs.game_motifs     per game: a tactic missed or allowed (fail, 2)
                                                        or a game clean of that slip         (ok, 0.5)
               achievement-scan.json (achievements)     a tactic you played in a game       (ok, 0.5)
    puzzles    puzzles.json attempts                    first try counts most               (1 / 0.5)
    drills     drills.json cards                        reviews and lapses                  (1)
    lessons    story.json scored steps                  hand-written lessons                (0.5)
               coach-lessons.json + story.json          generated coach lessons             (1)
    endgames   endgames.json                            positions held or converted         (1)

The motif tags of each game's mistakes are cached in coach-scan.json (a game is read once).

Mastery is a smoothed success rate in which older evidence counts less (HALF_LIFE_DAYS): with no
evidence it is 50, and it only moves far from that with enough of it (`confidence`). `trend`
compares the last TREND_DAYS with the TREND_DAYS before them.
"""
import math
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from torre.analysis import analyze
from torre.coaching import skills
from torre import jsonio
HALF_LIFE_DAYS = 30
PRIOR = 2.0  # pseudo-successes and pseudo-failures every skill starts with
CONFIDENCE_SCALE = 8.0
TREND_DAYS = 14
TREND_MIN_WEIGHT = 3.0
TREND_DELTA = 0.15
EVIDENCE_KEPT = 5
SCAN_FILE = 'coach-scan.json'
SCAN_VERSION = 3  # 2: forced mates let go count as missed (scoring.missed_mate); 3: every miss (scoring.is_miss)
LESSONS_FILE = 'coach-lessons.json'  # coach_lessons.py: the generated lessons and the skill of each step
LOCK = threading.Lock()

W_GAME_FAIL, W_GAME_CLEAN, W_GAME_OK = 2.0, 0.5, 0.5
W_PUZZLE_FIRST, W_PUZZLE_AGAIN = 1.0, 0.5
W_DRILL, W_LESSON, W_COACH_LESSON, W_ENDGAME = 1.0, 0.5, 1.0, 1.0


def now_utc():
    return datetime.now(timezone.utc)


def _jsonl(path):
    """The JSON object rows of a .jsonl file (cached until the file changes: the coach reads the
    same games and analysis many times per request)."""
    return jsonio.read_records(path)


def _when(value):
    """An aware datetime from an ISO string, a '2026.09.07' game date or a unix time; None otherwise."""
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
        return datetime.fromtimestamp(value, timezone.utc)
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        try:
            parsed = datetime.strptime(value[:10], '%Y.%m.%d')
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _event(skill, ok, weight, at, src, ref):
    return {'skill': skill, 'ok': bool(ok), 'w': weight, 'at': at, 'src': src, 'ref': ref}


# ── Games ─────────────────────────────────────────────────────────────────────────────────────

def _games(data_dir):
    """Game records by id (archive and studio games), mapped onto the same fields."""
    from torre.analysis import game_stats
    out = {}
    for name in ('games.jsonl', 'played.jsonl'):
        for rec in _jsonl(Path(data_dir) / name):
            if rec.get('id') is not None:
                out[rec['id']] = game_stats.normalize_game(rec)
    return out


def _analyses(data_dir):
    out = {}
    for rec in _jsonl(Path(data_dir) / 'analysis.jsonl'):
        if rec.get('id') is not None and rec.get('scoring_version') == analyze.SCORING_VERSION:
            out[rec['id']] = rec
    return out


def scan_games(data_dir, games=None, analyses=None):
    """{game id: [{kind, tag, ply, fen}]}: the tactics in each analyzed game's mistakes, cached in
    coach-scan.json so every game is read once per scoring version."""
    from torre.analysis import motifs
    path = Path(data_dir) / SCAN_FILE
    games = _games(data_dir) if games is None else games
    analyses = _analyses(data_dir) if analyses is None else analyses
    with LOCK:
        cache = jsonio.read_dict(path)
        if cache.get('version') != SCAN_VERSION or cache.get('scoring') != analyze.SCORING_VERSION:
            cache = {'version': SCAN_VERSION, 'scoring': analyze.SCORING_VERSION, 'games': {}}
        found, changed = cache['games'], False
        for game_id, analysis in analyses.items():
            if game_id in found or game_id not in games:
                continue
            try:
                rows = motifs.game_motifs(games[game_id], analysis)
            except (ValueError, KeyError, IndexError, TypeError, AttributeError):
                rows = []
            found[game_id] = [{'kind': kind, 'tag': tag, 'ply': example['ply'], 'fen': example['fen']}
                              for kind, tag, example in rows if kind != 'error']
            changed = True
        if changed:
            path.parent.mkdir(parents=True, exist_ok=True)
            jsonio.write_json(path, cache)
        return dict(found)


def game_events(data_dir, scan=None, games=None):
    """Per analyzed game and skill a game can show (one with motif tags): a slip when a mistake
    missed or allowed it, a clean game otherwise. A tactic you played (achievement-scan.json)
    counts as a success of its own."""
    games = _games(data_dir) if games is None else games
    scan = scan_games(data_dir, games) if scan is None else scan
    watched = [skill for skill, spec in skills.SKILLS.items() if spec['motif_tags']]
    events = []
    for game_id, rows in scan.items():
        rec = games.get(game_id) or {}
        at = _when(rec.get('end_time_unix')) or _when(rec.get('date'))
        if at is None:
            continue
        slips = {}
        for row in sorted(rows, key=lambda r: r['ply']):
            skill = skills.skill_for_tag(row['tag'])
            if skill and skill not in slips:
                slips[skill] = row
        for skill in watched:
            row = slips.get(skill)
            if row:
                events.append(_event(skill, False, W_GAME_FAIL, at, 'game',
                                     {'game': game_id, 'ply': row['ply'], 'kind': row['kind'], 'fen': row['fen'],
                                      'opponent': rec.get('opponent')}))
            else:
                events.append(_event(skill, True, W_GAME_CLEAN, at, 'game', {'game': game_id}))
    played = jsonio.read_dict(Path(data_dir) / 'achievement-scan.json').get('games') or {}
    for game_id, facts in played.items():
        rec = games.get(game_id)
        at = rec and (_when(rec.get('end_time_unix')) or _when(rec.get('date')))
        if not at or not isinstance(facts, dict):
            continue
        for skill in {skills.skill_for_fact(f) for f, n in facts.items() if isinstance(n, int) and n > 0} - {None}:
            events.append(_event(skill, True, W_GAME_OK, at, 'game', {'game': game_id, 'played': True}))
    return events


# ── Practice ──────────────────────────────────────────────────────────────────────────────────

def puzzle_events(data_dir, packs=None):
    from torre.learning import puzzles
    try:
        packs = packs or puzzles.load_packs()
    except puzzles.PuzzleError:
        return []
    state = puzzles.load_state(Path(data_dir) / 'puzzles.json')
    by_id = packs['by_id']
    events, in_history = [], set()
    for attempt in state['history']:
        raw = by_id.get(attempt.get('id'))
        at = _when(attempt.get('at'))
        if not raw or not at:
            continue
        in_history.add(attempt['id'])
        clean = attempt.get('result') == 'solved' and not attempt.get('hint') and not attempt.get('revealed') and not attempt.get('misses')
        weight = W_PUZZLE_FIRST if attempt.get('rated') else W_PUZZLE_AGAIN
        for skill in skills.skills_for_puzzle_tags(raw.get('themes')):
            events.append(_event(skill, clean, weight, at, 'puzzle', {'puzzle': attempt['id']}))
    # Attempts older than the kept history still count once, by their first try.
    for pid, entry in state['puzzles'].items():
        raw, at = by_id.get(pid), _when(entry.get('last_at'))
        if pid in in_history or not raw or not at or entry.get('first') not in ('solved', 'missed'):
            continue
        for skill in skills.skills_for_puzzle_tags(raw.get('themes')):
            events.append(_event(skill, entry['first'] == 'solved', W_PUZZLE_FIRST, at, 'puzzle', {'puzzle': pid}))
    return events


def drill_events(data_dir, scan=None, lesson_owner=None):
    """Drill cards: a game card takes the skills of its mistake (coach-scan), a lesson card its lesson's."""
    state = jsonio.read_dict(Path(data_dir) / 'drills.json')
    scan = scan or {}
    lesson_owner = lesson_owner if lesson_owner is not None else skills.lesson_skills()
    events = []
    for card_id, entry in (state.get('cards') or {}).items():
        at = _when((entry.get('fsrs') or {}).get('last_review'))
        if not at:
            continue
        if card_id.startswith('lesson:'):
            owner = lesson_owner.get(card_id[len('lesson:'):].split('/')[0])
            owned = [owner] if owner else []
        else:
            game_id, _, ply = card_id.rpartition(':')
            owned = sorted({skills.skill_for_tag(r['tag']) for r in scan.get(game_id, [])
                            if str(r['ply']) == ply and skills.skill_for_tag(r['tag'])})
        reviews, lapses = int(entry.get('reviews') or 0), int(entry.get('lapses') or 0)
        for skill in owned:
            ref = {'drill': card_id}
            events += [_event(skill, True, W_DRILL, at, 'drill', ref)] * max(0, reviews - lapses)
            events += [_event(skill, False, W_DRILL, at, 'drill', ref)] * lapses
    return events


def lesson_events(data_dir, lesson_owner=None):
    """Scored lesson steps from story.json: a hand-written lesson's steps count for its skill, a
    generated coach lesson's step for the skill it was built for (coach-lessons.json)."""
    steps = jsonio.read_dict(Path(data_dir) / 'story.json').get('steps') or {}
    generated = jsonio.read_dict(Path(data_dir) / LESSONS_FILE).get('lessons') or {}
    lesson_owner = lesson_owner if lesson_owner is not None else skills.lesson_skills()
    events = []
    for key, run in steps.items():
        slug, _, step_id = key.partition('/')
        at = _when(run.get('completedAt'))
        if not at or not isinstance(run, dict):
            continue
        ok = run.get('firstTry') is True and not run.get('revealsUsed')
        if slug in generated:
            skill = next((s.get('skill') for s in generated[slug].get('steps', []) if s.get('id') == step_id), None)
            weight = W_COACH_LESSON
        else:
            skill, weight = lesson_owner.get(slug), W_LESSON
        if skill in skills.SKILLS:
            events.append(_event(skill, ok, weight, at, 'lesson', {'lesson': slug, 'step': step_id}))
    return events


def endgame_events(data_dir):
    from torre.learning import endgames
    path = Path(data_dir) / 'endgames.json'
    state = jsonio.read_dict(path)
    try:
        fallback = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
    except OSError:
        return []
    events = []
    for position_id, entry in (state.get('positions') or {}).items():
        group = (endgames.BY_ID.get(position_id) or {}).get('group')
        skill = skills.skill_for_endgame(group)
        if not skill or not isinstance(entry, dict):
            continue
        if entry.get('completed'):
            events.append(_event(skill, True, W_ENDGAME, _when(entry['completed']) or fallback, 'endgame', {'endgame': position_id}))
        elif entry.get('attempts'):
            events.append(_event(skill, False, W_ENDGAME, fallback, 'endgame', {'endgame': position_id}))
    return events


def all_events(data_dir):
    games = _games(data_dir)
    scan = scan_games(data_dir, games)
    owner = skills.lesson_skills()
    events = []
    for part in (lambda: game_events(data_dir, scan, games), lambda: puzzle_events(data_dir),
                 lambda: drill_events(data_dir, scan, owner), lambda: lesson_events(data_dir, owner),
                 lambda: endgame_events(data_dir)):
        try:
            events += part()
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            continue  # one broken file never hides the rest
    return events


# ── The ledger ────────────────────────────────────────────────────────────────────────────────

def _rate(events):
    weight = sum(e['w'] for e in events)
    return (sum(e['w'] for e in events if e['ok']) / weight, weight) if weight else (None, 0.0)


def entry(skill, events, now):
    """One skill's ledger entry from its events."""
    s = f = 0.0
    for e in events:
        decay = 0.5 ** (max(0.0, (now - e['at']).total_seconds()) / 86400 / HALF_LIFE_DAYS)
        if e['ok']:
            s += e['w'] * decay
        else:
            f += e['w'] * decay
    recent_from, earlier_from = now - timedelta(days=TREND_DAYS), now - timedelta(days=2 * TREND_DAYS)
    recent, recent_w = _rate([e for e in events if e['at'] >= recent_from])
    earlier, earlier_w = _rate([e for e in events if earlier_from <= e['at'] < recent_from])
    if recent_w >= TREND_MIN_WEIGHT and earlier_w >= TREND_MIN_WEIGHT:
        trend = 'better' if recent - earlier >= TREND_DELTA else 'worse' if earlier - recent >= TREND_DELTA else 'steady'
    else:
        trend = 'new' if not events else 'steady'
    week = now - timedelta(days=7)
    failures = sorted((e for e in events if not e['ok']), key=lambda e: e['at'], reverse=True)
    return {
        'skill': skill, 'family': skills.SKILLS[skill]['family'],
        'mastery': round(100 * (s + PRIOR) / (s + f + 2 * PRIOR)),
        'confidence': round(1 - math.exp(-(s + f) / CONFIDENCE_SCALE), 2),
        'trend': trend, 'events': len(events),
        'week': {'ok': sum(1 for e in events if e['ok'] and e['at'] >= week),
                 'missed': sum(1 for e in events if not e['ok'] and e['at'] >= week),
                 'games_missed': sum(1 for e in events if not e['ok'] and e['src'] == 'game' and e['at'] >= week)},
        'last': max(e['at'] for e in events).isoformat() if events else None,
        'evidence': [{'src': e['src'], 'at': e['at'].isoformat(), 'ref': e['ref']} for e in failures[:EVIDENCE_KEPT]],
    }


def build(data_dir='data', now=None, events=None):
    """{skill: entry} for every skill in skills.SKILLS, weakest first."""
    now = now or now_utc()
    events = all_events(data_dir) if events is None else events
    by_skill = {skill: [] for skill in skills.SKILLS}
    for e in events:
        if e['skill'] in by_skill and e['at'] <= now + timedelta(minutes=5):
            by_skill[e['skill']].append(e)
    rows = [entry(skill, found, now) for skill, found in by_skill.items()]
    rows.sort(key=lambda r: (r['mastery'], -r['confidence'], r['skill']))
    return {r['skill']: r for r in rows}


SOURCES = ('games.jsonl', 'played.jsonl', 'analysis.jsonl', 'puzzles.json', 'drills.json', 'story.json',
           'endgames.json', 'achievement-scan.json', LESSONS_FILE)
_cache = {}


def _refresh(data_dir, now):
    """The cached (ledger, events), rebuilt when a source file changes or the hour turns (the decay)."""
    root = Path(data_dir)
    stamps = tuple(p.stat().st_mtime_ns if p.exists() else 0 for p in (root / name for name in SOURCES))
    key = (str(root.resolve()), stamps, now.strftime('%Y-%m-%dT%H'))
    with LOCK:
        if _cache.get('key') == key:
            return _cache['ledger'], _cache['events']
    events = all_events(root)
    ledger = build(root, now, events)
    with LOCK:
        _cache.update(key=key, ledger=ledger, events=events)
    return ledger, events


def cached(data_dir='data', now=None):
    """build(), cached until a source file changes."""
    return _refresh(data_dir, now or now_utc())[0]


def cached_events(data_dir='data', now=None):
    """all_events(), cached with the ledger."""
    return _refresh(data_dir, now or now_utc())[1]


if __name__ == '__main__':
    import sys
    rows = build(sys.argv[1] if len(sys.argv) > 1 else 'data')
    for r in rows.values():
        print(f"{r['skill']:<18} {r['mastery']:>3}  conf {r['confidence']:.2f}  {r['trend']:<7} events {r['events']:>4}  week {r['week']}")
