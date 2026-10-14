"""Routes for the board: positions and moves, engine lines and bot moves, the game review,
lesson-move judging, mistake explanations, finished games against the bots, and piece images."""
import json
import threading

import chess
import chess.engine
import chess.svg

from torre.learning import achievements
from torre.server import appdata
from torre.analysis import board_view
from torre.analysis import bot_report
from torre.analysis import bot_style
from torre.analysis import engine_service
from torre.analysis import engines
from torre.coaching import explain
from torre.analysis import game_stats
from torre import jsonio
from torre.games import masters
from torre.learning import puzzles
from torre.analysis import scoring
from torre.server.routes import BadRequest, Conflict, NotFound, Response, Routes, Unavailable, need

ROUTES = Routes()
RESULTS = ('1-0', '0-1', '1/2-1/2')
PLAYED_LOCK = threading.Lock()
# Seconds the analysis engine thinks per position, by the depth chosen in Settings → Analysis.
ANALYSIS_SECONDS = {'quick': .25, 'normal': .55, 'deep': 1.5}


def _number(payload, key, default=None):
    """An integer field (a rating, a skill level): whole numbers, or numbers written as text."""
    value = payload.get(key, default)
    try:
        if isinstance(value, bool):
            raise TypeError
        return int(value)
    except (TypeError, ValueError):
        raise BadRequest(f'"{key}" must be a number.') from None


PHASE_ELO_RANGE = (250, 3200)


def _phase_elo(payload):
    """The request's "phaseElo" ({opening, middlegame, endgame} ratings), or None when absent."""
    raw = payload.get('phaseElo')
    if raw is None:
        return None
    if not isinstance(raw, dict) or set(raw) != set(game_stats.PHASES):
        raise BadRequest('"phaseElo" must give a rating for the opening, the middlegame and the endgame.')
    low, high = PHASE_ELO_RANGE
    out = {}
    for phase in game_stats.PHASES:
        value = _number(raw, phase)
        if not low <= value <= high:
            raise BadRequest(f'Each phase rating must be from {low} to {high}.')
        out[phase] = value
    return out


def _stockfish_ready():
    if not engine_service.ENGINE_PATH.exists():
        raise Unavailable('Stockfish is not installed.')


def _installed_entry(engine_id, cached_only=False):
    """The catalog entry of an engine the request may use."""
    entry = engines.get(engine_id)
    if entry is None:
        raise BadRequest(f'Unknown engine: {engine_id}.')
    if not cached_only and not engines.installed(engine_id):
        if engine_id == 'stockfish':
            raise Unavailable('Stockfish is not installed.')
        raise Conflict(f"{entry['name']} is not installed.")
    return entry


@ROUTES.post('/api/position')
def position(req):
    return board_view.state(board_view.position(req.payload))


@ROUTES.post('/api/move')
def move(req):
    board = board_view.position(req.payload)
    if board.outcome(claim_draw=True):
        raise ValueError('This game has ended.')
    played = chess.Move.from_uci(need(req.payload, 'move'))
    if played not in board.legal_moves:
        raise ValueError('That move is not legal in this position.')
    san = board.san(played)
    board.push(played)
    return {**board_view.state(board), 'san': san, 'uci': played.uci()}


@ROUTES.post('/api/illegal')
def illegal(req):
    # Why a move the board refused breaks the rules, so a learner hears the rule, not just "no".
    board = board_view.position(req.payload)
    squares = []
    for key in ('from', 'to'):
        name = str(req.payload.get(key) or '')
        if name not in chess.SQUARE_NAMES:
            raise BadRequest(f'"{key}" must be a square, like e4.')
        squares.append(chess.parse_square(name))
    found = board_view.illegal_reason(board, *squares)
    return {'reason': found[0], **found[1]} if found else {'reason': None}


@ROUTES.post('/api/line')
def line(req):
    return board_view.line_sans(req.payload)


@ROUTES.post('/api/judge')
def judge(req):
    # A lesson move that is not the listed one: is it just as good, or what refutes it?
    board = board_view.position(req.payload)
    _stockfish_ready()
    played = chess.Move.from_uci(need(req.payload, 'move'))
    expected = chess.Move.from_uci(need(req.payload, 'expected'))
    if played not in board.legal_moves or expected not in board.legal_moves:
        raise ValueError('That move is not legal in this position.')
    with engine_service.analysis() as pooled:
        return engine_service.judge_move(pooled, board, played, expected)


@ROUTES.post('/api/coach/hint')
def coach_hint(req):
    # Playing with the coach: the best move here (for the hint ladder) and what the opponent
    # threatens, read by letting them move twice (a null move), unless you are in check.
    board = board_view.position(req.payload)
    _stockfish_ready()
    if board.is_game_over():
        return {'best': None, 'threat': None}
    with engine_service.analysis() as pooled:
        return engine_service.coach_hint(pooled, board)


@ROUTES.post('/api/coach/check')
def coach_check(req):
    # Playing with the coach: your move against the engine's best one, before it is played.
    board = board_view.position(req.payload)
    _stockfish_ready()
    played = chess.Move.from_uci(need(req.payload, 'move'))
    if played not in board.legal_moves:
        raise ValueError('That move is not legal in this position.')
    with engine_service.analysis() as pooled:
        return engine_service.coach_check(pooled, board, played)


@ROUTES.post('/api/engine')
def engine(req):
    payload = req.payload
    board = board_view.position(payload)
    engine_id = str(payload.get('engineId') or 'stockfish')
    entry = _installed_entry(engine_id)
    model = None
    if payload.get('modelId'):
        model = next((m for m in entry.get('models', []) if m.get('id') == str(payload['modelId'])), None)
        if model is None:
            raise BadRequest(f"Unknown model: {payload['modelId']}.")
        if not model.get('installed'):
            raise Conflict(f"{model['name']} is not installed.")
    if board.outcome(claim_draw=True):
        return {'lines': [], 'best': None}
    if payload.get('play') and payload.get('masterId'):
        # A legend answers from their own games while the position is one they reached.
        hit = masters.book_move(masters.book(str(payload['masterId'])), board)
        if hit:
            return {'best': hit['move'].uci(), 'lines': [],
                    'book': {'count': hit['count'], 'total': hit['total'], 'game': hit['game']}}
    if payload.get('play'):
        if model is not None:
            # Pooled per engine+model: Lc0 loads the net once, not per move.
            with engine_service.player(engine_id, model['id']) as pooled:
                best = engine_service.bot_move(pooled, board, model=model)
            return {'best': best.uci(), 'lines': []}
        # A node/depth cap gives a smoother strength curve than Skill Level.
        nodes, depth = engines.node_limits(payload)
        # A strength per phase ("phaseElo": {opening, middlegame, endgame}) replaces the one rating
        # in the phase this move is played in; a node-limited bot gets the node budget for it.
        phase = game_stats.line_phases(board)[-1]
        elo = payload.get('elo')
        by_phase = _phase_elo(payload)
        if by_phase:
            elo = by_phase[phase]
            if nodes:
                nodes = engines.nodes_for_elo(elo)
        limit = engines.search_limit(nodes, depth, engine_service.BOT_SECONDS)
        strength, slip = {}, 0.0
        if elo is not None and not (by_phase and nodes):
            strength, slip = engines.strength_options(entry, _number({'elo': elo}, 'elo'))
        elif entry.get('capabilities', {}).get('skill_level') and not (nodes or depth):
            strength = {'Skill Level': max(0, min(20, _number(payload, 'level', 4)))}
        try:
            style = bot_style.parse(payload.get('style'))
        except ValueError as error:
            raise BadRequest(str(error)) from None
        with engine_service.player(engine_id, strength=strength) as pooled:
            best, slipped = engine_service.bot_choice(pooled, board, slip, limit=limit)
            # A character's quirk (bot_style): a move that fits it, when it costs little. A slip
            # is the bot's mistake on purpose, and stays as it is.
            styled = False
            if style and not slipped:
                best, styled = bot_style.styled_move(pooled, board, best, style, None if elo is None else _number({'elo': elo}, 'elo'))
            # A character bot talks during the game: "read" asks for its view around the move
            # (Stockfish only, a shallow look; see move_reading).
            reading = engine_service.move_reading(pooled, board, best) if payload.get('read') and engine_id == 'stockfish' else {}
        return {'best': best.uci(), 'lines': [], 'phase': phase, 'slip': slipped, **reading,
                **({'styled': True} if styled else {}),
                **({'elo': _number({'elo': elo}, 'elo')} if elo is not None else {})}
    # Analysis with a model searches by time like any engine: the
    # model's go_override (one node) is for playing, not for lines.
    depth = str(payload.get('depth') or 'normal')
    if depth not in ANALYSIS_SECONDS:
        raise BadRequest(f'"depth" must be one of {", ".join(ANALYSIS_SECONDS)}.')
    with engine_service.analysis(engine_id, model['id'] if model else None) as pooled:
        return engine_service.engine_lines(pooled, board, ANALYSIS_SECONDS[depth], engines.profile_multipv(engine_id))


@ROUTES.post('/api/review')
def review(req):
    # A batch of consecutive plies with one engine process, so opening a
    # game can analyze it front to back and later stepping is instant.
    return {'plies': reviewed(req.payload)}


def reviewed(payload):
    """The engine's result (and the move's grade) for plies from..to of a line, saved results first."""
    board_view.position(payload)
    cached_only = bool(payload.get('cachedOnly'))
    engine_id = str(payload.get('engineId') or 'stockfish')
    moves = board_view.moves_of(payload)
    # Check the request before the engine, so a bad request says what is wrong with it.
    start = max(0, _number(payload, 'from', 0))
    stop = min(len(moves), _number(payload, 'to', start))
    _installed_entry(engine_id, cached_only)
    board = board_view.position({**payload, 'moves': moves[:start]})
    # Saved results come back at once; with cachedOnly, positions never reviewed are
    # left out instead of being sent to the engine.
    plies, new = [], {}
    eval_key = engine_service.eval_key
    with engine_service.EVALS_LOCK:
        known = engine_service.saved_evals()

        def saved(position):
            found = known.get(f'{engine_id}:{eval_key(position)}')
            return known.get(eval_key(position)) if found is None and engine_id == 'stockfish' else found

        for ply in range(start, stop + 1):
            if ply > start:
                board.push(chess.Move.from_uci(moves[ply - 1]))
            key = f'{engine_id}:{eval_key(board)}'
            if board.outcome(claim_draw=True):
                result = {'lines': [], 'best': None}
            elif key in known:
                result = known[key]
            elif engine_id == 'stockfish' and eval_key(board) in known:
                result = known[eval_key(board)]  # reviewed before engines had cache keys
            elif cached_only:
                continue
            else:
                with engine_service.analysis(engine_id) as pooled:
                    result = engine_service.engine_lines(pooled, board, engine_service.REVIEW_SECONDS,
                                                         max(2, engines.profile_multipv(engine_id)))
                known[key] = new[key] = result
            graded = None
            if ply > 0:
                previous = board.copy()
                last = previous.pop()
                earlier = None
                if previous.move_stack:
                    two_back = previous.copy()
                    two_back.pop()
                    earlier = scoring.verdict(two_back, saved(two_back))
                graded = scoring.classify(previous, last, scoring.verdict(previous, saved(previous)),
                                          scoring.verdict(board, result), earlier)
            plies.append({'ply': ply, 'state': board_view.state(board), **result, 'grade': graded})
        engine_service.save_evals(new)
    return plies


@ROUTES.post('/api/explain')
def explain_move(req):
    # Why a move was a mistake, in words: engine facts first, then the coach's model.
    payload = req.payload
    board = chess.Board(str(payload.get('fen') or ''))
    if not board.is_valid():
        raise ValueError('This position is not a valid chess position.')
    raw = str(payload.get('move') or '')
    played = chess.Move.from_uci(raw) if puzzles.UCI.match(raw) else board.parse_san(raw)  # UCI or SAN
    if played not in board.legal_moves:
        raise ValueError('That move is not legal in this position.')
    _stockfish_ready()

    def facts():
        after = board.copy(stack=False)
        after.push(played)
        with engine_service.analysis() as pooled:
            best = engine_service.engine_lines(pooled, board, engine_service.EXPLAIN_SECONDS, 1)['lines']
            reply = engine_service.engine_lines(pooled, after, engine_service.EXPLAIN_SECONDS, 1)['lines']
        return explain.move_facts(board, played, best[0] if best else {}, reply[0] if reply else {})
    try:
        return explain.answer(appdata.DATA_DIR, 'mistake', {'fen': board.fen(), 'move': played.uci()}, facts,
                              req.lang, cached_only=bool(payload.get('cachedOnly')))
    except RuntimeError as exc:  # no coach model to ask
        raise Unavailable(str(exc)) from exc


def record_played(payload):
    """Save a finished game against a studio bot to played.jsonl; True when it is new."""
    board = board_view.position(payload)
    result = payload.get('result')
    if result not in RESULTS:
        raise ValueError('"result" must be 1-0, 0-1 or 1/2-1/2.')
    if payload.get('playerColor') not in ('white', 'black'):
        raise ValueError('"playerColor" must be white or black.')
    if not payload.get('resigned') and not board.outcome(claim_draw=True):
        raise ValueError('This game has not ended.')
    game_id = str(payload.get('gameId') or '')[:64]
    if not game_id:
        raise ValueError('"gameId" is required.')
    path = appdata.DATA_DIR / 'played.jsonl'
    with PLAYED_LOCK:
        if any(row.get('id') == game_id for row in jsonio.read_jsonl(path) if isinstance(row, dict)):
            return False
        record = {'id': game_id, 'date': puzzles.now_utc().strftime('%Y.%m.%d'), 'user_color': payload['playerColor'],
                  'result': result, 'resigned': bool(payload.get('resigned')), 'initialFen': payload.get('initialFen') or chess.STARTING_FEN,
                  'moves': list(payload.get('moves', [])), 'bot_id': str(payload.get('botId') or 'sf18')[:64],
                  'elo': payload.get('elo') if isinstance(payload.get('elo'), int) else None}
        if payload.get('engineId'):
            record['engine_id'] = str(payload['engineId'])[:64]
        if payload.get('modelId'):
            record['model_id'] = str(payload['modelId'])[:64]
        if payload.get('masterId'):
            record['master_id'] = str(payload['masterId'])[:64]
        with path.open('a', encoding='utf-8') as handle:
            handle.write(json.dumps(record) + '\n')
    return True


@ROUTES.post('/api/played/report')
def played_report(req):
    # The after-game card: accuracy by phase for you and the bot, and how its random slips turned out.
    payload = req.payload
    moves = board_view.moves_of(payload)
    if payload.get('playerColor') not in ('white', 'black'):
        raise ValueError('"playerColor" must be white or black.')
    _stockfish_ready()
    notes = payload.get('notes', [])
    if not isinstance(notes, list):
        raise BadRequest('"notes" must be a list.')
    plies = reviewed({'initialFen': payload.get('initialFen'), 'moves': moves, 'from': 0, 'to': len(moves)})
    evals = []
    for ply in plies:
        if ply['lines']:
            evals.append(ply['lines'][0])
        elif ply['state']['termination'] == 'checkmate':  # the side to move is mated
            evals.append([-10000 if ply['state']['turn'] == 'white' else 10000, None])
        else:
            evals.append([0, None])
    return bot_report.report(payload.get('initialFen') or chess.STARTING_FEN, moves, payload['playerColor'], evals, notes,
                             grades=[ply['grade'] for ply in plies[1:]])


@ROUTES.post('/api/played')
def played(req):
    before = appdata.award_counts()
    recorded = record_played(req.payload)
    after = appdata.award_counts()
    return {'recorded': recorded, 'improved': achievements.improvements(before, after, req.lang)}


@ROUTES.get('/pieces/(?P<rest>.*)')
def piece(req):
    symbol = req.path.rsplit('/', 1)[-1].removesuffix('.svg')
    if symbol not in list('KQRBNPkqrbnp'):
        raise NotFound('Unknown piece')
    # Cached, or every move re-downloads the pieces that moved.
    return Response.file(chess.svg.piece(chess.Piece.from_symbol(symbol)).encode(), 'image/svg+xml', 'public, max-age=86400')
