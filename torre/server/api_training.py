"""Routes for training: the day's plan, drills from your games, opening and endgame practice,
puzzles, lessons, the profile and awards, the trainer modes, and the coach's voice packs."""
import os
from functools import lru_cache
from pathlib import Path

from torre.learning import achievements
from torre.server import appdata
from torre.coaching import coach_lessons
from torre.learning import drills
from torre.learning import endgames
from torre.analysis import engine_service
from torre import jsonio
from torre.learning import lessons
from torre.learning import openings
from torre.learning import packs
from torre.learning import puzzles
from torre.learning import story
from torre.learning import trainer
from torre.analysis.board_view import position
from torre.server.routes import MEDIA_TYPES, BadRequest, Conflict, NotFound, Response, Routes, Unavailable

ROUTES = Routes()
MINE_PER_DAY = 5  # new puzzles from your own games offered in a day's plan


def drill_deck():
    """Your mistakes and blunders, then the forced mates you let go (worked out once per change of
    the games or their analysis, since it replays every game)."""
    analysis = appdata.records('analysis.jsonl')
    mates = jsonio.memo('missed-mates', appdata.stamps('analysis.jsonl', 'games.jsonl'), lambda: drills.missed_mate_cards(
        analysis, {g.get('id'): g for g in appdata.records('games.jsonl')}))
    return {**mates, **drills.build_deck(analysis)}


def today_view(now=None):
    """The day's "fix your mistakes" plan, in order: drills from your games (due, then new), missed
    puzzles to retry (puzzles.reviews), then a few new puzzles mined from your games."""
    now = now or drills.now_utc()
    with drills.LOCK:
        deck = drills.next_card(drill_deck(), drills.load_state(appdata.DATA_DIR / 'drills.json'), now)
    packs_ = puzzles.load_packs()
    with puzzles.LOCK:
        progress = puzzles.load_state(appdata.DATA_DIR / 'puzzles.json')
    mine = {p['id'] for p in packs_['themes'].get(puzzles.MINE, [])}
    fresh = len(mine - set(progress['puzzles']))
    today = now.date().isoformat()
    tried_today = len({a['id'] for a in progress['history'] if a.get('rated') and a['id'] in mine and a['at'][:10] == today})
    plan = {'drills': {k: deck[k] for k in ('due', 'new', 'new_total', 'total', 'learned', 'mastered', 'next_due')},
            'reviews': puzzles.reviews(packs_, progress, now),
            'mine': {'total': len(mine), 'fresh': fresh, 'today': min(fresh, max(0, MINE_PER_DAY - tried_today))}}
    plan['todo'] = plan['drills']['due'] + plan['drills']['new'] + plan['reviews']['due'] + plan['mine']['today']
    return plan


@lru_cache(maxsize=1)
def _repertoire(data_dir, *stamps):
    return openings.build_repertoire(appdata.records('games.jsonl'), {a['id']: a for a in appdata.records('analysis.jsonl')})


def opening_deck(progress):
    """Repertoire cards from your games (rebuilt when they change) plus the lines you added."""
    return openings.full_deck(_repertoire(appdata.DATA_DIR, *appdata.stamps('games.jsonl', 'analysis.jsonl')), progress)


@lru_cache(maxsize=2)
def _tablebase(directory):
    return endgames.tablebase_probe(Path(directory))


def endgame_probe():
    """Syzygy WDL probing when tablebase files are in SYZYGY_PATH or data/syzygy, else None."""
    return _tablebase(os.environ.get('SYZYGY_PATH') or str(appdata.DATA_DIR / 'syzygy'))


@ROUTES.get('/api/today')
def today(req):
    return today_view()


def _drills_for(only):
    """The game-mistake deck, or none at all when only lesson reviews are wanted (?only=lessons)."""
    return {} if only == 'lessons' else drill_deck()


@ROUTES.get('/api/drills')
def drills_next(req):
    with drills.LOCK:
        return drills.next_card(_drills_for(req.arg('only')), drills.load_state(appdata.DATA_DIR / 'drills.json'), drills.now_utc())


@ROUTES.post('/api/drills/answer')
def drills_answer(req):
    if not engine_service.ENGINE_PATH.exists():
        raise Unavailable('Stockfish is not installed.')
    with drills.LOCK:
        deck, state_path = _drills_for(req.payload.get('only')), appdata.DATA_DIR / 'drills.json'
        progress = drills.load_state(state_path)
        now = drills.now_utc()
        result = drills.answer(deck, progress, str(req.payload.get('id')), str(req.payload.get('move')), engine_service.evaluate, now)
        drills.save_state(state_path, progress)
        result = {**result, 'next': drills.next_card(deck, progress, now)}
    if result['correct'] and result['reviewed']:
        appdata.award_profile_xp(story.XP_PER_REVIEW)
    return result


@ROUTES.get('/api/openings', '/api/openings/next')
def openings_next(req):
    with openings.LOCK:
        progress = openings.load_state(appdata.DATA_DIR / 'openings.json')
        return openings.next_card(opening_deck(progress), progress, drills.now_utc())


@ROUTES.post('/api/openings/answer', '/api/openings/lines', '/api/openings/lines/delete')
def openings_change(req):
    payload = req.payload
    with openings.LOCK:
        state_path = appdata.DATA_DIR / 'openings.json'
        progress = openings.load_state(state_path)
        now = drills.now_utc()
        if req.path == '/api/openings/answer':
            result = openings.answer(opening_deck(progress), progress, str(payload.get('id')), str(payload.get('move')), now)
        elif req.path == '/api/openings/lines':
            result = {'line': openings.line_view(openings.add_line(progress, payload.get('color'), payload.get('line'), now))}
        else:
            openings.delete_line(progress, str(payload.get('id')))
            result = {}
        openings.save_state(state_path, progress)
        result = {**result, 'next': openings.next_card(opening_deck(progress), progress, now)}
    if result.get('correct') and result.get('reviewed'):
        appdata.award_profile_xp(story.XP_PER_REVIEW)
    return result


@ROUTES.get('/api/endgames')
def endgames_catalog(req):
    with endgames.LOCK:
        return endgames.catalog(endgames.load_state(appdata.DATA_DIR / 'endgames.json'), req.lang)


@ROUTES.post('/api/endgames/move')
def endgames_move(req):
    # Your move in an endgame: judged, answered by a low-depth Stockfish, and recorded.
    payload = req.payload
    endgame = endgames.BY_ID.get(str(payload.get('id')))
    if endgame is None:
        raise NotFound('Position not found.')
    if not isinstance(payload.get('moves'), list):
        raise BadRequest('"moves" must be a list.')
    if not engine_service.ENGINE_PATH.exists():
        raise Unavailable('Stockfish is not installed.')
    with engine_service.endgame_defender() as engine:
        result = endgames.play(endgame, payload['moves'], endgames.engine_think(engine), endgame_probe())
    with endgames.LOCK:
        state_path = appdata.DATA_DIR / 'endgames.json'
        progress = endgames.load_state(state_path)
        entry = endgames.record(progress, endgame['id'], result, result['used'], endgames.now_utc())
        endgames.save_state(state_path, progress)
    return {**result, 'progress': entry}


@ROUTES.get('/api/puzzles')
def puzzles_catalog(req):
    with puzzles.LOCK:
        return puzzles.catalog(puzzles.load_packs(), puzzles.load_state(appdata.DATA_DIR / 'puzzles.json'), req.lang)


@ROUTES.get('/api/puzzles/next')
def puzzles_next(req):
    query = req.query
    with puzzles.LOCK:
        progress = puzzles.load_state(appdata.DATA_DIR / 'puzzles.json')
    try:
        if 'run' in query:  # Streak or Storm: the index-th puzzle of the run, none of this run's again
            found = puzzles.pick_run(puzzles.load_packs(), progress, query['run'][0], int(query.get('index', ['0'])[0]),
                                     [pid for pid in query.get('exclude', [''])[0].split(',') if pid])
        else:
            found = puzzles.pick_next(puzzles.load_packs(), progress, query.get('theme', [puzzles.MIXED])[0], query.get('after', [None])[0])
    except ValueError as exc:
        raise NotFound(str(exc)) from exc
    return {'id': found}


@ROUTES.get('/api/puzzles/(?P<rest>.*)')
def puzzle(req):
    raw = puzzles.load_packs()['by_id'].get(req.path.rsplit('/', 1)[-1])
    if raw is None:
        raise NotFound('Puzzle not found.')
    try:
        view = puzzles.view(raw, req.lang)
    except puzzles.PuzzleError as exc:
        return {'error': f'This puzzle is broken: {exc}'}, 500
    with puzzles.LOCK:
        progress = puzzles.load_state(appdata.DATA_DIR / 'puzzles.json')['puzzles'].get(raw['id'])
    return {**view, 'progress': progress}


@ROUTES.post('/api/puzzles/run')
def puzzles_run(req):  # a finished Streak or Storm: unrated, only the best score is kept
    with puzzles.LOCK:
        state_path = appdata.DATA_DIR / 'puzzles.json'
        progress = puzzles.load_state(state_path)
        result = puzzles.record_run(progress, req.payload.get('mode'), req.payload.get('score'), puzzles.now_utc())
        puzzles.save_state(state_path, progress)
    return result


@ROUTES.post('/api/puzzles/attempt')
def puzzles_attempt(req):
    payload = req.payload
    before = appdata.award_counts()
    with puzzles.LOCK:
        state_path = appdata.DATA_DIR / 'puzzles.json'
        progress = puzzles.load_state(state_path)
        result = puzzles.record(puzzles.load_packs(), progress, str(payload.get('id')), payload.get('misses', []),
                                payload.get('hint'), payload.get('revealed'), payload.get('seconds'), puzzles.now_utc())
        puzzles.save_state(state_path, progress)
    if result['rated'] and result['result'] == 'solved':  # a first-attempt solve; partial solves count (puzzles.SOLVED_MIN)
        appdata.award_profile_xp(story.XP_PER_PUZZLE)
    return {**result, 'improved': achievements.improvements(before, appdata.award_counts(), req.lang)}


@ROUTES.get('/api/lessons')
def lessons_catalog(req):
    with lessons.LOCK:
        loaded, problems = lessons.load_all()
        localized = {slug: lessons.localize(lesson, req.lang) for slug, lesson in loaded.items()}
        return lessons.catalog(localized, problems, lessons.load_state(appdata.DATA_DIR / 'lessons.json'))


@ROUTES.get('/api/lessons/(?P<rest>.*)')
def lesson(req):
    slug = req.path.rsplit('/', 1)[-1]
    found = appdata.find_lesson(slug, req.lang)
    if not found:
        raise NotFound('Lesson not found.')
    with lessons.LOCK:
        progress = lessons.load_state(appdata.DATA_DIR / 'lessons.json')['lessons'].get(slug, {})
        ledger = story.load(appdata.DATA_DIR / 'story.json')
    return {**found, 'step': min(progress.get('step', 0), len(found['steps'])), 'completed': progress.get('completed'),
            'skipped': bool(progress.get('skipped')), 'stepResults': story.step_results(found, ledger),
            'stars': story.stars(found, ledger, None if progress.get('skipped') else progress.get('completed'))}


@ROUTES.post('/api/lessons/skip')
def lessons_skip(req):
    # "I already know this", or the lessons a placement check showed you know: marked done, no stars.
    slugs = req.payload.get('slugs')
    if not isinstance(slugs, list) or not slugs or not all(isinstance(s, str) for s in slugs):
        raise BadRequest('"slugs" must be a list of lesson slugs.')
    with lessons.LOCK:
        loaded, _ = lessons.load_all()
        state_path = appdata.DATA_DIR / 'lessons.json'
        progress = lessons.load_state(state_path)
        skipped = [s for s in slugs if not (progress['lessons'].get(s) or {}).get('completed')]
        for slug in slugs:
            lessons.skip(loaded, progress, slug, lessons.now_utc())
        lessons.save_state(state_path, progress)
    return {'skipped': skipped}


@ROUTES.post('/api/lessons/placement')
def lessons_placement(req):
    # A quick check over a category's lessons you have not taken: one position from each.
    category = req.payload.get('category')
    if category not in lessons.CATEGORIES:
        raise BadRequest(f'"category" must be one of {", ".join(lessons.CATEGORIES)}.')
    with lessons.LOCK:
        progress = lessons.load_state(appdata.DATA_DIR / 'lessons.json')
    done = {slug for slug, entry in progress['lessons'].items() if entry.get('completed')}
    slug = coach_lessons.ensure_placement(appdata.DATA_DIR, category, done)
    if slug is None:
        raise Conflict('There is nothing left to check in this section.')
    return {'slug': slug}


@ROUTES.post('/api/lessons/progress')
def lessons_progress(req):
    with lessons.LOCK:
        state_path = appdata.DATA_DIR / 'lessons.json'
        progress = lessons.load_state(state_path)
        slug = str(req.payload.get('slug'))
        found = appdata.find_lesson(slug)
        entry = lessons.record({slug: found} if found else {}, progress, slug, req.payload.get('step'), lessons.now_utc())
        lessons.save_state(state_path, progress)
        return entry


@ROUTES.post('/api/lessons/(?P<slug>.*?)/steps/(?P<step>.*)')
def lesson_step(req):
    found = appdata.find_lesson(req.params['slug'])
    if found is None:
        raise NotFound('Lesson not found.')
    step = next((s for s in found['steps'] if s['id'] == req.params['step']), None)
    if step is None:
        raise NotFound('Step not found.')
    with lessons.LOCK:
        story_path, profile_path = appdata.DATA_DIR / 'story.json', appdata.DATA_DIR / 'profile.json'
        ledger, profile = story.load(story_path), story.load_profile(profile_path)
        result = story.record_step(found, step, ledger, profile, req.payload, lessons.now_utc())
        story.save(story_path, ledger)
        story.save_profile(profile_path, profile)
    if step['kind'] == 'play' and not found.get('coach'):  # its key position becomes an FSRS review card (first time only)
        with drills.LOCK:
            drills_path = appdata.DATA_DIR / 'drills.json'
            progress = drills.load_state(drills_path)
            if drills.add_lesson_card(progress, found, step, drills.now_utc()):
                drills.save_state(drills_path, progress)
    return result


@ROUTES.get('/api/profile')
def profile(req):
    with lessons.LOCK:
        return story.profile_view(story.load_profile(appdata.DATA_DIR / 'profile.json'), lessons.now_utc())


@ROUTES.get('/api/achievements')
def awards(req):
    return {'awards': achievements.board(appdata.award_counts(), req.lang)}


@ROUTES.get('/api/trainer/(?P<rest>.*)')
def trainer_get(req):
    # Learn from your mistakes and guess the move (trainer.py).
    return trainer.get(req.path, req.query, appdata.records, appdata.DATA_DIR)


@ROUTES.post('/api/trainer/(?P<rest>.*)')
def trainer_post(req):
    def engine_call(work):
        with engine_service.analysis() as engine:
            return work(engine)
    return trainer.post(req.path, req.payload, appdata.DATA_DIR,
                        engine_call if engine_service.ENGINE_PATH.exists() else None, position)


@ROUTES.get('/api/packs')
def packs_view(req):
    return packs.view(appdata.DATA_DIR)


@ROUTES.post('/api/packs/install')
def packs_install(req):
    packs.JOB.start(appdata.DATA_DIR, str(req.payload.get('id')))
    return packs.view(appdata.DATA_DIR)


@ROUTES.post('/api/packs/cancel')
def packs_cancel(req):
    packs.JOB.stop()
    return packs.view(appdata.DATA_DIR)


@ROUTES.post('/api/packs/remove')
def packs_remove(req):
    packs.remove(appdata.DATA_DIR, str(req.payload.get('id')))
    return packs.view(appdata.DATA_DIR)


@ROUTES.get('/audio/(?P<rest>.*)')
def audio(req):
    # The coach's recorded lines, from the installed voice pack.
    parts = req.path.split('/')
    target = packs.audio_file(appdata.DATA_DIR, parts[2], parts[3]) if len(parts) == 4 else None
    if target is None:
        raise NotFound('Not found')
    cache = 'public, max-age=86400' if target.suffix == '.mp3' else 'no-store'
    return Response.file(target.read_bytes(), MEDIA_TYPES[target.suffix], cache)
