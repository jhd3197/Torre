"""Puzzles: positions from real games with one winning line, grouped by theme.

Puzzles come from the Lichess puzzle database (CC0, see import_puzzles.py) and
live in puzzles/<theme>.json, one pack per theme in THEMES. The "From your
games" pack (MINE) is mined from the user's own games by my_puzzles.py and
lives in the data folder (MINE_FILE), not in puzzles/. A puzzle is the
position *before* the opponent's last move plus the line from there: the first
move is the opponent's, then the solver and the replies alternate, ending on
the solver's move. On the last move any checkmate is accepted, as on Lichess.

Packs are checked lightly when they load (shape, a known theme) and each
puzzle fully when it is served, so one bad puzzle never hides the rest;
test_puzzles.py checks every bundled puzzle.

Progress lives in puzzles.json next to the other data: a puzzle rating (Elo,
moved only by the first try at each puzzle, by a graded score that gives
partial credit after wrong moves and a bonus for fast clean solves), every
attempt with the wrong moves tried, and per-puzzle results, from which the
missed list, theme stats and the weak themes come. A puzzle missed once is
never "done": it gets an FSRS card (the scheduler drills.py uses) and comes
back to the missed queue when due, after a clean retry 10 minutes later, then
days, then weeks, until it sticks. The Streak and Storm runs
(RUNS) are unrated: they never touch the rating or the per-puzzle results,
only their best scores in "runs".
"""

import json
import random
import re
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import chess
from fsrs import Card, Rating, Scheduler

from torre import translations
from torre import jsonio
from torre import paths
PUZZLES_DIR = paths.PUZZLES
MINE_FILE = paths.REPO / 'data' / 'my-puzzles.json'  # point it at the studio's data folder
LOCK = threading.Lock()
START_RATING = 1500
HISTORY_LIMIT = 2000
AVG_SOLVE_LAST = 50  # solved attempts the overview's average solve time covers
UCI = re.compile(r'^[a-h][1-8][a-h][1-8][qrbn]?$')

# Graded scoring of a finished attempt (see grade()): the credit for solving
# after 1, 2 or 3+ wrong moves, the cap when a hint was used, and the shape of
# the time bonus for fast clean solves (par = PAR_BASE + PAR_PER_MOVE per
# solver move). An attempt at or above SOLVED_MIN counts as solved.
MISS_CREDIT = (0.6, 0.4, 0.2)
HINT_CAP = 0.5
TIME_BONUS_MAX = 0.2
PAR_BASE = 8.0
PAR_PER_MOVE = 6.0
SOLVED_MIN = 0.5

MINE = 'from-your-games'
GROUPS = ('yours', 'checkmates', 'tactics', 'endgames')
# slug: (Lichess theme tag, title, one-line summary, group). Order is display order.
THEMES = {
    MINE: ('myGames', 'From your games', 'Moments from your own games where you blundered or missed a win.', 'yours'),
    'mate-in-1': ('mateIn1', 'Mate in 1', 'Find the checkmate in one move.', 'checkmates'),
    'mate-in-2': ('mateIn2', 'Mate in 2', 'Force checkmate in two moves, whatever the defence.', 'checkmates'),
    'mate-in-3': ('mateIn3', 'Mate in 3', 'Longer forcing sequences that end in mate.', 'checkmates'),
    'back-rank-mate': ('backRankMate', 'Back-rank mate', 'Mate a king trapped behind its own pawns.', 'checkmates'),
    'smothered-mate': ('smotheredMate', 'Smothered mate', 'A knight mates a king hemmed in by its own pieces.', 'checkmates'),
    'mate-in-4': ('mateIn4', 'Mate in 4', 'Long forcing lines: every move a check or a threat.', 'checkmates'),
    'arabian-mate': ('arabianMate', 'Arabian mate', 'Rook and knight trap the king in a corner.', 'checkmates'),
    'anastasia-mate': ('anastasiaMate', "Anastasia's mate", 'Knight and rook pin the king against the edge.', 'checkmates'),
    'boden-mate': ('bodenMate', "Boden's mate", 'Two bishops on crossing diagonals mate the king.', 'checkmates'),
    'hook-mate': ('hookMate', 'Hook mate', 'Rook, knight and pawn hook the king.', 'checkmates'),
    'fork': ('fork', 'Forks', 'One piece attacks two targets at once.', 'tactics'),
    'pin': ('pin', 'Pins', 'Use or exploit a piece that cannot move without exposing a bigger one.', 'tactics'),
    'skewer': ('skewer', 'Skewers', 'Attack a valuable piece and win the one behind it.', 'tactics'),
    'discovered-attack': ('discoveredAttack', 'Discovered attacks', 'Move one piece to unleash another.', 'tactics'),
    'double-check': ('doubleCheck', 'Double check', 'Two pieces give check at once; only the king can move.', 'tactics'),
    'x-ray': ('xRayAttack', 'X-ray attacks', 'A piece attacks or defends through another.', 'tactics'),
    'interference': ('interference', 'Interference', 'Wedge a piece between two that guard each other.', 'tactics'),
    'clearance': ('clearance', 'Clearance', 'Move a piece out of the way to open a line or square.', 'tactics'),
    'capturing-defender': ('capturingDefender', 'Capturing the defender', 'Take the piece that guards a key square.', 'tactics'),
    'exposed-king': ('exposedKing', 'Exposed king', 'Attack a king with no pawn cover.', 'tactics'),
    'kingside-attack': ('kingsideAttack', 'Kingside attack', 'Storm the castled king.', 'tactics'),
    'hanging-piece': ('hangingPiece', 'Hanging pieces', 'Spot and take material left undefended.', 'tactics'),
    'trapped-piece': ('trappedPiece', 'Trapped pieces', 'Win a piece that has nowhere to go.', 'tactics'),
    'deflection': ('deflection', 'Deflection', 'Lure a defender away from what it guards.', 'tactics'),
    'attraction': ('attraction', 'Attraction', 'Drag a piece, often the king, onto a fatal square.', 'tactics'),
    'sacrifice': ('sacrifice', 'Sacrifices', 'Give material to get something bigger.', 'tactics'),
    'zwischenzug': ('intermezzo', 'Zwischenzug', 'An in-between move before the expected recapture.', 'tactics'),
    'quiet-move': ('quietMove', 'Quiet moves', 'The winning move is not a check or a capture.', 'tactics'),
    'defensive-move': ('defensiveMove', 'Defensive moves', 'Find the only move that holds.', 'tactics'),
    'promotion': ('promotion', 'Promotion', 'Push a pawn through to a new queen.', 'endgames'),
    'underpromotion': ('underPromotion', 'Underpromotion', 'Promote to a knight, rook or bishop when a queen is wrong.', 'endgames'),
    'rook-endgame': ('rookEndgame', 'Rook endgames', 'The most common endgame: precise rook play.', 'endgames'),
    'pawn-endgame': ('pawnEndgame', 'Pawn endgames', 'King and pawns: every tempo counts.', 'endgames'),
    'bishop-endgame': ('bishopEndgame', 'Bishop endgames', 'Bishops of the same or opposite colour, and the pawns that decide.', 'endgames'),
    'knight-endgame': ('knightEndgame', 'Knight endgames', 'Knights are short-range: tempo and pawn races.', 'endgames'),
    'queen-endgame': ('queenEndgame', 'Queen endgames', 'Checks, shelter and pushing the passed pawn.', 'endgames'),
}
TAG_TO_SLUG = {tag: slug for slug, (tag, *_rest) in THEMES.items()}
MIXED, MISSED, WEAK = 'mixed', 'missed', 'weak'

# A weak theme has at least WEAK_MIN_TRIES first tries and a first-try solve
# rate under WEAK_BELOW; WEAK serves puzzles from the WEAK_THEMES weakest.
WEAK_MIN_TRIES = 5
WEAK_BELOW = 0.8
WEAK_THEMES = 3

# Unrated runs: mode -> (start offset from the rating, step per puzzle served,
# lowest target). Streak ends on the first mistake; Storm is a timed sprint.
RUNS = {'streak': (-200, 50, 400), 'storm': (-400, 40, 400)}

SCHEDULER = Scheduler()


class PuzzleError(ValueError):
    pass


def _shape(raw, where):
    """Light check of one pack entry; the moves are checked when it is served."""
    if not isinstance(raw, dict):
        raise PuzzleError(f'{where}: a puzzle must be an object.')
    if not isinstance(raw.get('id'), str) or not raw['id']:
        raise PuzzleError(f'{where}: a puzzle needs an "id".')
    if not isinstance(raw.get('fen'), str):
        raise PuzzleError(f'{where} ({raw["id"]}): "fen" must be text.')
    moves = raw.get('moves')
    if not isinstance(moves, list) or len(moves) < 2 or len(moves) % 2 or not all(isinstance(m, str) and UCI.match(m) for m in moves):
        raise PuzzleError(f'{where} ({raw["id"]}): "moves" must be an even-length list of UCI moves, starting with the opponent\'s.')
    if not isinstance(raw.get('rating'), int):
        raise PuzzleError(f'{where} ({raw["id"]}): "rating" must be a whole number.')


_cache = {'key': None, 'packs': None}


def load_packs(folder=None, mine=None):
    """{'themes': {slug: [puzzle]}, 'by_id': {id: puzzle}, 'problems': [...]}, cached until a file changes.

    `mine` is the MINE pack's file: MINE_FILE by default with the bundled
    folder, none with another folder, False for none.
    """
    folder = Path(folder or PUZZLES_DIR)
    mine = Path(mine) if mine else MINE_FILE if mine is None and folder == PUZZLES_DIR else None
    paths = sorted(folder.glob('*.json')) if folder.is_dir() else []
    paths += [mine] if mine and mine.is_file() else []
    key = (str(folder), tuple((str(p), p.stat().st_mtime_ns) for p in paths))
    if _cache['key'] == key:
        return _cache['packs']
    themes, by_id, problems = {}, {}, []
    for path in paths:
        slug = MINE if path == mine else path.stem
        try:
            if slug not in THEMES:
                raise PuzzleError(f'{slug}: unknown theme. Known themes: {", ".join(THEMES)}.')
            raw = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(raw, dict) or raw.get('version') != 1 or not isinstance(raw.get('puzzles'), list):
                raise PuzzleError(f'{slug}: a pack is {{"version": 1, "puzzles": [...]}}.')
            pack = []
            for i, item in enumerate(raw['puzzles']):
                try:
                    _shape(item, f'{slug}, puzzle {i + 1}')
                except PuzzleError as exc:
                    problems.append(str(exc))
                    continue
                pack.append(by_id.setdefault(item['id'], item))
            themes[slug] = pack
        except json.JSONDecodeError as exc:
            problems.append(f'{slug}: not valid JSON ({exc}).')
        except PuzzleError as exc:
            problems.append(str(exc))
    themes = {slug: themes[slug] for slug in THEMES if slug in themes}
    packs = {'themes': themes, 'by_id': by_id, 'problems': problems}
    _cache.update(key=key, packs=packs)
    return packs


def theme_title(slug, lang='en'):
    """A theme's title in `lang` (content/<lang>/themes.json), English when untranslated."""
    return translations.entry(lang, 'themes', slug, 'title', THEMES[slug][1])


def view(raw, lang='en'):
    """A puzzle ready for the board, with SAN for every move. Raises PuzzleError."""
    try:
        board = chess.Board(raw['fen'])
    except ValueError:
        raise PuzzleError(f'{raw["id"]}: "{raw["fen"]}" is not a FEN.')
    if not board.is_valid():
        raise PuzzleError(f'{raw["id"]}: the position is not a valid chess position.')
    fen = board.fen()
    line = []
    for uci in raw['moves']:
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            raise PuzzleError(f'{raw["id"]}: {uci} is not legal after {" ".join(m["san"] for m in line) or "the start"}.')
        line.append({'uci': uci, 'san': board.san(move)})
        board.push(move)
    tags = raw.get('themes', [])
    return {'id': raw['id'], 'fen': fen, 'setup': line[0], 'moves': line[1:], 'rating': raw['rating'],
            'mate': board.is_checkmate(),
            'themes': [{'slug': TAG_TO_SLUG[t], 'title': theme_title(TAG_TO_SLUG[t], lang)} for t in tags if t in TAG_TO_SLUG],
            'game': raw.get('game')}


# ── Progress ──────────────────────────────────────────────────────────────

def load_state(path):
    try:
        state = json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}
    state.setdefault('rating', START_RATING)
    state.setdefault('rated', 0)
    if not isinstance(state.get('puzzles'), dict):
        state['puzzles'] = {}
    if not isinstance(state.get('history'), list):
        state['history'] = []
    if not isinstance(state.get('runs'), dict):
        state['runs'] = {}
    return state


def save_state(path, state):
    jsonio.write_json(path, state, indent=1)


def _aware(stamp):
    """An ISO timestamp as an aware datetime; a naive one is taken as UTC."""
    at = datetime.fromisoformat(stamp)
    return at if at.tzinfo else at.replace(tzinfo=timezone.utc)


def _review_due(entry):
    return datetime.fromisoformat(entry['review']['due'])


def _missed(state, now=None):
    """Ids to retry: those whose latest attempt was a miss (oldest miss first), then the ones
    missed before whose review is due (most overdue first)."""
    now = now or now_utc()
    missed = [(e.get('last_at', ''), pid) for pid, e in state['puzzles'].items() if e.get('last') == 'missed']
    due = [(_review_due(e), pid) for pid, e in state['puzzles'].items()
           if e.get('last') != 'missed' and e.get('review') and _review_due(e) <= now]
    return [pid for _, pid in sorted(missed)] + [pid for _, pid in sorted(due)]


def reviews(packs, state, now):
    """The retry queue for the day's plan: how many are due now, how many are scheduled, the next due time."""
    due = [pid for pid in _missed(state, now) if pid in packs['by_id']]
    later = [_review_due(e) for pid, e in state['puzzles'].items()
             if pid in packs['by_id'] and e.get('review') and pid not in due]
    return {'due': len(due), 'scheduled': len(due) + len(later), 'next_due': min(later).isoformat() if later else None}


def _reschedule(entry, score, clean, now):
    """Give a missed puzzle an FSRS card, and grade every later attempt on it: Good when clean,
    Hard when solved with a slip, Again when missed. Puzzles solved cleanly at first never get one."""
    if clean and not entry.get('review'):
        return
    card = Card.from_dict(entry['review']) if entry.get('review') else Card()
    rating = Rating.Good if clean else Rating.Hard if score >= SOLVED_MIN else Rating.Again
    card, _ = SCHEDULER.review_card(card, rating, now)
    entry['review'] = card.to_dict()


def weak_themes(packs, state):
    """Theme slugs with enough first tries and a low first-try rate, weakest first (at most WEAK_THEMES)."""
    rates = []
    for slug, pack in packs['themes'].items():
        firsts = [state['puzzles'][p['id']].get('first') for p in pack if p['id'] in state['puzzles']]
        firsts = [f for f in firsts if f]
        rate = firsts.count('solved') / len(firsts) if firsts else 1.0
        if slug != MINE and len(firsts) >= WEAK_MIN_TRIES and rate < WEAK_BELOW:
            rates.append((rate, -len(firsts), slug))
    return [slug for *_rest, slug in sorted(rates)[:WEAK_THEMES]]


def _near(pool, target, rng):
    """A puzzle id close to `target`, widening the window until something fits; None for an empty pool."""
    for window in (100, 200, 350, 600):
        near = [p for p in pool if abs(p['rating'] - target) <= window]
        if near:
            return rng.choice(near)['id']
    return min(pool, key=lambda p: abs(p['rating'] - target))['id'] if pool else None


def pick_next(packs, state, theme, exclude=None, rng=random, now=None):
    """The id of the next puzzle for a theme, MIXED, MISSED or WEAK; None when there is nothing left.

    New puzzles are picked close to the solver's rating, widening the window
    until something fits, so a theme gets harder as the rating climbs. WEAK
    draws from weak_themes() and falls back to MIXED without enough history.
    `exclude` is one id or several.
    """
    skip = {exclude} if isinstance(exclude, str) else set(exclude or ())
    if theme == MISSED:
        queue = [pid for pid in _missed(state, now) if pid in packs['by_id'] and pid not in skip]
        return queue[0] if queue else None
    if theme == WEAK:
        pool = [p for slug in weak_themes(packs, state) for p in packs['themes'][slug]]
        found = _near([p for p in pool if p['id'] not in state['puzzles'] and p['id'] not in skip], state['rating'], rng)
        return found or pick_next(packs, state, MIXED, skip, rng)
    if theme == MIXED:
        pool = list(packs['by_id'].values())
    elif theme in packs['themes']:
        pool = packs['themes'][theme]
    else:
        raise ValueError('There are no puzzles for that theme.')
    return _near([p for p in pool if p['id'] not in state['puzzles'] and p['id'] not in skip], state['rating'], rng)


def run_target(mode, rating, index):
    """The puzzle rating a run aims at for its `index`-th puzzle (0-based): it starts easy and climbs."""
    start, step, floor = RUNS[mode]
    return max(floor, rating + start + step * index)


def pick_run(packs, state, mode, index, exclude=(), rng=random):
    """The next puzzle id for a Streak or Storm run, near run_target(); seen puzzles only once no new one is left."""
    if mode not in RUNS:
        raise ValueError('There is no such puzzle run.')
    skip = set(exclude)
    pool = [p for p in packs['by_id'].values() if p['id'] not in skip]
    target = run_target(mode, state['rating'], max(0, index))
    return _near([p for p in pool if p['id'] not in state['puzzles']], target, rng) or _near(pool, target, rng)


def record_run(state, mode, score, now):
    """Save a finished Streak or Storm run, unrated: the best score and how many runs were played."""
    if not isinstance(mode, str) or mode not in RUNS:
        raise ValueError('There is no such puzzle run.')
    if not isinstance(score, int) or isinstance(score, bool) or score < 0:
        raise ValueError('"score" must be a whole number, zero or more.')
    entry = state['runs'].setdefault(mode, {'best': 0, 'played': 0})
    new_best = score > entry['best']
    if new_best:
        entry.update(best=score, best_at=now.isoformat())
    entry['played'] += 1
    entry['last'] = score
    return {'mode': mode, 'score': score, 'best': entry['best'], 'new_best': new_best, 'played': entry['played']}


def k_factor(rated):
    """Big steps while the rating is new, so it finds its level quickly."""
    return 48 if rated < 30 else 32 if rated < 100 else 20


def grade(raw, misses, hint, revealed, seconds):
    """Score one attempt in [0, 1.2], plus the time-bonus part on its own.

    A clean solve scores 1.0, dropping through MISS_CREDIT for each wrong move
    tried; a hint caps the score at HINT_CAP; revealing the solution scores 0.
    A clean solve under par time (PAR_BASE + PAR_PER_MOVE per solver move)
    earns up to TIME_BONUS_MAX extra; a slow one is never penalised.
    """
    if revealed:
        return 0.0, 0.0
    score = 1.0 if not misses else MISS_CREDIT[min(len(misses), len(MISS_CREDIT)) - 1]
    if hint:
        score = min(score, HINT_CAP)
    bonus = 0.0
    if not misses and not hint and isinstance(seconds, (int, float)):
        par = PAR_BASE + PAR_PER_MOVE * (len(raw['moves']) // 2)
        bonus = TIME_BONUS_MAX * max(0.0, 1.0 - seconds / par)
        score = min(1.0 + TIME_BONUS_MAX, 1.0 + bonus)
    return score, bonus


def record(packs, state, puzzle_id, misses, hint, revealed, seconds, now):
    """Save one finished attempt. Only the first try at a puzzle moves the rating, by its graded score."""
    raw = packs['by_id'].get(puzzle_id)
    if raw is None:
        raise ValueError('This puzzle is not available.')
    if not isinstance(misses, list) or not all(isinstance(m, str) for m in misses):
        raise ValueError('"misses" must be a list of moves.')
    score, bonus = grade(raw, misses, hint, revealed, seconds)
    clean = score >= 1.0  # no misses, no hint, no reveal: achievements count these (achievements.py)
    entry = state['puzzles'].get(puzzle_id)
    rated = entry is None
    delta = 0
    if rated:
        expected = 1 / (1 + 10 ** ((raw['rating'] - state['rating']) / 400))
        delta = round(k_factor(state['rated']) * (score - expected))
        state['rating'] += delta
        state['rated'] += 1
        entry = state['puzzles'][puzzle_id] = {'attempts': 0, 'solved': 0, 'first': 'solved' if score >= SOLVED_MIN else 'missed'}
    entry['attempts'] += 1
    entry['solved'] += 1 if clean else 0
    entry['last'] = 'solved' if score >= SOLVED_MIN else 'missed'
    entry['last_at'] = now.isoformat()
    if clean and isinstance(seconds, (int, float)):
        taken = max(0, round(seconds))
        entry['best_seconds'] = taken if entry.get('best_seconds') is None else min(entry['best_seconds'], taken)
    _reschedule(entry, score, clean, now)
    attempt = {'id': puzzle_id, 'at': now.isoformat(), 'result': entry['last'], 'misses': misses[:20],
               'hint': bool(hint), 'revealed': bool(revealed),
               'seconds': max(0, round(seconds)) if isinstance(seconds, (int, float)) else None,
               'score': round(score, 2), 'time_bonus': round(bonus, 2),
               'puzzle_rating': raw['rating'], 'rated': rated, 'delta': delta, 'rating': state['rating']}
    state['history'] = (state['history'] + [attempt])[-HISTORY_LIMIT:]
    return {**attempt, 'missed_left': len(_missed(state, now)),
            'next_review': entry['review']['due'] if entry.get('review') else None}


def catalog(packs, state, lang='en', now=None):
    """Rating, per-theme stats, the missed count and recent attempts for the overview."""
    now = now or now_utc()
    results = state['puzzles']
    themes = []
    for slug, pack in packs['themes'].items():
        tag, title, summary, group = THEMES[slug]
        title, summary = theme_title(slug, lang), translations.entry(lang, 'themes', slug, 'summary', summary)
        done = [results[p['id']] for p in pack if p['id'] in results]
        firsts = [e for e in done if e.get('first')]
        themes.append({
            'slug': slug, 'title': title, 'summary': summary, 'group': group, 'count': len(pack),
            'attempted': len(done), 'solved_first': sum(1 for e in firsts if e['first'] == 'solved'),
            'missed': sum(1 for e in done if e.get('last') == 'missed'),
            'low': min((p['rating'] for p in pack), default=None), 'high': max((p['rating'] for p in pack), default=None),
        })
    recent = []
    for attempt in reversed(state['history'][-30:]):
        raw = packs['by_id'].get(attempt['id'])
        tags = raw.get('themes', []) if raw else []
        recent.append({**attempt, 'themes': [theme_title(TAG_TO_SLUG[t], lang) for t in tags if t in TAG_TO_SLUG][:3]})
    rated = [a for a in state['history'] if a.get('rated')]
    week_ago = now - timedelta(days=7)
    timed = [a['seconds'] for a in state['history'] if a.get('result') == 'solved' and a.get('seconds') is not None][-AVG_SOLVE_LAST:]
    return {'rating': state['rating'], 'rated': state['rated'], 'total': len(packs['by_id']),
            'missed': len([pid for pid in _missed(state, now) if pid in packs['by_id']]),
            'reviews': reviews(packs, state, now),
            'trend': [a['rating'] for a in rated[-40:]], 'themes': themes,
            # The rating change from rated attempts in the last seven days, and the mean time of recent solves.
            'week': sum(a.get('delta', 0) for a in rated if a.get('at') and _aware(a['at']) >= week_ago),
            'avg_seconds': round(sum(timed) / len(timed)) if timed else None,
            'groups': [g for g in GROUPS if g != 'yours' or MINE in packs['themes']],
            'weak': weak_themes(packs, state),
            'runs': {mode: {k: state['runs'].get(mode, {}).get(k, 0) for k in ('best', 'played')} for mode in RUNS},
            'recent': recent, 'problems': packs['problems']}


def now_utc():
    return datetime.now(timezone.utc)
