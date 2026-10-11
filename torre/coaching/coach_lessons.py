"""Lessons the coach builds for you: one from a game you played, and the day's practice session.

Both are ordinary lessons (lessons.py) built on request, so the lesson page plays them with
narration, stars and XP like any other. What a generated lesson holds is saved as a plan in
coach-lessons.json: which game moments, puzzles and teaching steps, and the skill each step trains
(coach_ledger.py reads that back to count your answers). The words are drawn from the plan when the
lesson is opened, in the app's language.

    game-<id>                 the biggest one or two slips of a game: what you played, how it was
                              punished, the better move to find, and what went wrong
    session-<date>-<skill>    a focus skill (coach_focus.py): your own slip with it, a teaching step
                              from a lesson that teaches it, puzzles near your rating, one to retry
    placement-<category>      a quick check over a category's lessons you have not taken: each
                              lesson's last exercise; a lesson whose check is solved cleanly can be
                              marked known (lessons.skip), so you skip what you already know

Everything the coach says is a line from web/src/i18n/locales/<lang>/coachlines.json (and the move
words of commentary.json), each recorded on its own by narrate.py. A narration plays its pieces
back to back: PART separates them, and lessons.MOVE_CUE marks where a demo move plays.
"""
import hashlib
import json
import random
import re
import threading
from datetime import date
from pathlib import Path

import chess

from torre.analysis import game_moves
from torre.learning import lessons
from torre.coaching import skills
from torre import translations
from torre import jsonio
from torre import paths
ROOT = paths.REPO
LOCALES = ROOT / 'web' / 'src' / 'i18n' / 'locales'
FILE = 'coach-lessons.json'
PART = '|'
LOCK = threading.Lock()
MOMENTS = 2               # slips a game lesson covers at most
PLACEMENT = 8             # lessons a placement check covers at once, in path order
MIN_DROP = 5              # win% a mistake must have thrown away to be worth a lesson (the grade does the rest)
PRACTICE = 3              # new puzzles in a session
PIECES = {chess.PAWN: 'pawn', chess.KNIGHT: 'knight', chess.BISHOP: 'bishop', chess.ROOK: 'rook',
          chess.QUEEN: 'queen', chess.KING: 'king'}


# ── The coach's lines ─────────────────────────────────────────────────────────────────────────

def _merged(english, translated):
    if isinstance(english, dict) and isinstance(translated, dict):
        return {key: _merged(value, translated.get(key)) for key, value in english.items()}
    return english if translated is None else translated


def _locale(lang, namespace):
    english = json.loads((LOCALES / 'en' / f'{namespace}.json').read_text(encoding='utf-8'))
    path = LOCALES / lang / f'{namespace}.json'
    translated = json.loads(path.read_text(encoding='utf-8')) if lang != 'en' and path.exists() else {}
    return _merged(english, translated)


def fill(template, **values):
    return re.sub(r'\{\{\s*(\w+)\s*\}\}', lambda m: str(values.get(m.group(1), m.group(0))), template)


class Lines:
    """The coach's recorded lines in one language. Pools ([...] in the file) are drawn by a seed, so
    a lesson says the same thing every time it is opened."""

    def __init__(self, lang='en'):
        self.lang = lang if (LOCALES / lang / 'coachlines.json').exists() else 'en'
        self.tree = _locale(self.lang, 'coachlines')
        self.moves = _locale(self.lang, 'commentary')['move']
        self.domains = self.tree['_domains']

    def raw(self, key, tree=None):
        node = tree if tree is not None else self.tree
        for part in key.split('.'):
            node = node.get(part) if isinstance(node, dict) else None
        return node

    def t(self, key, seed=0, **values):
        node = self.raw(key)
        if isinstance(node, list):
            node = node[seed % len(node)] if node else ''
        return fill(node, **values) if isinstance(node, str) else ''

    def text(self, key, **values):
        """A display-only string (the `_text` block: titles and summaries, never said aloud)."""
        return self.t(f'_text.{key}', **values)

    def counted(self, key, n, seed=0):
        """The '1' line for one, the 'other' line for a count with a recording; None otherwise."""
        if n == 1:
            return self.t(f'{key}.1', seed)
        low, high = self.domains['count']
        return self.t(f'{key}.other', seed, count=n) if low <= n <= high else None

    def in_domain(self, name, n):
        low, high = self.domains[name]
        return isinstance(n, int) and low <= n <= high

    def skill(self, skill, field='name'):
        return self.t(f'skills.{skill}.{field}')

    def move_words(self, board, move):
        """A move in recorded words ('knight takes on f5', 'with check'), as commentary.ts moveWords()."""
        words = []
        if board.is_castling(move):
            words.append(self.moves['castleLong' if chess.square_file(move.to_square) == 2 else 'castleShort'])
        else:
            piece = PIECES[board.piece_type_at(move.from_square)]
            kind = 'takes' if board.is_capture(move) else 'to'
            words.append(fill(self.moves[kind][piece], square=chess.square_name(move.to_square)))
            if move.promotion:
                words.append(self.moves['promote'][PIECES[move.promotion]])
        after = board.copy(stack=False)
        after.push(move)
        if after.is_checkmate():
            words.append(self.moves['mate'])
        elif after.is_check():
            words.append(self.moves['check'])
        return words


def spoken(*parts):
    """Narration pieces said back to back (each a recorded line)."""
    return PART.join(p for p in parts if p)


def seed_of(text):
    return int(hashlib.sha256(text.encode('utf-8')).hexdigest()[:8], 16)


# ── The registry of generated lessons ─────────────────────────────────────────────────────────

def load(data_dir):
    try:
        state = json.loads((Path(data_dir) / FILE).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        state = {}
    if not isinstance(state, dict) or not isinstance(state.get('lessons'), dict):
        state = {'lessons': {}}
    return state


def save(data_dir, state):
    path = Path(data_dir) / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    jsonio.write_json(path, state, indent=1)


def slug_for_game(game_id):
    return 'game-' + (re.sub(r'[^a-z0-9]+', '-', game_id.lower()).strip('-') or 'game')


def session_slug(skill, day):
    return f'session-{day.isoformat()}-{skill}'


# ── Reading games ─────────────────────────────────────────────────────────────────────────────

def find_game(data_dir, game_id):
    """(game record, current analysis) for a game id; either may be None."""
    from torre.coaching import coach_ledger
    return coach_ledger._games(data_dir).get(game_id), coach_ledger._analyses(data_dir).get(game_id)


def _board_at(game, ply):
    """The board after `ply` half-moves of a game record, and the game's moves."""
    parsed = game_moves.parse_game(game)
    if parsed is None:
        return None, []
    board = parsed['board'].copy()
    for move in parsed['moves'][:ply]:
        board.push(move)
    return board, parsed['moves']


def moments(game, analysis, scan_rows=()):
    """The game's worst slips of yours, biggest first: [{ply, drop, skill, kind}] (at most MOMENTS)."""
    color = game.get('user_color')
    if color not in ('white', 'black'):
        return []
    parity = 1 if color == 'white' else 0
    best = analysis.get('best_moves') or []
    tags = {}
    for row in scan_rows:
        skill = skills.skill_for_tag(row.get('tag'))
        if skill and row.get('ply') not in tags:
            tags[row['ply']] = (skill, row.get('kind'))
    found = []
    for worst in analysis.get('worst_moves') or []:
        ply = worst.get('ply')
        if worst.get('class') not in ('mistake', 'blunder') or not isinstance(ply, int) or ply % 2 != parity:
            continue
        has_drop = isinstance(worst.get('win_before'), (int, float)) and isinstance(worst.get('win_after'), (int, float))
        drop = worst['win_before'] - worst['win_after'] if has_drop else 100.0 if worst['class'] == 'blunder' else 50.0
        if drop < MIN_DROP or ply - 1 >= len(best) or not best[ply - 1]:
            continue
        skill, kind = tags.get(ply, (None, None))
        found.append({'ply': ply, 'drop': round(drop, 1), 'skill': skill, 'kind': kind})
    found.sort(key=lambda m: -m['drop'])
    return sorted(found[:MOMENTS], key=lambda m: m['ply'])


# ── Plans ─────────────────────────────────────────────────────────────────────────────────────

def plan_game(data_dir, game_id, scan_rows=()):
    """The plan for a game's lesson, or None when the game has nothing worth one (or no analysis)."""
    game, analysis = find_game(data_dir, game_id)
    if not game or not analysis:
        return None
    found = moments(game, analysis, scan_rows)
    if not found:
        return None
    steps = [{'id': 'intro', 'type': 'game-intro'}]
    for i, m in enumerate(found, 1):
        ref = {'game': game_id, 'ply': m['ply'], 'skill': m['skill'], 'kind': m['kind']}
        steps.append({'id': f'moment-{i}', 'type': 'moment-show', **ref})
        steps.append({'id': f'find-{i}', 'type': 'moment-play', **ref})
        if m['skill']:
            steps.append({'id': f'why-{i}', 'type': 'moment-choose', **ref})
    steps.append({'id': 'outro', 'type': 'game-outro'})
    return {'kind': 'game', 'game': game_id, 'color': game.get('user_color'),
            'opponent': game.get('opponent'), 'created': date.today().isoformat(), 'steps': steps}


def _teaching_steps(skill, used=()):
    """(lesson slug, explain step id, play step id) from the most direct lesson teaching the skill
    whose steps a recent session has not shown already."""
    for slug in skills.teaching_lessons(skill):
        try:
            raw = json.loads((lessons.LESSONS_DIR / f'{slug}.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        steps = raw.get('steps') or []
        explain = next((s for s in steps if s.get('kind') == 'explain'), None)
        play = next((s for s in steps if s.get('kind') == 'play'), None)
        if explain and play and slug not in used:
            return slug, explain['id'], play['id']
    return None


def _puzzle_pool(packs, skill):
    themes = [t for t in skills.SKILLS[skill]['puzzle_themes'] if packs['themes'].get(t)]
    pool, seen = [], set()
    for theme in themes:
        for p in packs['themes'][theme]:
            if p['id'] not in seen:
                seen.add(p['id'])
                pool.append(p)
    return pool


def plan_session(data_dir, skill, day, ledger_row=None, used_moments=(), used_lessons=()):
    """The plan for a day's session on one skill."""
    from torre.learning import puzzles
    rng = random.Random(seed_of(session_slug(skill, day)))
    steps = [{'id': 'intro', 'type': 'session-intro', 'skill': skill}]
    # Your own slip with this skill, the newest not shown in a session yet.
    for evidence in (ledger_row or {}).get('evidence', []):
        ref = evidence.get('ref') or {}
        key = f"{ref.get('game')}:{ref.get('ply')}"
        if evidence.get('src') == 'game' and ref.get('ply') and key not in used_moments:
            game, analysis = find_game(data_dir, ref['game'])
            best = (analysis or {}).get('best_moves') or []
            if game and analysis and ref['ply'] - 1 < len(best) and best[ref['ply'] - 1]:
                moment = {'game': ref['game'], 'ply': ref['ply'], 'skill': skill, 'kind': ref.get('kind')}
                steps += [{'id': 'moment', 'type': 'moment-show', **moment}, {'id': 'find', 'type': 'moment-play', **moment}]
                break
    teach = _teaching_steps(skill, used_lessons)
    if teach:
        slug, explain_id, play_id = teach
        steps += [{'id': 'teach-explain', 'type': 'teach', 'lesson': slug, 'step': explain_id, 'skill': skill},
                  {'id': 'teach-play', 'type': 'teach', 'lesson': slug, 'step': play_id, 'skill': skill}]
    try:
        packs = puzzles.load_packs()
    except puzzles.PuzzleError:
        packs = {'themes': {}, 'by_id': {}}
    progress = puzzles.load_state(Path(data_dir) / 'puzzles.json')
    picked = []
    # Puzzles mined from your own games come first: they are this exact weakness.
    mine = [p for p in packs['themes'].get(puzzles.MINE, []) if skill in skills.skills_for_puzzle_tags(p.get('themes'))
            and p['id'] not in progress['puzzles']]
    if mine:
        picked.append(rng.choice(mine)['id'])
    pool = [p for p in _puzzle_pool(packs, skill) if p['id'] not in progress['puzzles'] and p['id'] not in picked]
    while len(picked) < PRACTICE and pool:
        found = puzzles._near(pool, progress['rating'], rng)
        if not found:
            break
        picked.append(found)
        pool = [p for p in pool if p['id'] != found]
    for i, pid in enumerate(picked, 1):
        steps.append({'id': f'puzzle-{i}', 'type': 'puzzle', 'puzzle': pid, 'skill': skill})
    themed = {p['id'] for p in _puzzle_pool(packs, skill)}
    retry = next((pid for pid in puzzles._missed(progress) if pid in themed), None)
    if retry:
        steps.append({'id': 'retry', 'type': 'puzzle', 'puzzle': retry, 'skill': skill, 'review': True})
    steps.append({'id': 'outro', 'type': 'session-outro', 'skill': skill})
    return {'kind': 'session', 'skill': skill, 'day': day.isoformat(), 'created': date.today().isoformat(), 'steps': steps}


def placement_slug(category):
    return f'placement-{category}'


def plan_placement(category, done=()):
    """The plan for a category's placement check: the last exercise of each lesson not taken yet
    (in path order, PLACEMENT at most), or None when there is none left to check."""
    loaded, _ = lessons.load_all()
    owners = skills.lesson_skills()
    picks = []
    for slug, lesson in loaded.items():
        if lesson['category'] != category or slug in done:
            continue
        exercise = next((s for s in reversed(lesson['steps']) if s['kind'] == 'play'), None)
        if exercise:
            picks.append({'lesson': slug, 'step': exercise['id'], 'skill': owners.get(slug)})
        if len(picks) == PLACEMENT:
            break
    if not picks:
        return None
    steps = [{'id': 'intro', 'type': 'placement-intro', 'count': len(picks)}]
    steps += [{'id': f'check-{i}', 'type': 'teach', **pick} for i, pick in enumerate(picks, 1)]
    return {'kind': 'placement', 'category': category, 'created': date.today().isoformat(), 'steps': steps}


def ensure_placement(data_dir, category, done=()):
    """The slug of a category's placement check, planned afresh (what is left changes as you go);
    None when every lesson there is taken."""
    plan = plan_placement(category, done)
    if plan is None:
        return None
    slug = placement_slug(category)
    with LOCK:
        state = load(data_dir)
        state['lessons'][slug] = plan
        save(data_dir, state)
    return slug


def ensure_game(data_dir, game_id, scan_rows=()):
    """The slug of a game's lesson, planning it the first time; None when there is nothing to teach."""
    slug = slug_for_game(game_id)
    with LOCK:
        state = load(data_dir)
        if slug in state['lessons']:
            return slug
    plan = plan_game(data_dir, game_id, scan_rows)
    if plan is None:
        return None
    with LOCK:
        state = load(data_dir)
        state['lessons'].setdefault(slug, plan)
        save(data_dir, state)
    return slug


def ensure_session(data_dir, skill, day, ledger_row=None):
    """The slug of the day's session for a skill, planning it the first time."""
    slug = session_slug(skill, day)
    with LOCK:
        state = load(data_dir)
        if slug in state['lessons']:
            return slug
        recent = [p for p in state['lessons'].values() if p.get('kind') == 'session' and p.get('skill') == skill]
    used_moments = {f"{s.get('game')}:{s.get('ply')}" for p in recent for s in p['steps'] if s.get('type') == 'moment-show'}
    used_lessons = {s.get('lesson') for p in sorted(recent, key=lambda p: p.get('day', ''))[-2:] for s in p['steps']
                    if s.get('type') == 'teach'}
    plan = plan_session(data_dir, skill, day, ledger_row, used_moments, used_lessons)
    with LOCK:
        state = load(data_dir)
        state['lessons'].setdefault(slug, plan)
        save(data_dir, state)
    return slug


# ── Rendering a plan into a lesson ────────────────────────────────────────────────────────────

def _raw_lesson_step(slug, step_id, lang):
    """A hand-written lesson's step as written (raw JSON), with its translation merged in."""
    try:
        raw = json.loads((lessons.LESSONS_DIR / f'{slug}.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    if lang != 'en':
        overlay = translations.load(lessons.LESSONS_DIR / lang / f'{slug}.json')
        if overlay:
            lessons._merge_text(raw, overlay)
    step = next((s for s in raw.get('steps') or [] if s.get('id') == step_id), None)
    if step and 'orientation' not in step:
        step = {**step, 'orientation': raw.get('orientation', 'white')}
    return step


def _side(board):
    return 'white' if board.turn == chess.WHITE else 'black'


def _moment(step, cache):
    """(board before your move, your move, best move, analysis) for a moment step; None if unreadable."""
    key = step['game']
    if key not in cache:
        cache[key] = None
        found = cache.get('_data_dir') and find_game(cache['_data_dir'], step['game'])
        if found and found[0] and found[1]:
            cache[key] = found
    if not cache[key]:
        return None
    game, analysis = cache[key]
    ply = step['ply']
    board, moves = _board_at(game, ply - 1)
    best = (analysis.get('best_moves') or [None] * ply)
    if board is None or ply - 1 >= len(moves) or ply - 1 >= len(best) or not best[ply - 1]:
        return None
    played = moves[ply - 1]
    try:
        better = chess.Move.from_uci(best[ply - 1])
    except ValueError:
        return None
    if better not in board.legal_moves or played == better:
        return None
    after = board.copy(stack=False)
    after.push(played)
    reply = None
    if ply < len(best) and best[ply]:
        try:
            candidate = chess.Move.from_uci(best[ply])
            reply = candidate if candidate in after.legal_moves else None
        except ValueError:
            reply = None
    return board, played, better, reply


def _render_step(step, plan, lines, cache):
    seed = seed_of(f"{plan.get('game') or plan.get('skill')}:{step['id']}")
    kind = step['type']
    skill = step.get('skill')
    if kind == 'game-intro':
        return {'kind': 'explain', 'fen': cache['_intro_fen'], 'text': lines.t('lesson.gameIntro', seed),
                'narration': lines.t('lesson.gameIntro', seed), 'pose': 'detective'}
    if kind == 'game-outro':
        return {'kind': 'explain', 'fen': cache['_last_fen'], 'text': lines.t('lesson.gameOutro', seed),
                'narration': lines.t('lesson.gameOutro', seed), 'pose': 'nod'}
    if kind == 'session-intro':
        text = lines.t('lesson.sessionIntro', skill=lines.skill(skill))
        idea = lines.skill(skill, 'idea')
        return {'kind': 'explain', 'fen': cache['_intro_fen'], 'text': f'{text} {idea}',
                'narration': spoken(text, idea), 'pose': 'present'}
    if kind == 'placement-intro':
        category = _locale(lines.lang, 'lessons')['categories'].get(plan['category'], plan['category'])
        text = lines.text('placementIntro', count=step['count'], category=category)
        return {'kind': 'explain', 'fen': cache['_intro_fen'], 'text': text, 'title': lines.text('placementTitle', category=category),
                'pose': 'present'}
    if kind == 'session-outro':
        line = lines.t('lesson.sessionOutro', seed)
        return {'kind': 'explain', 'fen': cache['_last_fen'], 'text': line, 'narration': line, 'pose': 'clap'}
    if kind == 'teach':
        raw = _raw_lesson_step(step['lesson'], step['step'], lines.lang)
        return raw and {**raw, 'id': step['id']}
    if kind == 'puzzle':
        from torre.learning import puzzles
        raw = cache['_packs']['by_id'].get(step['puzzle']) if cache.get('_packs') else None
        if not raw:
            return None
        board = chess.Board(raw['fen'])
        board.push(chess.Move.from_uci(raw['moves'][0]))
        prompt = lines.t('lesson.review') if step.get('review') else lines.t('lesson.practice', seed)
        cache['_last_fen'] = board.fen()
        return {'kind': 'play', 'fen': board.fen(), 'orientation': _side(board), 'prompt': prompt, 'narration': prompt,
                'hint': lines.skill(skill, 'idea'), 'success': lines.t('lesson.solved', seed), 'line': raw['moves'][1:],
                'pose': 'puzzle'}
    found = _moment(step, cache)
    if not found:
        return None
    board, played, better, reply = found
    number = board.fullmove_number
    cache['_last_fen'] = board.fen()
    if kind == 'moment-show':
        # "On move 14, you played | knight to e7 [move] Then your opponent answers with | bishop takes
        # on c6 [move] This move left a piece with no defender." Each move plays after its words.
        said_number = lines.t('lesson.onMove', move=number) if lines.in_domain('move', number) else ''
        beats = [spoken(said_number, *lines.move_words(board, played))]
        text = [f"{lines.t('lesson.onMove', move=number)} {board.san(played)}."]
        demo = [played.uci()]
        if reply:
            after = board.copy(stack=False)
            after.push(played)
            beats.append(spoken(lines.t('lesson.reply'), *lines.move_words(after, reply)))
            text.append(f"{lines.t('lesson.reply')} {after.san(reply)}.")
            demo.append(reply.uci())
        narration = ''.join(f'{beat} {lessons.MOVE_CUE} ' for beat in beats)
        why = lines.skill(skill, step.get('kind')) if skill and step.get('kind') in ('missed', 'allowed') else ''
        if why:
            narration += why
            text.append(why)
        return {'kind': 'explain', 'fen': board.fen(), 'orientation': _side(board), 'text': ' '.join(text),
                'title': lines.text('moveTitle', move=number), 'narration': narration.strip(), 'demo': demo,
                'marks': [[chess.square_name(played.from_square), chess.square_name(played.to_square)]], 'pose': 'magnify'}
    if kind == 'moment-play':
        prompt = lines.t('lesson.find', seed)
        return {'kind': 'play', 'fen': board.fen(), 'orientation': _side(board), 'prompt': prompt, 'narration': prompt,
                'title': lines.text('findTitle'), 'hint': lines.skill(skill, 'idea') if skill else None,
                'success': lines.t('lesson.solved', seed), 'line': [better.uci()], 'pose': 'thinking'}
    if kind == 'moment-choose':
        others = [s for s in skills.SKILLS if s != skill and skills.SKILLS[s]['motif_tags']]
        rng = random.Random(seed)
        options = [{'text': lines.skill(skill, 'option'), 'correct': True, 'why': lines.skill(skill, 'idea')}]
        options += [{'text': lines.skill(s, 'option'), 'why': lines.skill(s, 'idea')} for s in rng.sample(others, 2)]
        rng.shuffle(options)
        question = lines.t('lesson.whatWentWrong')
        return {'kind': 'choose', 'fen': board.fen(), 'orientation': _side(board), 'question': question,
                'title': lines.text('whyTitle'),
                'narration': question, 'options': options, 'pose': 'confused'}
    return None


def render(data_dir, slug, lang='en', plan=None):
    """The lesson for a generated slug, parsed by lessons.parse and marked as the coach's; None when
    the slug is unknown or nothing in its plan can be shown any more."""
    if plan is None:
        with LOCK:
            plan = load(data_dir)['lessons'].get(slug)
    if not plan:
        return None
    from torre.learning import puzzles
    lines = Lines(lang)
    cache = {'_data_dir': data_dir, '_intro_fen': chess.STARTING_FEN, '_last_fen': chess.STARTING_FEN}
    try:
        cache['_packs'] = puzzles.load_packs()
    except puzzles.PuzzleError:
        cache['_packs'] = None
    # The intro shows the first position the lesson works on.
    for step in plan['steps']:
        if step['type'] in ('moment-show', 'moment-play'):
            found = _moment(step, cache)
            if found:
                cache['_intro_fen'] = found[0].fen()
                break
        if step['type'] == 'teach' and plan['kind'] == 'placement':
            raw = _raw_lesson_step(step['lesson'], step['step'], lang)
            if raw and raw.get('fen'):
                cache['_intro_fen'] = raw['fen']
                break
        if step['type'] == 'puzzle' and cache['_packs'] and step['puzzle'] in cache['_packs']['by_id']:
            raw = cache['_packs']['by_id'][step['puzzle']]
            board = chess.Board(raw['fen'])
            board.push(chess.Move.from_uci(raw['moves'][0]))
            cache['_intro_fen'] = board.fen()
            break
    cache['_last_fen'] = cache['_intro_fen']
    steps, skill_of = [], {}
    for step in plan['steps']:
        try:
            rendered = _render_step(step, plan, lines, cache)
        except (ValueError, KeyError, IndexError, AssertionError):
            rendered = None
        if not rendered:
            continue
        rendered = {k: v for k, v in rendered.items() if v is not None and not k.startswith('_')}
        rendered['id'] = step['id']
        steps.append(rendered)
        skill_of[step['id']] = step.get('skill')
    if not any(s['kind'] != 'explain' for s in steps):
        return None
    if plan['kind'] == 'game':
        title = lines.text('gameTitle', opponent=plan['opponent']) if plan.get('opponent') else lines.text('gameTitlePlain')
        found = sorted({lines.skill(s, 'title') for s in skill_of.values() if s})
        summary = lines.text('gameSummary') + (f" ({', '.join(found)})" if found else '')
        orientation = plan.get('color') if plan.get('color') in ('white', 'black') else 'white'
    elif plan['kind'] == 'placement':
        category = _locale(lines.lang, 'lessons')['categories'].get(plan['category'], plan['category'])
        title = lines.text('placementTitle', category=category)
        summary = lines.text('placementSummary')
        orientation = 'white'
    else:
        title = lines.skill(plan['skill'], 'title')
        summary = lines.text('sessionSummary')
        orientation = 'white'
    raw = {'version': 1, 'title': title, 'summary': summary, 'category': 'tactics', 'level': 'beginner',
           'minutes': max(2, len(steps)), 'orientation': orientation, 'steps': steps}
    lesson = lessons.parse(raw, slug)
    lesson['coach'] = {'kind': plan['kind'], 'skill': plan.get('skill'), 'game': plan.get('game'),
                       'opponent': plan.get('opponent'), 'day': plan.get('day')}
    if plan['kind'] == 'placement':
        # Which lesson each check stands for, so passing it can mark that lesson known.
        shown = {s['id'] for s in lesson['steps']}
        lesson['coach']['category'] = plan['category']
        lesson['coach']['lessons'] = {s['id']: s['lesson'] for s in plan['steps'] if s['type'] == 'teach' and s['id'] in shown}
    for step in lesson['steps']:
        step['skill'] = skill_of.get(step['id'])
    lesson['unitTitle'] = None
    return lesson


def is_generated(slug):
    return slug.startswith('game-') or slug.startswith('session-') or slug.startswith('placement-')


# ── What the coach says ───────────────────────────────────────────────────────────────────────

def briefing(lines, focus, changes, games_since, session_done, has_games, seed=0):
    """Rooky's spoken briefing on the Coach page: a list of recorded lines."""
    out = [lines.t('briefing.hello', seed)]
    if not has_games:
        return out + [lines.t('briefing.noGames')]
    if games_since:
        said = lines.counted('briefing.games', games_since)
        if said:
            out.append(said)
    for change in changes:
        if change['kind'] == 'graduated':
            out.append(lines.t('briefing.graduated', skill=lines.skill(change['skill'])))
    if focus:
        top = focus[0]
        out.append(lines.t('briefing.focus', skill=lines.skill(top['skill'])))
        missed = top['week']['games_missed']
        if missed:
            said = lines.counted('briefing.missedWeek', missed)
            if said:
                out.append(said)
        elif top['week']['ok'] or top['week']['missed']:
            out.append(lines.t('briefing.cleanWeek'))
        fresh = top.get('fresh') or {}
        if fresh.get('count', 0) >= 3 and fresh.get('pct') is not None and lines.in_domain('percent', fresh['pct']):
            out.append(lines.t('briefing.progress', percent=fresh['pct']))
            if fresh['pct'] >= top['goal']['pct'] and fresh['count'] >= top['goal']['count'] - 2:
                out.append(lines.t('briefing.almost'))
        out.append(lines.t('briefing.sessionDone' if session_done else 'briefing.session', seed))
    return [line for line in out if line]


def recap_lines(lines, focus_skill, lesson_slug):
    """What Rooky adds after a game's recap: the focus it touched, and the lesson made from it."""
    out = []
    if focus_skill:
        out.append(lines.t('recap.focus', skill=lines.skill(focus_skill)))
    out.append(lines.t('recap.lesson') if lesson_slug else lines.t('recap.clean'))
    return out


def all_lines(lang):
    """Every line the coach can say from coachlines.json, each placeholder expanded over its domain
    (narrate.py records them all)."""
    lines = Lines(lang)
    tree = json.loads(json.dumps(lines.tree))
    tree.pop('_text', None)  # titles and summaries are shown, not said
    domains = {name: [str(n) for n in range(low, high + 1)] for name, (low, high) in tree.pop('_domains').items()}
    domains['skill'] = [lines.skill(s) for s in skills.SKILLS]

    def strings(node):
        if isinstance(node, str):
            yield node
        elif isinstance(node, list):
            for item in node:
                yield from strings(item)
        elif isinstance(node, dict):
            for item in node.values():
                yield from strings(item)

    for template in strings(tree):
        names = sorted(set(re.findall(r'\{\{\s*(\w+)\s*\}\}', template)))
        unknown = [n for n in names if n not in domains]
        if unknown:
            raise ValueError(f'coachlines.json: no domain for {{{{{unknown[0]}}}}} in {template!r}')
        texts = [template]
        for name in names:
            texts = [fill(text, **{name: value}) for text in texts for value in domains[name]]
        yield from texts
