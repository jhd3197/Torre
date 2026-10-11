"""Engine work for the studio's requests: analysis lines, lesson-move judging, bot moves, drill
grading, and the review results kept across sessions (position-evals.jsonl).

Every engine process comes from engines.POOL and stays running between requests. Analysis
(reviews, lines, judging, explanations, the trainer) shares one process per engine; bot moves,
drill grading and the endgame defender each have their own slot, so a bot's strength never
reaches the analysis and none of them waits for another. The pool's thread budget keeps them,
and the background analysis, within the machine's cores together.
"""
import contextlib
import json
import os
import random
import threading

import chess
import chess.engine

from torre.analysis import analyze
from torre.server import appdata
from torre.analysis import engines
from torre import jsonio
from torre.analysis import motifs
from torre.analysis import scoring
# Opening a game reviews every position; a short search each keeps that to seconds.
# Analysis asks for half the cores so the rest of the machine stays responsive.
REVIEW_SECONDS = .15
REVIEW_THREADS = max(2, (os.cpu_count() or 4) // 2)
EXPLAIN_SECONDS = .6  # engine time for each line an explanation is built on
BOT_SECONDS = .35  # a bot's think time when no node or depth cap is set
ANALYSIS_OPTIONS = {'Threads': REVIEW_THREADS, 'Hash': 128}
PLAY_OPTIONS = {'Threads': 2, 'Hash': 64}
ENDGAME_OPTIONS = {'Threads': 1, 'Hash': 32}
ENGINE_PATH = engines.resolve_engine('stockfish')  # STOCKFISH_PATH, a packaged engine/, the local download, then PATH


@contextlib.contextmanager
def analysis(engine_id='stockfish', model_id=None):
    """The pooled analysis engine, held for the block."""
    with engines.POOL.acquire(engine_id, model_id, options=ANALYSIS_OPTIONS) as engine:
        yield engine


@contextlib.contextmanager
def player(engine_id='stockfish', model_id=None, strength=None):
    """The pooled engine bots play with, at `strength` (UCI options) for the block. A model
    (Maia) shares its analysis process, since its weights are its strength."""
    slot = None if model_id else 'play'
    with engines.POOL.acquire(engine_id, model_id, slot, options={**PLAY_OPTIONS, **(strength or {})}) as engine:
        yield engine


@contextlib.contextmanager
def endgame_defender():
    """The pooled Stockfish that answers endgame practice moves (no saved profile, as before)."""
    with engines.POOL.acquire('stockfish', slot='endgame', options=ENDGAME_OPTIONS, profile=False) as engine:
        yield engine


def engine_lines(engine, board, seconds, multipv=3):
    """The engine's top lines from `board` (three, or as many as its profile's MultiPV), scored for White."""
    infos = engine.analyse(board, chess.engine.Limit(time=seconds), multipv=multipv)
    lines = []
    for info in infos:
        variation = board.copy()
        sans = []
        pv = info.get('pv', [])
        for move in pv[:7]:
            sans.append(variation.san(move))
            variation.push(move)
        score = info['score'].white()
        lines.append({'cp': score.score(mate_score=10000), 'mate': score.mate(), 'moves': sans, 'uci': [m.uci() for m in pv[:7]], 'depth': info.get('depth')})
    return {'lines': lines, 'best': lines[0]['uci'][0] if lines else None}


# A lesson move other than the listed one counts as just as good when Stockfish scores it within
# this many centipawns of the listed move, or when both keep a clearly winning position.
JUDGE_MARGIN = 70
JUDGE_WINNING = 400
JUDGE_DEPTH = 14  # a fixed depth, so the verdict does not depend on how busy the machine is


def judge_move(engine, board, move, expected):
    """Score `move` against the lesson's `expected` move from `board`, for the side to move.
    Returns the verdict ('good' or 'worse'), how much worse it is, and the line that answers it."""
    def scored(candidate):
        info = engine.analyse(board, chess.engine.Limit(depth=JUDGE_DEPTH), root_moves=[candidate])
        return info['score'].pov(board.turn).score(mate_score=10000), info.get('pv', []), info['score'].white()
    expected_cp, _, _ = scored(expected)
    move_cp, pv, white = scored(move)
    if len(pv) < 3:
        # A search cut short by the hash can return just the move; the reply line comes from after it.
        after = board.copy()
        after.push(move)
        if not after.is_game_over():
            pv = [move] + engine.analyse(after, chess.engine.Limit(depth=JUDGE_DEPTH - 2)).get('pv', [])[:5]
    loss = max(0, expected_cp - move_cp)
    good = loss <= JUDGE_MARGIN or (move_cp >= JUDGE_WINNING and expected_cp >= JUDGE_WINNING)
    line, variation = [], board.copy()
    for step in pv[:4]:
        line.append(variation.san(step))
        variation.push(step)
    # What the answer does, for the page to say in a sentence: the tactic the reply sets up, and the
    # material the mover is down a few moves on (pawns, never above zero).
    ahead = board.copy(stack=False)
    for step in pv[:6]:
        ahead.push(step)
    tags = []
    if not good and len(pv) >= 2:
        after = board.copy(stack=False)
        after.push(pv[0])
        tags = motifs.tags_for(after, pv[1].uci(), [white.score(), white.mate()])
    return {'verdict': 'good' if good else 'worse', 'loss': loss, 'cp': move_cp, 'expected_cp': expected_cp,
            'line': line, 'uci': [m.uci() for m in pv[:4]], 'motifs': tags,
            'material': min(0, _material(ahead, board.turn) - _material(board, board.turn))}


COACH_DEPTH = 12  # the coach's reads during a game: quick, and the same on any machine


def _best(engine, board):
    """(best move, its White-POV score) at the coach's depth."""
    info = engine.analyse(board, chess.engine.Limit(depth=COACH_DEPTH), game=object())
    pv = info.get('pv') or []
    return (pv[0] if pv else None), info['score'].white()


def _described(board, move, score):
    """A move for the coach to talk about: uci, SAN, the piece, and the tactics it carries."""
    return {'uci': move.uci(), 'san': board.san(move), 'piece': chess.piece_name(board.piece_type_at(move.from_square)),
            'motifs': motifs.tags_for(board, move.uci(), [score.score(), score.mate()])}


def coach_hint(engine, board):
    """The best move for the side to move, and the opponent's threat: the move they would play if
    it were their turn, when it wins material or carries a tactic (None otherwise, or in check)."""
    best, score = _best(engine, board)
    hint = _described(board, best, score) if best else None
    threat = None
    if not board.is_check():
        passed = board.copy(stack=False)
        passed.turn = not passed.turn  # a pass: the opponent moves again
        passed.ep_square = None
        if passed.is_valid():
            move, threat_score = _best(engine, passed)
            if move:
                # What the capture wins once every recapture is made, so a fair trade is no threat.
                gain = scoring.see(passed, move.to_square) if passed.is_capture(move) else 0
                described = _described(passed, move, threat_score)
                if gain >= 1 or described['motifs']:
                    threat = {**described, 'gain': gain}
    return {'best': hint, 'threat': threat}


def coach_check(engine, board, move):
    """Your move judged against the engine's best (judge_move), with the best move named, so the
    coach can step in before a mistake is played."""
    best, _ = _best(engine, board)
    if best is None or best == move:
        return {'verdict': 'good', 'loss': 0, 'line': [], 'uci': [], 'motifs': [], 'material': 0, 'best': None}
    judged = judge_move(engine, board, move, best)
    return {**judged, 'best': {'uci': best.uci(), 'san': board.san(best)}}


def _material(board, color):
    """`color`'s material lead in pawns (pawn 1, minor 3, rook 5, queen 9)."""
    return sum(scoring.PIECE_VALUES.get(p.piece_type, 0) * (1 if p.color == color else -1) for p in board.piece_map().values())


def bot_move(engine, board, slip=0.0, rng=random, model=None, limit=None):
    """bot_choice's move alone."""
    return bot_choice(engine, board, slip, rng, model, limit)[0]


# A weak bot's slip is a move a beginner would consider, not a random one: one of the engine's
# other candidates from a shallow look, smaller mistakes more likely than big ones.
SLIP_DEPTH = 6
SLIP_LINES = 8
SLIP_SCALE = 150  # centipawns: a candidate this much worse than the best is half as likely


def human_slip(engine, board, rng=random):
    """A plausible weaker move for `board`: one of the engine's candidate moves other than its
    first choice, weighted toward the ones that lose least. Reviews of other apps called random
    blunders unrealistic; a beginner's mistakes are natural moves that miss something. Falls back
    to a random legal move when the engine offers no alternatives."""
    legal = list(board.legal_moves)
    try:
        infos = engine.analyse(board, chess.engine.Limit(depth=SLIP_DEPTH), multipv=SLIP_LINES, game=object())
    except (chess.engine.EngineError, AttributeError):
        infos = []
    ranked = [(info['pv'][0], info['score'].pov(board.turn).score(mate_score=10000)) for info in infos if info.get('pv')]
    if len(ranked) < 2:
        return rng.choice(legal)
    best = ranked[0][1]
    candidates = ranked[1:]
    weights = [1 / (1 + max(0, best - cp) / SLIP_SCALE) for _, cp in candidates]
    pick = rng.random() * sum(weights)
    for (move, _), weight in zip(candidates, weights):
        pick -= weight
        if pick <= 0:
            return move
    return candidates[-1][0]


def bot_choice(engine, board, slip=0.0, rng=random, model=None, limit=None):
    """A bot's move on `board` from an engine already set to its strength (see player()).
    `slip` is the chance of a weaker human-like move instead (human_slip; engines.strength_options). A model
    (Maia on Lc0) plays its go_override (one node, the policy head's read) instead of the
    usual fixed movetime; `limit` (a node or depth cap, see engines.search_limit) replaces
    the movetime for everyone else. Each move is a new game to the engine, so its hash starts
    empty as it did when every move had a process of its own and node caps keep their strength.
    Returns (move, slipped): slipped is True when the move was a deliberate slip."""
    if model is not None:
        limit = chess.engine.Limit(**(model.get('go_override') or {'time': BOT_SECONDS}))
        return engine.play(board, limit).move, False
    if slip and rng.random() < slip:
        return human_slip(engine, board, rng), True
    return engine.play(board, limit or chess.engine.Limit(time=BOT_SECONDS), game=object()).move, False


def evaluate(board):
    """White-POV [cp, mate] for a position, for grading drill answers: a fixed-depth search
    from an empty hash, so the grade does not depend on what the engine searched before."""
    with player() as engine:
        score = engine.analyse(board, chess.engine.Limit(depth=analyze.DEFAULT_DEPTH), game=object())['score'].white()
    return [None, score.mate()] if score.is_mate() else [score.score(), None]


EVALS_LOCK = threading.Lock()
_evals = None  # (data folder, {position key: {'lines': [...], 'best': uci}}), from position-evals.jsonl


def eval_key(board):
    """A position independent of how it was reached (move counters left out)."""
    return ' '.join(board.fen().split()[:4])


def saved_evals():
    """Review results kept across sessions, so a game reviewed once never needs Stockfish again. Hold EVALS_LOCK."""
    global _evals
    if _evals is None or _evals[0] != appdata.DATA_DIR:
        known = {row['key']: {'lines': row['lines'], 'best': row['best']}
                 for row in jsonio.read_records(appdata.DATA_DIR / 'position-evals.jsonl')
                 if {'key', 'lines', 'best'} <= row.keys()}
        _evals = (appdata.DATA_DIR, known)
    return _evals[1]


def forget_evals():
    """Drop the review results held in memory (they are read back from disk on next use)."""
    global _evals
    with EVALS_LOCK:
        _evals = None


def save_evals(new):
    """Append freshly computed results. Hold EVALS_LOCK."""
    if not new:
        return
    with (appdata.DATA_DIR / 'position-evals.jsonl').open('a', encoding='utf-8') as handle:
        for key, result in new.items():
            handle.write(json.dumps({'key': key, **result}) + '\n')
