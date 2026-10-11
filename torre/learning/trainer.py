"""Two training modes built on games already on disk.

Learn from your mistakes: an analyzed game (analysis.jsonl, see analyze.py) is
replayed and stops at each of your labeled errors (mistakes and blunders, and
inaccuracies on request). The page asks for a better move and judges it with
/api/judge against the engine's choice stored in the analysis; mistakes()
lists the stops. How many you found is kept per game.

Guess the move: a legend's game from their PGN (masters.py) is replayed and
you guess each move for one side. score_guess() rates a guess by how close
Stockfish scores it to the master's move: the master's own move earns full
points, anything else earns points scaled down by its centipawn loss. A
move the engine thinks only the master's choice holds (the next best is far
worse) is a critical moment, which the page pauses on. Best scores are kept
per game.

Progress lives in trainer.json next to the analysis. get() and post() route
the studio's /api/trainer/ requests.
"""
import io
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

import chess
import chess.engine
import chess.pgn

from torre.analysis import analyze
from torre.games import masters
from torre import jsonio
LOCK = threading.Lock()

ERRORS = ('mistake', 'blunder')
GUESS_POINTS = 10    # the master's own move
GUESS_NEAR = 9       # the most any other move can earn
GUESS_SCALE = 250    # centipawns lost at which a guess earns nothing
GUESS_CAP = 1000     # scores beyond this are all just "winning" (mates included)
CRITICAL_GAP = 150   # the master's move beats every alternative by this much
GUESS_DEPTH = 12

_MOVE_NUMBER = re.compile(r'(\d+)\.')
_listings = {}  # master id -> (pgn mtime, [(headers, movetext)])


def now_utc():
    return datetime.now(timezone.utc)


def load_state(path):
    try:
        state = json.loads(Path(path).read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}
    state.setdefault('mistakes', {})
    state.setdefault('masters', {})
    return state


def save_state(path, state):
    jsonio.write_json(path, state, indent=1)


# ---- Learn from your mistakes ----

def mistakes(pgn, analysis, inaccuracies=False):
    """The game's moves and the stops for a walkthrough: every labeled error of
    yours where the analysis has a better engine move, with the position before it."""
    if not analysis or analysis.get('scoring_version') != analyze.SCORING_VERSION:
        raise ValueError('This game has not been analyzed yet.')
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None:
        raise ValueError('This game could not be read.')
    wanted = set(ERRORS) | ({'inaccuracy'} if inaccuracies else set())
    labeled = {m['ply']: m['class'] for m in analysis.get('moves', []) if m.get('class') in wanted}
    best_moves, evals = analysis.get('best_moves') or [], analysis.get('evals') or []
    board = game.board()
    initial = board.fen()
    moves, stops = [], []
    for index, move in enumerate(game.mainline_moves()):
        ply = index + 1
        best = best_moves[index] if index < len(best_moves) else None
        if ply in labeled and best and best != move.uci():
            best_move = chess.Move.from_uci(best)
            if best_move in board.legal_moves:
                stops.append({
                    'ply': ply, 'move_number': board.fullmove_number, 'class': labeled[ply],
                    'played': move.uci(), 'played_san': board.san(move), 'fen': board.fen(),
                    'best': best, 'best_san': board.san(best_move),
                    'eval_before': evals[index] if index < len(evals) else None,
                    'eval_after': evals[ply] if ply < len(evals) else None,
                })
        moves.append({'uci': move.uci(), 'san': board.san(move)})
        board.push(move)
    return {'initialFen': initial, 'moves': moves, 'mistakes': stops, 'user_color': analysis.get('user_color'),
            'opponent': analysis.get('opponent'), 'date': analysis.get('date')}


def _whole(value, key):
    """`value` as an int; a ValueError naming `key` when it is not a number."""
    try:
        if isinstance(value, bool):
            raise TypeError
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f'"{key}" must be a whole number.') from None


def _required(payload, *keys):
    missing = [key for key in keys if payload.get(key) is None]
    if missing:
        raise ValueError(f'"{missing[0]}" is required.')


def record_mistakes(state, game_id, found, total, now):
    """Remember one walkthrough of a game; returns the game's entry."""
    found, total = _whole(found, 'found'), _whole(total, 'total')
    if total < 0 or not 0 <= found <= total:
        raise ValueError('"found" must be between 0 and "total".')
    entry = state['mistakes'].setdefault(str(game_id), {'runs': 0, 'best': 0})
    entry.update(runs=entry['runs'] + 1, best=max(entry['best'], found), last=found, total=total, at=now.isoformat())
    return entry


# ---- Guess the move ----

def _master_games(master_id):
    """(headers, movetext) for each of the master's games, the same order the book uses."""
    path = masters.path_for(master_id)
    mtime = path.stat().st_mtime_ns
    with LOCK:
        cached = _listings.get(master_id)
        if cached and cached[0] == mtime:
            return cached[1]
    text = path.read_text(encoding='utf-8', errors='replace')
    surname, _ = masters._identity(text)
    games = [(headers, movetext, masters._who(headers, surname)) for headers, movetext in masters._games(text)]
    games = [g for g in games if g[2]]
    with LOCK:
        _listings[master_id] = (mtime, games)
    return games


def master_games(master_id):
    """A short listing of every game in the master's file, for picking one."""
    listed = []
    for index, (headers, movetext, side) in enumerate(_master_games(master_id)):
        numbers = [int(n) for n in _MOVE_NUMBER.findall(masters._COMMENT.sub(' ', movetext))]
        listed.append({'index': index, 'white': masters._display(headers.get('White', '')),
                       'black': masters._display(headers.get('Black', '')), 'side': side,
                       'year': masters._year(headers), 'result': headers.get('Result', '*'),
                       'event': headers.get('Event', ''), 'moves': max(numbers, default=0)})
    return listed


def master_game(master_id, index):
    """One of the master's games, move by move, with the side they played."""
    games = _master_games(master_id)
    if not 0 <= index < len(games):
        raise ValueError('Game not found.')
    headers, movetext, side = games[index]
    pgn = ''.join(f'[{k} "{v}"]\n' for k, v in headers.items()) + '\n' + movetext + '\n'
    game = chess.pgn.read_game(io.StringIO(pgn))
    board = game.board()
    initial, moves = board.fen(), []
    for move in game.mainline_moves():
        moves.append({'uci': move.uci(), 'san': board.san(move)})
        board.push(move)
    return {'index': index, 'master': master_id, 'side': side, 'initialFen': initial, 'moves': moves,
            'white': masters._display(headers.get('White', '')), 'black': masters._display(headers.get('Black', '')),
            'year': masters._year(headers), 'result': headers.get('Result', '*'), 'event': headers.get('Event', '')}


def _cp(score, board):
    return max(-GUESS_CAP, min(GUESS_CAP, score.pov(board.turn).score(mate_score=10000)))


def guess_points(loss):
    """Points for a move other than the master's that loses `loss` centipawns against it."""
    return round(GUESS_NEAR * max(0.0, 1 - max(0, loss) / GUESS_SCALE))


def score_guess(engine, board, move, expected, depth=GUESS_DEPTH):
    """Rate a guess at the master's move `expected` from `board`, for the side to move."""
    limit = chess.engine.Limit(depth=depth)
    top = [(info['pv'][0], _cp(info['score'], board)) for info in engine.analyse(board, limit, multipv=2) if info.get('pv')]
    critical = len(top) > 1 and top[0][0] == expected and top[0][1] - top[1][1] >= CRITICAL_GAP
    known = dict(top)

    def scored(candidate):
        if candidate not in known:
            known[candidate] = _cp(engine.analyse(board, limit, root_moves=[candidate])['score'], board)
        return known[candidate]

    best = top[0][0] if top else expected
    result = {'exact': move == expected, 'critical': critical, 'san': board.san(move),
              'master': expected.uci(), 'master_san': board.san(expected),
              'best': best.uci(), 'best_san': board.san(best)}
    if move == expected:
        return {**result, 'points': GUESS_POINTS, 'loss': 0}
    loss = max(0, scored(expected) - scored(move))
    return {**result, 'points': guess_points(loss), 'loss': loss}


def record_guess(state, master_id, index, score, most, now):
    """Remember one replay of a master game; returns the entry and whether it beat the best."""
    score, most, index = _whole(score, 'score'), _whole(most, 'max'), _whole(index, 'index')
    if most < 0 or not 0 <= score <= most:
        raise ValueError('"score" must be between 0 and "max".')
    entry = state['masters'].setdefault(f'{master_id}:{index}', {'runs': 0, 'best': 0})
    improved = entry['runs'] == 0 or score > entry['best']
    entry.update(runs=entry['runs'] + 1, best=max(entry['best'], score), max=most, last=score, at=now.isoformat())
    return {**entry, 'improved': improved}


# ---- Routes ----

def get(path, query, records, data_dir):
    """(body, status) for GET /api/trainer/...: a walkthrough, a legend's games, or one game."""
    parts = path.strip('/').split('/')[2:]
    try:
        with LOCK:
            state = load_state(Path(data_dir) / 'trainer.json')
        if len(parts) == 2 and parts[0] == 'mistakes':
            game = next((g for g in records('games.jsonl') if g['id'] == parts[1]), None)
            if not game:
                return {'error': 'Game not found.'}, 404
            analysis = next((a for a in records('analysis.jsonl') if a['id'] == parts[1]), None)
            inaccuracies = query.get('inaccuracies', ['0'])[0] in ('1', 'true')
            return {'id': game['id'], **mistakes(game['pgn'], analysis, inaccuracies),
                    'progress': state['mistakes'].get(parts[1])}, 200
        if len(parts) == 2 and parts[0] == 'masters':
            games = master_games(parts[1])
            for g in games:
                g['best'] = state['masters'].get(f"{parts[1]}:{g['index']}", {}).get('best')
            return {'master': masters.summary(parts[1]), 'games': games}, 200
        if len(parts) == 3 and parts[0] == 'masters' and parts[2].isdigit():
            game = master_game(parts[1], int(parts[2]))
            return {**game, 'name': masters.summary(parts[1])['name'],
                    'progress': state['masters'].get(f'{parts[1]}:{parts[2]}')}, 200
    except masters.MasterError as exc:
        return {'error': str(exc)}, 404
    except ValueError as exc:
        return {'error': str(exc)}, 400
    return {'error': 'Not found'}, 404


def post(path, payload, data_dir, engine_call, position):
    """(body, status) for POST /api/trainer/...: score a guess or save a result.
    `engine_call(work)` runs work(engine) on the analysis engine (None without Stockfish);
    `position(payload)` is the board from a start position and moves."""
    state_path = Path(data_dir) / 'trainer.json'
    if path == '/api/trainer/guess':
        if engine_call is None:
            return {'error': 'Stockfish is not installed.'}, 503
        board = position(payload)
        _required(payload, 'move', 'expected')
        move, expected = chess.Move.from_uci(str(payload['move'])), chess.Move.from_uci(str(payload['expected']))
        if move not in board.legal_moves or expected not in board.legal_moves:
            raise ValueError('That move is not legal in this position.')
        return engine_call(lambda engine: score_guess(engine, board, move, expected)), 200
    if path == '/api/trainer/mistakes/result':
        _required(payload, 'gameId')
        with LOCK:
            state = load_state(state_path)
            entry = record_mistakes(state, payload['gameId'], payload.get('found'), payload.get('total'), now_utc())
            save_state(state_path, state)
        return entry, 200
    if path == '/api/trainer/masters/result':
        _required(payload, 'masterId')
        master_id = masters.summary(str(payload['masterId']))['id']  # an unknown master raises
        with LOCK:
            state = load_state(state_path)
            entry = record_guess(state, master_id, payload.get('index'), payload.get('score'), payload.get('max'), now_utc())
            save_state(state_path, state)
        return entry, 200
    return {'error': 'Not found'}, 404
