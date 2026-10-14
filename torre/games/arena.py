"""The Arena: matches between two players, played out in a background thread.

A player is an engine from the registry (optionally held to a rating), a model on
an engine (Maia on Lc0), or a legend from masters.py, who plays their own opening
moves and then hands over to an engine at their peak rating. A match is a number
of games with colors alternating; with varied or book openings, each pair of games
starts from the same line so both players get both sides of it. Book openings are
drawn at random from the lines the legends' games reach most often.

A match can also stop early under a sequential probability ratio test (SPRT, as
cutechess and Fishtest run it): after every game the log-likelihood ratio of "the
first player is elo1 stronger" against "elo0 stronger" is checked against bounds
set by alpha and beta, and the match ends as soon as either hypothesis is accepted.

Each side runs its own engine process for the whole match, so the Arena never
waits on the board's analysis engine. Finished matches are appended to
data/arena.jsonl.
"""
import contextlib
import copy
import json
import logging
import math
import random
import threading
import time
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import chess
import chess.engine

from torre.analysis import engines
from torre.analysis import insights
from torre.server import jobs
from torre import jsonio
from torre.games import masters
from torre.analysis import scoring
log = logging.getLogger(__name__)

MOVETIMES = (0.05, 0.1, 0.3, 1.0, 3.0)
GAME_COUNTS = (1, 2, 4, 6, 10, 20, 50)
MAX_PLIES = 400          # a game still going after 200 moves is called a draw
WATCH_SECONDS = 0.7      # in watch pace, every move stays on the board at least this long
ENGINE_OPTIONS = {'Threads': 1, 'Hash': 64}
# The eval bar: full-strength Stockfish judges every position between moves, so it never
# competes with the players for CPU. Neither side's own score is neutral (a legend in book
# or Maia has none, and a rating-limited engine plays below what it sees).
JUDGE_LIMIT = chess.engine.Limit(depth=14, time=0.12)

# Balanced book lines for varied openings: (id, UCI moves). The UI names them.
OPENINGS = [
    ('italian', 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5'),
    ('ruy-lopez', 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6'),
    ('sicilian-najdorf', 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6'),
    ('french', 'e2e4 e7e6 d2d4 d7d5 b1c3 g8f6'),
    ('caro-kann', 'e2e4 c7c6 d2d4 d7d5 e4e5 c8f5'),
    ('scandinavian', 'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5'),
    ('queens-gambit', 'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6'),
    ('slav', 'd2d4 d7d5 c2c4 c7c6 g1f3 g8f6'),
    ('kings-indian', 'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6'),
    ('nimzo-indian', 'd2d4 g8f6 c2c4 e7e6 b1c3 f8b4'),
    ('english', 'c2c4 e7e5 b1c3 g8f6 g1f3 b8c6'),
    ('london', 'd2d4 d7d5 c1f4 g8f6 e2e3 c7c5'),
]
BOOK_PLIES = 8           # book openings: the first four moves of a master game
BOOK_MIN_GAMES = 50      # ...on a line the legends reached at least this often
SPRT_DEFAULTS = {'elo0': 0, 'elo1': 50, 'alpha': 0.05, 'beta': 0.05}
_pool_lock = threading.Lock()
_pool_cache = {}         # (plies, min_games) -> (files signature, pool)


def utc_now():
    return datetime.now(timezone.utc)


def elo_difference(score, games):
    """The rating gap a score implies (positive: the first player is stronger), or None at 0% or 100%."""
    if not games or score <= 0 or score >= games:
        return None
    return round(-400 * math.log10(games / score - 1))


def _expected(elo):
    """The score a player that much stronger expects (logistic Elo)."""
    return 1 / (1 + 10 ** (-elo / 400))


def sprt_bounds(alpha=0.05, beta=0.05):
    """(lower, upper): accept H0 at or below lower, H1 at or above upper."""
    return math.log(beta / (1 - alpha)), math.log((1 - beta) / alpha)


def sprt_llr(wins, draws, losses, elo0=0, elo1=50):
    """The trinomial GSPRT log-likelihood ratio of H1 (the first player is elo1 stronger)
    over H0 (elo0 stronger), from their wins, draws and losses. Once a game is in, a count
    of zero counts as half a game, so a sweep can be judged without one result settling it."""
    if wins + draws + losses <= 0:
        return 0.0
    counts = [c or 0.5 for c in (wins, draws, losses)]
    n = sum(counts)
    score = (counts[0] + 0.5 * counts[1]) / n
    var = (counts[0] * (1 - score) ** 2 + counts[1] * (0.5 - score) ** 2 + counts[2] * score ** 2) / n
    s0, s1 = _expected(elo0), _expected(elo1)
    return n * (s1 - s0) * (2 * score - s0 - s1) / (2 * var)


def sprt_config(spec):
    """The SPRT settings a request asks for (true or {elo0, elo1, alpha, beta}), or None when off."""
    if spec in (None, False):
        return None
    if spec is True:
        spec = {}
    if not isinstance(spec, dict):
        raise ValueError('"sprt" must be true or an object with elo0, elo1, alpha and beta.')
    config = {**SPRT_DEFAULTS, **{k: spec[k] for k in SPRT_DEFAULTS if spec.get(k) is not None}}
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in config.values()):
        raise ValueError('SPRT settings must be numbers.')
    if not -1000 <= config['elo0'] < config['elo1'] <= 1000:
        raise ValueError('SPRT needs elo0 below elo1, both within 1000.')
    if not (0 < config['alpha'] < 0.5 and 0 < config['beta'] < 0.5):
        raise ValueError('SPRT alpha and beta must be between 0 and 0.5.')
    return config


def sprt_status(wdl, config):
    """Where the test stands after these results: {llr, lower, upper, elo0, elo1, alpha, beta, verdict}."""
    lower, upper = sprt_bounds(config['alpha'], config['beta'])
    llr = sprt_llr(*wdl, config['elo0'], config['elo1'])
    verdict = 'H1' if llr >= upper else 'H0' if llr <= lower else None
    return {'llr': round(llr, 3), 'lower': round(lower, 3), 'upper': round(upper, 3), **config, 'verdict': verdict}


def opening_pool(plies=BOOK_PLIES, min_games=BOOK_MIN_GAMES):
    """Every line of `plies` moves the legends' games reached at least min_games times, commonest
    first: {id, moves (UCI), san, eco, name, games}. A scan of every master PGN (seconds), cached
    until a file changes."""
    paths, seen = [], set()
    for folder in masters._folders():
        for path in sorted(folder.glob('*.pgn')) if folder.is_dir() else []:
            if path.stem not in seen:
                seen.add(path.stem)
                paths.append(path)
    signature = tuple((str(p), p.stat().st_mtime_ns) for p in paths)
    with _pool_lock:
        cached = _pool_cache.get((plies, min_games))
        if cached and cached[0] == signature:
            return cached[1]
    lines, ecos = Counter(), {}
    for path in paths:
        for headers, movetext in masters._games(path.read_text(encoding='utf-8', errors='replace')):
            text = masters._VARIATION.sub(' ', masters._COMMENT.sub(' ', movetext[:400]))
            tokens = tuple(masters._NOISE.sub(' ', text).split()[:plies])
            if len(tokens) == plies:
                lines[tokens] += 1
                ecos.setdefault(tokens, Counter())[headers.get('ECO', '')] += 1
    pool = []
    for tokens, count in lines.most_common():
        if count < min_games:
            break
        board, moves = chess.Board(), []
        try:
            for token in tokens:
                moves.append(board.push_san(token).uci())
        except ValueError:
            continue
        if board.is_game_over():
            continue
        eco = next((e for e, _ in ecos[tokens].most_common() if e), None)
        san = ' '.join(f'{i // 2 + 1}.{t}' if i % 2 == 0 else t for i, t in enumerate(tokens))
        pool.append({'id': ' '.join(moves), 'moves': moves, 'san': san, 'eco': eco,
                     'name': insights.eco_name(eco) if eco else None, 'games': count})
    with _pool_lock:
        _pool_cache[(plies, min_games)] = (signature, pool)
    return pool


def pick_openings(pool, pairs, rng):
    """One line per pair of games, at random and without repeats until the pool runs out."""
    picks = []
    while pool and len(picks) < pairs:
        picks += rng.sample(pool, min(len(pool), pairs - len(picks)))
    return picks


class Player:
    """One side of a match, resolved from the request's spec and checked before play."""

    def __init__(self, spec):
        if not isinstance(spec, dict):
            raise ValueError('Each player needs an engine or a legend.')
        self.master = None
        self.book = None
        master_id = spec.get('masterId')
        if master_id:
            self.master = masters.summary(str(master_id))
        self.engine_id = str(spec.get('engineId') or 'stockfish')
        entry = engines.get(self.engine_id)
        if entry is None:
            raise ValueError(f'Unknown engine: {self.engine_id}.')
        if not engines.installed(self.engine_id):
            raise ValueError(f"{entry['name']} is not installed.")
        self.model = None
        if spec.get('modelId'):
            self.model = next((m for m in entry.get('models', []) if m.get('id') == str(spec['modelId'])), None)
            if self.model is None:
                raise ValueError(f"Unknown model: {spec['modelId']}.")
            if not self.model.get('installed'):
                raise ValueError(f"{self.model['name']} is not installed.")
        elo = spec.get('elo')
        if self.master and elo is None and self.model is None:
            elo = self.master['elo']  # after the book, the legend plays at their peak
        if elo is not None and self.model is None:
            if not isinstance(elo, int) or not 100 <= elo <= engines.STOCKFISH_MAX_ELO:
                raise ValueError('"elo" must be a whole number from 100 to 3190.')
        self.elo = elo if self.model is None else None
        self.entry = entry
        self.options, self.slip = (engines.strength_options(entry, self.elo) if self.elo is not None else ({}, 0.0))
        # A node (and depth) cap instead of, or on top of, a rating: a smoother strength curve.
        self.nodes, self.depth = engines.node_limits(spec) if self.model is None else (None, None)

    @property
    def name(self):
        if self.master:
            return self.master['name']
        if self.model:
            return self.model['name']
        name = f"{self.entry['name']} {self.elo}" if self.elo is not None else self.entry['name']
        return f'{name} ({self.nodes} nodes)' if self.nodes else name

    def node_rating(self):
        """The approximate rating of a node-capped engine (none for neural engines or a rated one)."""
        if self.nodes and self.elo is None and self.entry.get('type') != 'neural':
            return engines.elo_for_nodes(self.nodes)
        return None

    def describe(self):
        """What the UI shows for this player."""
        engine_name = self.model['name'] if self.model else self.entry['name']
        return {'name': self.name, 'engineId': self.engine_id, 'modelId': self.model['id'] if self.model else None,
                'masterId': self.master['id'] if self.master else None, 'elo': self.elo, 'nodes': self.nodes, 'depth': self.depth,
                'engine': engine_name, 'rating': self.master['peak'] if self.master else self.elo or self.node_rating() or (self.model or {}).get('rating_target') or self.entry.get('strength_ccrl')}

    def prepare(self):
        """Load a legend's book (seconds the first time, then cached)."""
        if self.master and self.book is None:
            self.book = masters.book(self.master['id'])

    @contextlib.contextmanager
    def process(self):
        with engines.POOL.session(self.engine_id, model_id=self.model['id'] if self.model else None,
                                  options={**ENGINE_OPTIONS, **self.options}) as engine:
            yield engine

    def choose(self, engine, board, movetime, rng):
        """(move, note): the note says where the move came from (book, slip, or the engine's score)."""
        if self.book is not None:
            hit = masters.book_move(self.book, board, rng)
            if hit:
                return hit['move'], {'book': {'count': hit['count'], 'total': hit['total'], 'game': hit['game']}}
        if self.slip and rng.random() < self.slip:
            return rng.choice(list(board.legal_moves)), {'slip': True}
        limit = chess.engine.Limit(**(self.model.get('go_override') or {'time': movetime})) if self.model else engines.search_limit(self.nodes, self.depth, movetime)
        result = engine.play(board, limit, info=chess.engine.INFO_SCORE)
        score = result.info.get('score')
        note = {}
        if score is not None and self.model is None:
            white = score.white()
            note['eval'] = {'cp': white.score(), 'mate': white.mate()}
        return result.move, note


AI_EFFORTS = ('low', 'medium', 'high', 'xhigh', 'max')
AI_LEVELS = range(6)            # Prompture's harness levels, 0 (every legal move, no help) to 5
AI_MAX_TOKENS = 32000           # the reply, reasoning included; Fable at max effort can think past 16k
AI_TIMEOUT_S = 900              # stream read timeout: active long thinks keep the connection alive
AI_ENGINE_LIMIT = chess.engine.Limit(depth=14, time=0.3)  # the harness's engine at levels 2+


class AiPlayer:
    """A language model through Prompture's chess harness. Each turn the model is shown the
    position and a menu of legal moves and must pick one, so it never plays an illegal move;
    `level` is how much the harness helps (0: every legal move, nothing else; 2 and up lean on
    Stockfish, see prompture.games). The model's key is the one saved for the coach, if any."""

    def __init__(self, spec, data_dir=None):
        model = str(spec.get('model') or '')
        if '/' not in model:
            raise ValueError('An AI player needs a model such as "claude/claude-fable-5-1".')
        level = spec.get('level', 1)
        if level not in AI_LEVELS or isinstance(level, bool):
            raise ValueError('"level" must be a whole number from 0 to 5.')
        effort = spec.get('effort', 'high')  # explicit None keeps the provider's default
        if effort is not None and effort not in AI_EFFORTS:
            raise ValueError(f'"effort" must be one of {", ".join(AI_EFFORTS)}.')
        try:
            from prompture.games.chess import ChessHarness  # noqa: F401 (checked before the match starts)
        except ImportError as error:
            raise ValueError('AI players need a Prompture with the chess harness (prompture.games).') from error
        if level >= 2 and not engines.installed('stockfish'):
            raise ValueError(f'Level {level} needs Stockfish, and it is not installed.')
        from torre.coaching import coach_ai
        self.model, self.level, self.effort = model, level, effort
        self.key = coach_ai.key_for(data_dir, model) if data_dir else None
        self.label = str(spec.get('name') or model.split('/', 1)[1])

    @property
    def name(self):
        return self.label

    def describe(self):
        return {'name': self.name, 'engineId': None, 'modelId': None, 'masterId': None, 'elo': None,
                'nodes': None, 'depth': None, 'engine': self.model, 'rating': None,
                'ai': {'model': self.model, 'level': self.level, 'effort': self.effort}}

    def prepare(self):
        pass

    def options(self):
        """The model call's options: room to reason, and the effort in each provider's own word."""
        options = {'max_tokens': AI_MAX_TOKENS, 'timeout': AI_TIMEOUT_S}
        if self.effort:
            provider = self.model.split('/', 1)[0]
            options['reasoning_effort' if provider in ('openai', 'azure') else 'effort'] = self.effort
        return options

    @contextlib.contextmanager
    def process(self):
        from prompture.drivers import get_driver_for_model
        from prompture.games.chess import ChessHarness
        with contextlib.ExitStack() as stack:
            engine = (stack.enter_context(engines.POOL.session('stockfish', options=ENGINE_OPTIONS, profile=False))
                      if self.level >= 2 else None)
            driver = get_driver_for_model(self.model, api_key=self.key) if self.key else None
            yield ChessHarness(self.model, driver=driver, level=self.level, engine=engine,
                               engine_limit=AI_ENGINE_LIMIT if engine else None, options=self.options(),
                               concepts='all' if self.level >= 1 else (), stream=True)

    def choose(self, harness, board, movetime, rng):
        """(move, note): the note keeps the model's reason, its rejected tries, and what the turn cost."""
        started = time.monotonic()
        decision = harness.choose(board)
        errors = [a.error for a in decision.attempts if a.error]
        # No try produced an answer (no credit, the provider down, a reply cut off at max_tokens
        # or not JSON): the harness would play a random move for it, and the game would no
        # longer be the model's. Stop the match instead, so it can be continued. A model that
        # answered with moves it was not offered is still rescued; that is its own mistake.
        if decision.rescued and errors and all(getattr(a, 'reply', None) is None for a in decision.attempts):
            raise RuntimeError(f'{self.name}: {errors[-1]}')
        note = {'ai': {'reason': decision.reason, 'plan': decision.plan,
                       'tries': len(decision.attempts), 'rescued': decision.rescued,
                       'cost': round(decision.usage.get('cost') or 0.0, 6),
                       'tokens': int(decision.usage.get('total_tokens') or 0),
                       'seconds': round(time.monotonic() - started, 1)}}
        if errors:
            note['ai']['errors'] = errors
        return decision.move, note


def make_player(spec, data_dir=None):
    """An Arena side from the request: an AI model ({"ai": {...}}), or an engine or a legend."""
    if isinstance(spec, dict) and isinstance(spec.get('ai'), dict):
        return AiPlayer(spec['ai'], data_dir)
    return Player(spec)


def judge(engine, board):
    """White's score for the eval bar ({cp, mate}) and the judge's best move, or None once the game is over."""
    if engine is None or board.is_game_over(claim_draw=True):
        return None
    infos = engine.analyse(board, JUDGE_LIMIT, multipv=2)
    info = infos[0]
    score, pv = info['score'].white(), info.get('pv') or []
    runner = infos[1]['score'].white() if len(infos) > 1 else None
    return {'cp': score.score(), 'mate': score.mate(), 'best': pv[0].uci() if pv else None,
            'alternative': [runner.score(), runner.mate()] if runner is not None else None}


GRADES = scoring.GRADES


def grade_move(board, move, before, after):
    """Shared move flags from the judge, including exact terminal outcomes."""
    if before is None:
        return None
    if after is None:
        following = board.copy()
        following.push(move)
        after = scoring.verdict(following, None)
    return scoring.classify(board, move, before, after)


def grade_name(grade):
    """The same exclusive category used by reviews, exports and Insights."""
    if not grade:
        return None
    return scoring.grade(grade)


def board_view(board):
    """The board as the UI's ChessBoard wants it (nothing is movable)."""
    outcome = board.outcome(claim_draw=True)
    return {'fen': board.fen(), 'turn': 'white' if board.turn else 'black',
            'pieces': {chess.square_name(s): p.symbol() for s, p in board.piece_map().items()},
            'legal': [], 'check': chess.square_name(board.king(board.turn)) if board.is_check() else None,
            'result': outcome.result() if outcome else None,
            'termination': outcome.termination.name.replace('_', ' ').lower() if outcome else None,
            'plans': {}, 'control': {}}


class ArenaJob(jobs.BackgroundJob):
    """One match at a time; the UI polls status() while it runs."""
    busy_message = 'A match is already running.'
    label = 'The arena match'

    def __init__(self):
        super().__init__({'running': False, 'match': None})
        self.data_dir = None

    def _matches(self):
        return jsonio.read_jsonl(Path(self.data_dir) / 'arena.jsonl') if self.data_dir else []

    def recent(self, limit=12):
        """The last finished matches, newest first, without their move lists."""
        keys = ('id', 'date', 'players', 'score', 'games_played', 'elo_diff', 'stopped', 'settings', 'wdl', 'early', 'sprt', 'cost', 'capped')
        return [{k: row.get(k) for k in keys} for row in self._matches()[-limit:][::-1]]

    def saved(self, match_id):
        """A finished match with its games' moves, or None."""
        return next((copy.deepcopy(row) for row in self._matches() if row.get('id') == match_id), None)

    def start(self, payload, data_dir):
        """Validate the match and start it. Raises ValueError for a bad request."""
        players = payload.get('players')
        if not isinstance(players, list) or len(players) != 2:
            raise ValueError('A match needs two players.')
        games = payload.get('games', 2)
        if games not in GAME_COUNTS:
            raise ValueError(f'"games" must be one of {", ".join(map(str, GAME_COUNTS))}.')
        movetime = payload.get('movetime', 0.1)
        if movetime not in MOVETIMES:
            raise ValueError(f'"movetime" must be one of {", ".join(map(str, MOVETIMES))} seconds.')
        openings = payload.get('openings', 'varied')
        if openings not in ('start', 'varied', 'book'):
            raise ValueError('"openings" must be start, varied or book.')
        pace = payload.get('pace', 'watch')
        if pace not in ('watch', 'fast'):
            raise ValueError('"pace" must be watch or fast.')
        sprt = sprt_config(payload.get('sprt'))
        seed = payload.get('seed')
        if seed is not None and (not isinstance(seed, int) or isinstance(seed, bool)):
            raise ValueError('"seed" must be a whole number.')
        start_moves = self._start_moves(payload.get('startMoves'))
        if start_moves and (games != 1 or openings != 'start'):
            raise ValueError('"startMoves" continues one game: use games 1 and openings "start".')
        cost_cap = payload.get('costCap')
        if cost_cap is not None and (isinstance(cost_cap, bool) or not isinstance(cost_cap, (int, float)) or cost_cap <= 0):
            raise ValueError('"costCap" must be a positive number of dollars.')
        sides = [make_player(spec, data_dir) for spec in players]
        self.data_dir = data_dir
        self.launch({'running': True, 'match': {
            'id': uuid.uuid4().hex[:12], 'date': utc_now().strftime('%Y-%m-%d %H:%M'),
            'players': [p.describe() for p in sides], 'phase': 'preparing',
            'settings': {'games': games, 'movetime': movetime, 'openings': openings, 'pace': pace, 'sprt': sprt, 'seed': seed,
                         'costCap': cost_cap, 'startMoves': start_moves},
            'cost': [0.0, 0.0], 'capped': False, 'score': [0.0, 0.0], 'wdl': [0, 0, 0], 'grades': [dict.fromkeys(GRADES, 0), dict.fromkeys(GRADES, 0)], 'games': [], 'current': None, 'error': None, 'stopped': False,
            'early': False, 'sprt': sprt_status((0, 0, 0), sprt) if sprt else None}},
            sides, games, movetime, openings, pace, sprt, seed, start_moves)
        return self.status()

    @staticmethod
    def _start_moves(moves):
        """The UCI moves a game continues from (an AI game cut short), checked for legality; [] for none."""
        if moves is None:
            return []
        if not isinstance(moves, list) or not all(isinstance(m, str) for m in moves):
            raise ValueError('"startMoves" must be a list of UCI moves.')
        board = chess.Board()
        for uci in moves:
            try:
                move = chess.Move.from_uci(uci)
            except ValueError:
                move = None
            if move is None or move not in board.legal_moves:
                raise ValueError(f'"startMoves": {uci} is not legal after {len(board.move_stack)} moves.')
            board.push(move)
        if board.is_game_over(claim_draw=True):
            raise ValueError('"startMoves" ends the game already.')
        return list(moves)

    def _update(self, **changes):
        with self.lock:
            self.state['match'].update(changes)

    @staticmethod
    def _lines(openings, games, rng):
        """The starting line for each pair of games: (id, UCI moves, extra fields for the game record)."""
        if openings == 'varied':
            return [(OPENINGS[i % len(OPENINGS)][0], OPENINGS[i % len(OPENINGS)][1].split(), {}) for i in range((games + 1) // 2)]
        if openings == 'book':
            picks = pick_openings(opening_pool(), (games + 1) // 2, rng)
            if not picks:
                raise ValueError('No master games to draw book openings from; download some legends first.')
            return [(p['san'], p['moves'], {'eco': p['eco'], 'openingName': p['name']}) for p in picks]
        return []

    def work(self, sides, games, movetime, openings, pace, sprt=None, seed=None, start_moves=None):
        rng = random.Random(seed)
        for side in sides:
            side.prepare()
        lines = [(None, start_moves, {'continued': len(start_moves)})] if start_moves else self._lines(openings, games, rng)
        self._update(phase='playing')
        with contextlib.ExitStack() as stack:
            processes = [stack.enter_context(side.process()) for side in sides]
            judge_engine = (stack.enter_context(engines.POOL.session('stockfish', options={'Threads': 1, 'Hash': 32}, profile=False))
                            if engines.installed('stockfish') else None)
            for number in range(games):
                if self.stopping:
                    break
                line = lines[number // 2] if lines else (None, [], {})
                if not self._play(number, sides, processes, judge_engine, movetime, line, pace, rng) or not sprt:
                    continue
                with self.lock:
                    match = self.state['match']
                    match['sprt'] = sprt_status(match['wdl'], sprt)
                    match['early'] = bool(match['sprt']['verdict'])
                if match['early']:
                    break

    def failed(self, exc):
        log.error('The arena match failed', exc_info=exc)
        self._update(error=str(exc) or type(exc).__name__)

    def finished(self):
        with self.lock:
            match = self.state['match']
            match['phase'] = 'done'
            match['stopped'] = self.stopping
            match['current'] = None
            match['elo_diff'] = elo_difference(match['score'][0], sum(g.get('result') != '*' for g in match['games']))
            snapshot = copy.deepcopy(match)
        if snapshot['games']:
            self._save(snapshot)

    def _play(self, number, sides, processes, judge_engine, movetime, line, pace, rng):
        """Play one game from the line (id, UCI moves, extra record fields); False if stopped before the end."""
        # Even games: the first player has White. A pair shares its opening line.
        white = number % 2
        order = [white, 1 - white]  # order[0] plays White
        opening_id, line, extra = line
        board = chess.Board()
        for side, process in zip(sides, processes):
            if isinstance(side, AiPlayer):
                process.reset()
        moves, notes = [], []
        for uci in line:
            move = chess.Move.from_uci(uci)
            moves.append({'uci': uci, 'san': board.san(move)})
            notes.append({'opening': True})
            board.push(move)
        current = {'number': number + 1, 'white': order[0], 'opening': opening_id, **extra, 'moves': list(moves), 'notes': list(notes),
                   'board': board_view(board), 'lastMove': moves[-1]['uci'] if moves else None, 'evals': [None, None],
                   'judge': judge(judge_engine, board)}
        self._update(current=current)
        # The judge's verdict on the position to move, carried from one move to the next to grade each one.
        verdict = current['judge']
        grades = [dict.fromkeys(GRADES, 0), dict.fromkeys(GRADES, 0)]
        result, termination = None, None
        while True:
            outcome = board.outcome(claim_draw=True)
            if outcome:
                result, termination = outcome.result(), outcome.termination.name.replace('_', ' ').lower()
                break
            if len(board.move_stack) >= MAX_PLIES:
                result, termination = '1/2-1/2', 'move limit'
                break
            if self.stopping:
                if self._ai_record(notes):  # an AI game is worth keeping (and continuing), even half played
                    self._keep_unfinished(number, order, 'stopped', opening_id, extra, moves, notes, grades)
                return False
            mover = order[0] if board.turn == chess.WHITE else order[1]
            started = time.monotonic()
            try:
                move, note = sides[mover].choose(processes[mover], board, movetime, rng)
            except Exception:
                # A model call that failed for good (arena.AiPlayer): keep the game so far, then fail the match.
                if self._ai_record(notes) or isinstance(sides[mover], AiPlayer):
                    self._keep_unfinished(number, order, 'model error', opening_id, extra, moves, notes, grades)
                raise
            moves.append({'uci': move.uci(), 'san': board.san(move)})
            played_from = board.copy()
            board.push(move)
            before, verdict = verdict, judge(judge_engine, board)
            grade = grade_move(played_from, move, before, verdict)
            if grade:
                note['grade'] = grade
                if grade_name(grade):
                    grades[mover][grade_name(grade)] += 1
            notes.append(note)
            capped = 'ai' in note and self._spend(mover, note['ai']['cost'])
            if pace == 'watch' and not capped:
                time.sleep(max(0.0, WATCH_SECONDS - (time.monotonic() - started)))
            with self.lock:
                current = self.state['match']['current']
                current.update(moves=list(moves), notes=list(notes), board=board_view(board), lastMove=move.uci(), judge=verdict)
                if 'eval' in note:
                    current['evals'][mover] = note['eval']
            if capped:
                result, termination = '*', 'cost cap'
                break
        if result == '*':
            self._keep_unfinished(number, order, termination, opening_id, extra, moves, notes, grades)
            return False
        # Score from the first player's point of view.
        first = {'1-0': 1.0, '0-1': 0.0}.get(result, 0.5) if order[0] == 0 else {'1-0': 0.0, '0-1': 1.0}.get(result, 0.5)
        with self.lock:
            match = self.state['match']
            match['score'][0] += first
            match['score'][1] += 1 - first
            match['wdl'][{1.0: 0, 0.5: 1, 0.0: 2}[first]] += 1
            match['games'].append({'number': number + 1, 'white': order[0], 'result': result, 'termination': termination,
                                   'opening': opening_id, **extra, 'plies': len(moves), 'moves': [m['uci'] for m in moves],
                                   'book': self._book_counts(notes, order), 'grades': grades,
                                   **self._ai_record(notes)})
            for player in (0, 1):
                for name, count in grades[player].items():
                    match['grades'][player][name] += count
        if pace == 'watch' and not self.stopping:
            time.sleep(1.5)  # a moment to see how it ended
        return True

    def _keep_unfinished(self, number, order, termination, opening_id, extra, moves, notes, grades):
        """Record a game cut short (cost cap, a stop, a failed model call) as unfinished: kept for
        replaying and continuing (startMoves), not scored."""
        with self.lock:
            self.state['match']['games'].append({
                'number': number + 1, 'white': order[0], 'result': '*', 'termination': termination,
                'opening': opening_id, **extra, 'plies': len(moves), 'moves': [m['uci'] for m in moves],
                'book': self._book_counts(notes, order), 'grades': grades, **self._ai_record(notes)})

    def _spend(self, player, cost):
        """Add an AI turn's cost to its player; True (and the match stops) once the cap is reached."""
        with self.lock:
            match = self.state['match']
            match['cost'][player] = round(match['cost'][player] + cost, 6)
            cap = match['settings'].get('costCap')
            if not cap or sum(match['cost']) < cap:
                return False
            match['capped'] = True
        self.stop()
        return True

    @staticmethod
    def _ai_record(notes):
        """What the AI players said and spent on each of their moves, for the saved game (none without AI)."""
        if not any('ai' in note for note in notes):
            return {}
        return {'ai': [note.get('ai') for note in notes]}

    @staticmethod
    def _book_counts(notes, order):
        """How many moves each player made from their own games (legends only)."""
        counts = [0, 0]
        for ply, note in enumerate(notes):
            if note.get('book'):
                counts[order[ply % 2]] += 1
        return counts

    def _save(self, match):
        path = Path(self.data_dir) / 'arena.jsonl'
        record = {k: match.get(k) for k in ('id', 'date', 'players', 'settings', 'score', 'wdl', 'grades', 'games', 'elo_diff', 'stopped', 'early', 'sprt', 'cost', 'capped')}
        record['games_played'] = len(match['games'])
        with path.open('a', encoding='utf-8') as handle:
            handle.write(json.dumps(record) + '\n')


JOB = ArenaJob()
