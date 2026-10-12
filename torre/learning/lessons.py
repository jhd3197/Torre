"""Lessons: short, step-by-step chess lessons, written as data.

Each lesson is a JSON file in lessons/ (see lessons/README.md). A lesson is a
list of steps, and every step has a kind:

    explain   a position with text, arrows and an optional demo line to step through
    play      the user finds the move (or moves) of a line; the replies are played for them, and
              `branches` give the opponent other replies to pick from
    choose    a multiple-choice question, optionally beside a position
    reel      a game that plays itself like a video, with caption notes as subtitles
    guess     a game that plays itself and stops at key moments for the reader to guess the move
    stars     collect the stars with one piece (or, with "watch", see the coach collect them)
    reach     get one piece to the flag around your own pawns
    capture   of several enemy pieces, take the one the piece can reach
    count     how many squares can the piece reach?

The last four are drills: the step holds a recipe (the piece, how many stars or blockers), and
the page makes a fresh solvable layout from it each time, so a repeat is a new position with the
same goal (web/src/lib/drills.ts).

Lessons are checked when they load: an unknown kind, a missing field or an
illegal move makes the lesson unavailable (listed under `problems`) instead
of breaking halfway through. Moves are checked here; the page grades the
user's moves against the line itself, so lessons need no engine.

Progress (the step reached and when a lesson was finished) lives in
lessons.json next to the other data.
"""

import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

import chess

from torre import translations
from torre import jsonio
from torre import paths
LESSONS_DIR = paths.LESSONS
LOCK = threading.Lock()
CATEGORIES = ('basics', 'openings', 'tactics', 'checkmates', 'endgames', 'strategy', 'history')
LEVELS = ('beginner', 'intermediate', 'advanced')
# The mascot poses a step may show (one image per pose in the art set).
POSES = ('thumbs-up', 'sleepy', 'trophy', 'detective', 'puzzle', 'check', 'star', 'happy', 'wink', 'thinking',
         'playing', 'idea', 'excited', 'confused', 'shocked', 'content', 'determined', 'yawn', 'starry', 'shrug',
         'shield', 'confetti', 'alarm', 'salute', 'dizzy', 'clap', 'sad', 'teary', 'facepalm', 'nervous', 'panic',
         'relieved', 'proud', 'neutral', 'wave', 'point', 'present', 'pointer', 'nod', 'no', 'ready', 'move-piece',
         'calculating', 'notes', 'magnify', 'sheepish', 'bored', 'dancing', 'hug', 'rival',
         'host', 'gift', 'point-board', 'warn', 'study', 'cheer')
SLUG = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')
SQUARE = re.compile(r'^[a-h][1-8]$')
# The id in a YouTube link (watch?v=, youtu.be/, shorts/, embed/) or on its own.
YOUTUBE_ID = re.compile(r'^(?:https?://(?:www\.|m\.)?(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/)|youtu\.be/))?([A-Za-z0-9_-]{11})(?:[?&#].*)?$')
VIDEOS_FILE = paths.CONTENT / 'videos.json'


class LessonError(ValueError):
    pass


def _board(fen, where):
    try:
        board = chess.Board(fen)
    except (ValueError, TypeError):
        raise LessonError(f'{where}: "{fen}" is not a FEN.')
    if not board.is_valid():
        raise LessonError(f'{where}: the position is not a valid chess position.')
    return board


def _text(step, key, where, required=True):
    value = step.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip():
        raise LessonError(f'{where}: "{key}" must be non-empty text.')
    return value


def _mascot(step, where):
    """Optional `narration` (spoken text for the coach) and `pose` (mascot image)."""
    out = {}
    narration = step.get('narration')
    if narration is not None:
        if not isinstance(narration, str) or not narration.strip():
            raise LessonError(f'{where}: "narration" must be non-empty text.')
        out['narration'] = narration.strip()
    pose = step.get('pose')
    if pose is not None:
        if not isinstance(pose, str) or pose not in POSES:
            raise LessonError(f'{where}: "pose" must be one of: {", ".join(POSES)}.')
        out['pose'] = pose
    return out


def _marks(step, where):
    """Arrows ["e2", "e4"] and circled squares ["e4"]."""
    marks = step.get('marks', [])
    if not isinstance(marks, list) or not all(
            isinstance(m, list) and len(m) in (1, 2) and all(isinstance(s, str) and SQUARE.match(s) for s in m) for m in marks):
        raise LessonError(f'{where}: "marks" must be a list of [square] circles or [from, to] arrows.')
    return [{'from': m[0], 'to': m[-1]} for m in marks]


def _line(board, ucis, where):
    """SAN for each UCI move, checking legality as it goes."""
    sans = []
    for uci in ucis:
        try:
            move = chess.Move.from_uci(uci)
        except (ValueError, TypeError):
            move = None
        if move is None or move not in board.legal_moves:
            raise LessonError(f'{where}: {uci} is not legal after {" ".join(sans) or "the start"}.')
        sans.append(board.san(move))
        board.push(move)
    return sans


# In an explain step's narration, `[move]` marks where the next demo move plays: the coach
# says the words before it, the board moves, then the coach carries on.
MOVE_CUE = '[move]'


def _explain(step, where):
    board = _board(step.get('fen'), where)
    demo = step.get('demo', [])
    if not isinstance(demo, list):
        raise LessonError(f'{where}: "demo" must be a list of UCI moves.')
    cues = step.get('narration', '').count(MOVE_CUE) if isinstance(step.get('narration'), str) else 0
    if cues > len(demo):
        raise LessonError(f'{where}: the narration has {cues} {MOVE_CUE} cues but the demo has only {len(demo)} moves.')
    return {'fen': board.fen(), 'text': _text(step, 'text', where), 'marks': _marks(step, where),
            'demo': [{'uci': u, 'san': s} for u, s in zip(demo, _line(board, demo, where))], **_mascot(step, where)}


def _play_line(fen, line, where):
    """One line of a play step: {moves, alternatives, mate}. The last user move may list
    alternatives as "e2e4|d2d4"."""
    board = _board(fen, where)
    if not isinstance(line, list) or not line or not all(isinstance(u, str) for u in line) or len(line) % 2 == 0:
        raise LessonError(f'{where}: "line" must be an odd-length list of UCI moves, starting and ending with yours.')
    if any('|' in u for u in line[:-1]):
        raise LessonError(f'{where}: only the last move of a line can list alternatives.')
    *path, last = line
    sans = _line(board, path, where)
    final = []
    for uci in last.split('|'):
        after = board.copy(stack=False)
        san = _line(after, [uci], where)[0]
        final.append({'uci': uci, 'san': san, 'mate': after.is_checkmate()})
    return {'moves': [{'uci': u, 'san': s} for u, s in zip(path, sans)] + [{'uci': final[0]['uci'], 'san': final[0]['san']}],
            'alternatives': [{'uci': f['uci'], 'san': f['san']} for f in final[1:]], 'mate': final[0]['mate']}


def _play(step, where):
    """The user plays the even moves of `line`; the odd ones are the replies.

    A user move that gives checkmate is always accepted, so lessons need not list every mate.
    `branches` are other whole lines from the same position, each {"line": [...], "success": "..."}:
    where lines part at a reply, the page picks one of them, so the reader meets the opponent who
    does not play along. `nudge` is the first, general hint ("look for a fork"), `hint` the next.
    """
    main = _play_line(step.get('fen'), step.get('line'), where)
    branches = step.get('branches', [])
    if not isinstance(branches, list):
        raise LessonError(f'{where}: "branches" must be a list of {{"line", "success"}} objects.')
    lines, seen = [], {tuple(m['uci'] for m in main['moves'])}
    for i, branch in enumerate(branches):
        at = f'{where}, branch {i + 1}'
        if not isinstance(branch, dict):
            raise LessonError(f'{at}: a branch must be an object with a "line".')
        parsed = _play_line(step['fen'], branch.get('line'), at)
        key = tuple(m['uci'] for m in parsed['moves'])
        if key in seen:
            raise LessonError(f'{at}: this line is already in the step.')
        seen.add(key)
        lines.append({**parsed, 'success': _text(branch, 'success', at, False)})
    return {'fen': _board(step['fen'], where).fen(), 'prompt': _text(step, 'prompt', where),
            'nudge': _text(step, 'nudge', where, False), 'hint': _text(step, 'hint', where, False),
            'success': _text(step, 'success', where, False), 'marks': _marks(step, where), **main,
            'branches': lines, **_mascot(step, where)}


def _choose(step, where):
    options = step.get('options')
    if not isinstance(options, list) or len(options) < 2:
        raise LessonError(f'{where}: "options" needs at least two choices.')
    for i, option in enumerate(options):
        if not isinstance(option, dict):
            raise LessonError(f'{where}: option {i + 1} must be an object.')
        _text(option, 'text', f'{where}, option {i + 1}')
    if sum(1 for o in options if o.get('correct') is True) != 1:
        raise LessonError(f'{where}: exactly one option must be "correct": true.')
    fen = step.get('fen')
    return {'fen': _board(fen, where).fen() if fen else None, 'question': _text(step, 'question', where),
            'marks': _marks(step, where),
            'options': [{'text': o['text'], 'correct': o.get('correct') is True, 'why': o.get('why')} for o in options],
            **_mascot(step, where)}


def _reel(step, where):
    """A game (or a segment of one) the page plays like a video, with subtitles.

    `fen` defaults to the standard start position. `notes` are captions shown
    from their ply on: {"ply": 15, "text": "..."} means the caption appears once
    the 15th move is on the board.
    """
    board = _board(step.get('fen', chess.STARTING_FEN), where)
    moves = step.get('moves')
    if not isinstance(moves, list) or not moves or not all(isinstance(u, str) for u in moves):
        raise LessonError(f'{where}: "moves" must be a non-empty list of UCI moves.')
    notes = step.get('notes', [])
    if not isinstance(notes, list):
        raise LessonError(f'{where}: "notes" must be a list of {{"ply", "text"}} captions.')
    captions = []
    for note in notes:
        if not isinstance(note, dict):
            raise LessonError(f'{where}: each note must be an object with "ply" and "text".')
        ply = note.get('ply')
        if not isinstance(ply, int) or isinstance(ply, bool) or not 1 <= ply <= len(moves):
            raise LessonError(f'{where}: a note\'s "ply" must be a move number from 1 to {len(moves)}.')
        captions.append({'ply': ply, 'text': _text(note, 'text', where)})
    return {'fen': board.fen(), 'text': _text(step, 'text', where), 'marks': _marks(step, where),
            'moves': [{'uci': u, 'san': s} for u, s in zip(moves, _line(board, moves, where))],
            'notes': sorted(captions, key=lambda n: n['ply']), **_mascot(step, where)}


def _guess(step, where):
    """A game that plays itself and stops before each `guesses` ply for the reader to find the move.

    {"ply": 19, "prompt": "...", "hint": "...", "why": "..."} stops with moves 1-18 on the
    board and asks for the 19th. `also` lists other moves good enough to count as found
    (the game move is still the one played on).
    """
    reel = _reel(step, where)
    guesses = step.get('guesses')
    if not isinstance(guesses, list) or not guesses:
        raise LessonError(f'{where}: "guesses" must list at least one {{"ply", "prompt"}} stop.')
    stops, seen = [], set()
    for guess in guesses:
        if not isinstance(guess, dict):
            raise LessonError(f'{where}: each guess must be an object with "ply" and "prompt".')
        ply = guess.get('ply')
        if not isinstance(ply, int) or isinstance(ply, bool) or not 1 <= ply <= len(reel['moves']) or ply in seen:
            raise LessonError(f'{where}: each guess "ply" must be a distinct move number from 1 to {len(reel["moves"])}.')
        seen.add(ply)
        also = guess.get('also', [])
        if not isinstance(also, list) or not all(isinstance(u, str) for u in also):
            raise LessonError(f'{where}: each guess "also" must be a list of UCI moves.')
        board = _board(reel['fen'], where)
        for move in reel['moves'][:ply - 1]:
            board.push(chess.Move.from_uci(move['uci']))
        accepted = []
        for uci in also:
            accepted.append({'uci': uci, 'san': _line(board.copy(stack=False), [uci], where)[0]})
        stops.append({'ply': ply, 'prompt': _text(guess, 'prompt', where), 'nudge': _text(guess, 'nudge', where, False),
                      'hint': _text(guess, 'hint', where, False),
                      'why': _text(guess, 'why', where, False), 'also': accepted})
    return {**reel, 'guesses': sorted(stops, key=lambda g: g['ply'])}


# Drills: the recipe fields each kind takes, as (default, lowest, highest).
DRILL_PIECES = ('R', 'B', 'Q', 'N', 'K')
DRILL_FIELDS = {
    'stars': {'stars': (3, 1, 5), 'blockers': (0, 0, 8)},
    'reach': {'blockers': (3, 0, 10), 'distance': (2, 2, 4)},
    'capture': {'enemies': (3, 2, 4), 'blockers': (1, 0, 6)},
    'count': {'blockers': (1, 0, 4), 'enemies': (1, 0, 3)},
}


def _drill(kind):
    def parse_drill(step, where):
        piece = step.get('piece')
        if piece not in DRILL_PIECES:
            raise LessonError(f'{where}: "piece" must be one of {", ".join(DRILL_PIECES)} (rook, bishop, queen, knight, king).')
        out = {'piece': piece}
        for key, (default, low, high) in DRILL_FIELDS[kind].items():
            value = step.get(key, default)
            if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
                raise LessonError(f'{where}: "{key}" must be a whole number from {low} to {high}.')
            out[key] = value
        watch = step.get('watch', False)
        if not isinstance(watch, bool) or (watch and kind != 'stars'):
            raise LessonError(f'{where}: "watch" is true or false, and only a stars step can be watched.')
        if watch:
            out['watch'] = True
        for key in ('prompt', 'nudge', 'success'):
            text = _text(step, key, where, False)
            if text is not None:
                out[key] = text
        return {**out, **_mascot(step, where)}
    return parse_drill


# The step kinds a lesson may use. A kind missing here is refused at load time,
# so a lesson can never reach a step the page cannot show.
KINDS = {'explain': _explain, 'play': _play, 'choose': _choose, 'reel': _reel, 'guess': _guess,
         **{kind: _drill(kind) for kind in DRILL_FIELDS}}
# Kinds the reader only watches or reads; every other kind is answered and scored (story.py).
WATCHED = ('explain', 'reel')


def is_scored(step):
    """Whether finishing the step posts a result: answered kinds, except a drill shown with "watch"."""
    return step['kind'] in KINDS and step['kind'] not in WATCHED and not step.get('watch')


def parse(raw, slug):
    """A checked, normalized lesson from its JSON object. Raises LessonError."""
    if not SLUG.match(slug):
        raise LessonError(f'{slug}: file names must be lowercase words joined by dashes.')
    if raw.get('version') != 1:
        raise LessonError(f'{slug}: unsupported "version" (expected 1).')
    if raw.get('category') not in CATEGORIES:
        raise LessonError(f'{slug}: "category" must be one of {", ".join(CATEGORIES)}.')
    if raw.get('level') not in LEVELS:
        raise LessonError(f'{slug}: "level" must be one of {", ".join(LEVELS)}.')
    minutes = raw.get('minutes')
    if not isinstance(minutes, int) or minutes < 1:
        raise LessonError(f'{slug}: "minutes" must be a positive whole number.')
    requires = raw.get('requires', [])
    if not isinstance(requires, list) or not all(isinstance(r, str) for r in requires):
        raise LessonError(f'{slug}: "requires" must be a list of lesson slugs.')
    orientation = raw.get('orientation', 'white')
    if orientation not in ('white', 'black'):
        raise LessonError(f'{slug}: "orientation" must be white or black.')
    unit = raw.get('unit')
    if unit is not None and (not isinstance(unit, str) or not unit.strip()):
        raise LessonError(f'{slug}: "unit" must be non-empty text (a series name, like "Paul Morphy").')
    position = raw.get('order', 0)
    if not isinstance(position, int) or isinstance(position, bool):
        raise LessonError(f'{slug}: "order" must be a whole number (its place within the unit).')
    practice = raw.get('practice')
    if practice is not None and (not isinstance(practice, str) or not SLUG.match(practice)):
        raise LessonError(f'{slug}: "practice" must be a puzzle theme slug, like "fork".')
    steps = raw.get('steps')
    if not isinstance(steps, list) or not steps:
        raise LessonError(f'{slug}: a lesson needs at least one step.')
    parsed, ids = [], set()
    for i, step in enumerate(steps):
        where = f'{slug}, step {i + 1}'
        if not isinstance(step, dict):
            raise LessonError(f'{where}: a step must be an object.')
        step_id = step.get('id')
        if not isinstance(step_id, str) or not SLUG.match(step_id) or step_id in ids:
            raise LessonError(f'{where}: every step needs a unique "id" in lowercase-dash form.')
        ids.add(step_id)
        kind = step.get('kind')
        if kind not in KINDS:
            raise LessonError(f'{where}: unknown kind "{kind}". Known kinds: {", ".join(KINDS)}.')
        if step.get('orientation', orientation) not in ('white', 'black'):
            raise LessonError(f'{where}: "orientation" must be white or black.')
        item = {'id': step_id, 'kind': kind, 'title': _text(step, 'title', where, False),
                'orientation': step.get('orientation', orientation), **KINDS[kind](step, where)}
        # The page reads this instead of keeping its own list of answered kinds.
        item['scored'] = is_scored(item)
        parsed.append(item)
    return {'slug': slug, 'title': _text(raw, 'title', slug), 'summary': _text(raw, 'summary', slug),
            'category': raw['category'], 'level': raw['level'], 'minutes': minutes, 'requires': requires,
            'unit': unit, 'order': position, 'practice': practice, 'video': None,
            'orientation': orientation, 'steps': parsed}


UNITS_FILE = 'units.json'


def load_units(folder):
    """{category: [unit, ...]}: the order the series of each category appear in (units.json)."""
    try:
        units = json.loads((Path(folder) / UNITS_FILE).read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return {c: [u for u in names if isinstance(u, str)] for c, names in units.items() if isinstance(names, list)}


def youtube_id(link):
    """The 11-character id from a YouTube link or a bare id; None for anything else."""
    match = YOUTUBE_ID.match(link.strip()) if isinstance(link, str) else None
    return match and match.group(1)


def attach_videos(lessons, path):
    """Give each lesson the video content/videos.json links to it (a full review before a Short),
    once its YouTube link is filled in. Returns the problems found in the file."""
    try:
        videos = json.loads(Path(path).read_text(encoding='utf-8')).get('videos', [])
    except FileNotFoundError:
        return []
    except (json.JSONDecodeError, AttributeError):
        return [f'{Path(path).name}: not a valid video list.']
    problems = []
    for video in sorted((v for v in videos if isinstance(v, dict)), key=lambda v: v.get('kind') != 'review'):
        name, slug, link = video.get('id', '?'), video.get('lesson'), video.get('youtube') or ''
        if slug and slug not in lessons:
            problems.append(f'video {name}: unknown lesson "{slug}".')
        elif link and not youtube_id(link):
            problems.append(f'video {name}: "{link}" is not a YouTube link.')
        elif slug and link and lessons[slug]['video'] is None:
            lessons[slug]['video'] = {'youtube': youtube_id(link)}
    return problems


def load_all(folder=None, videos=None):
    """({slug: lesson}, [problem, ...]) for every lesson file in the folder, read and checked again
    only when a file there changes. The bundled lessons take their videos from content/videos.json.
    The result is shared: read-only (localize() copies)."""
    videos = videos or (VIDEOS_FILE if folder is None else None)
    folder = Path(folder or LESSONS_DIR)
    version = tuple((path.name, jsonio.stamp(path)) for path in sorted(folder.glob('*.json')))
    if videos:
        version += ((str(videos), jsonio.stamp(videos)),)
    return jsonio.memo(('lessons', str(folder), str(videos)), version, lambda: _load_all(folder, videos))


def _load_all(folder, videos=None):
    lessons, problems = {}, []
    for path in sorted(Path(folder).glob('*.json')):
        if path.name == UNITS_FILE:
            continue
        try:
            raw = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(raw, dict):
                raise LessonError(f'{path.stem}: a lesson file must hold one JSON object.')
            lessons[path.stem] = parse(raw, path.stem)
        except json.JSONDecodeError as exc:
            problems.append(f'{path.stem}: not valid JSON ({exc}).')
        except LessonError as exc:
            problems.append(str(exc))
    for lesson in lessons.values():
        missing = [r for r in lesson['requires'] if r not in lessons]
        if missing:
            problems.append(f'{lesson["slug"]}: requires unknown lesson(s) {", ".join(missing)}.')
            lesson['requires'] = [r for r in lesson['requires'] if r in lessons]
    if videos:
        problems += attach_videos(lessons, videos)
    order = {c: i for i, c in enumerate(CATEGORIES)}
    # A category's loose lessons come first by level; then each unit (a series), in units.json order
    # (unlisted units after, by name), each in its own `order`.
    units = load_units(folder)

    def unit_rank(lesson):
        listed = units.get(lesson['category'], [])
        return (listed.index(lesson['unit']) if lesson['unit'] in listed else len(listed), lesson['unit'] or '')

    lessons = dict(sorted(lessons.items(), key=lambda kv: (
        order[kv[1]['category']], kv[1]['unit'] is not None, unit_rank(kv[1]), kv[1]['order'],
        LEVELS.index(kv[1]['level']), kv[0])))
    return lessons, problems


# The text a translation overlay may replace (lessons/<lang>/<slug>.json); everything else in a
# lesson (ids, positions, moves, ply numbers) always comes from the English file.
TEXT_FIELDS = {'title', 'summary', 'text', 'narration', 'prompt', 'nudge', 'hint', 'success', 'question', 'why'}


def _merge_text(target, overlay):
    """Copy translated text from `overlay` onto `target` (in place), matching steps by id and
    other lists by position. Only TEXT_FIELDS strings change."""
    if isinstance(target, dict) and isinstance(overlay, dict):
        for key, value in overlay.items():
            if key in TEXT_FIELDS and isinstance(value, str) and value.strip() and isinstance(target.get(key), str):
                target[key] = value
            elif key == 'steps' and isinstance(value, list) and isinstance(target.get('steps'), list):
                by_id = {step.get('id'): step for step in target['steps']}
                for step in value:
                    if isinstance(step, dict) and step.get('id') in by_id:
                        _merge_text(by_id[step['id']], step)
            elif isinstance(target.get(key), (dict, list)):
                _merge_text(target[key], value)
    elif isinstance(target, list) and isinstance(overlay, list):
        for item, translated in zip(target, overlay):
            _merge_text(item, translated)


def localize(lesson, lang, folder=None):
    """The lesson in `lang`: a copy with its translation overlay merged in. `unit` stays the English
    key (units.json order, art) and `unitTitle` is the name to show."""
    out = json.loads(json.dumps(lesson))
    out['unitTitle'] = lesson['unit']
    if lang == 'en':
        return out
    overlay = translations.load(Path(folder or LESSONS_DIR) / lang / f'{lesson["slug"]}.json')
    if overlay:
        _merge_text(out, overlay)
        if isinstance(overlay.get('unit'), str) and overlay['unit'].strip() and lesson['unit']:
            out['unitTitle'] = overlay['unit']
    return out


def load_state(path):
    try:
        state = json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}
    if not isinstance(state.get('lessons'), dict):
        state['lessons'] = {}
    return state


def save_state(path, state):
    jsonio.write_json(path, state, indent=1)


DONE = 'done'


def position(lesson, entry):
    """The step to resume at, as an index. Progress keeps the id of that step (`at`), so adding,
    removing or reordering steps in the lesson file keeps the reader where they were; an entry
    saved before ids were kept falls back to its index."""
    count = len(lesson['steps'])
    at = (entry or {}).get('at')
    if at == DONE:
        return count
    if at:
        found = next((i for i, step in enumerate(lesson['steps']) if step['id'] == at), None)
        if found is not None:
            return found
    return min((entry or {}).get('step', 0), count)


def catalog(lessons, problems, state):
    """Cards for the lesson list: no steps, plus each lesson's progress."""
    cards = []
    for slug, lesson in lessons.items():
        progress = state['lessons'].get(slug, {})
        cards.append({**{k: lesson.get(k) for k in ('slug', 'title', 'summary', 'category', 'level', 'minutes', 'requires', 'unit', 'unitTitle', 'practice', 'video')},
                      'steps': len(lesson['steps']), 'step': position(lesson, progress),
                      'completed': progress.get('completed'), 'skipped': bool(progress.get('skipped'))})
    return {'lessons': cards, 'problems': problems}


def record(lessons, state, slug, step, now):
    """Save that the user reached `step` (a step index); step == len(steps) finishes the lesson."""
    lesson = lessons.get(slug)
    if lesson is None:
        raise ValueError('This lesson is not available.')
    if not isinstance(step, int) or isinstance(step, bool) or not 0 <= step <= len(lesson['steps']):
        raise ValueError('That step is not part of this lesson.')
    entry = state['lessons'].setdefault(slug, {'step': 0, 'completed': None})
    entry['step'] = step
    entry['at'] = lesson['steps'][step]['id'] if step < len(lesson['steps']) else DONE
    entry['updated'] = now.isoformat()
    if step == len(lesson['steps']) and (not entry.get('completed') or entry.get('skipped')):
        # Taking a lesson marked known makes it a lesson taken, stars and all.
        entry['completed'] = now.isoformat()
        entry.pop('skipped', None)
    return entry


def skip(lessons, state, slug, now):
    """Mark a lesson known without taking it ("I already know this", or passing its placement
    check): finished, flagged `skipped`, so it earns no stars or XP. A lesson already finished
    stays as it was."""
    lesson = lessons.get(slug)
    if lesson is None:
        raise ValueError('This lesson is not available.')
    entry = state['lessons'].setdefault(slug, {'step': 0, 'completed': None})
    if entry.get('completed'):
        return entry
    # The step stays where it was, so opening the lesson later still walks through it from the start.
    entry.update({'completed': now.isoformat(), 'updated': now.isoformat(), 'skipped': True})
    return entry


def now_utc():
    return datetime.now(timezone.utc)
