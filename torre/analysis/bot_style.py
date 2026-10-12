"""Bot quirks: a character bot plays like its description says, not only at its rating.

The engine picks a move at the bot's strength (engine_service.bot_choice); a bot with a declared
quirk (Pip pushes his pawns two squares, Kwame Jr. loves his knights, Mila mirrors your moves,
Diego always opens 1.e4) then swaps it for a move that fits the quirk, when one is not much worse:
within a tolerance in centipawns that narrows as the bot's rating rises, so a beginner's quirks
show often and a master's only when they cost next to nothing. Among the moves that qualify, the
one scored closest to the engine's own choice wins, so a quirk changes how a bot plays, not how
well. Anything unusual (no fitting move, an engine error, a quirk this module does not know)
leaves the engine's move as it was; the result is always a legal move.

A style comes with the play request: {"quirk": name, "chance": 0..1, "opening": {"white": [SAN],
"black": [SAN]}}. `opening` is a bot's own first moves, tried in order while they are legal (one
already played no longer is); `quirk` is how it plays the rest of the game.
"""
import random

import chess
import chess.engine

from torre.analysis import scoring

QUIRKS = ('doublePush', 'knights', 'rimKnights', 'mirror', 'aggressive', 'trades', 'castle', 'fortress',
          'earlyQueen', 'pawnStorm', 'develop')
# How often a quirk is tried when the style gives no chance. A move from the bot's opening book
# and a mirrored move are its signature; the rest show most of the time, not always.
DEFAULT_CHANCE = {'opening': 1.0, 'mirror': 0.9}
QUIRK_CHANCE = 0.6
STYLE_DEPTH = 8  # a quick look at the few moves that fit, next to the move's own search
MAX_LINES = 6  # moves scored per look; the engine reports the best of the fitting ones
MATE = 10000
OPENING_MOVES = 12  # an opening list is at most this long, and only read in the first moves
EARLY_QUEEN_MOVES = 4
DEVELOP_MOVES = 12


def parse(raw):
    """A play request's "style", checked: None when absent; ValueError when malformed."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError('"style" must be an object.')
    quirk = raw.get('quirk')
    if quirk is not None and quirk not in QUIRKS:
        raise ValueError(f'Unknown quirk: {quirk}.')
    chance = raw.get('chance')
    if chance is not None and (isinstance(chance, bool) or not isinstance(chance, (int, float)) or not 0 <= chance <= 1):
        raise ValueError('"chance" must be a number from 0 to 1.')
    opening = raw.get('opening') or {}
    if not isinstance(opening, dict) or set(opening) - {'white', 'black'}:
        raise ValueError('"opening" lists moves for "white" and "black".')
    for moves in opening.values():
        if not isinstance(moves, list) or len(moves) > OPENING_MOVES or not all(isinstance(m, str) and 0 < len(m) <= 8 for m in moves):
            raise ValueError(f'An opening is a list of at most {OPENING_MOVES} moves.')
    if quirk is None and not opening:
        return None
    return {'quirk': quirk, 'chance': chance, 'opening': {side: list(moves) for side, moves in opening.items()}}


def tolerance(elo):
    """Centipawns a quirk's move may cost against the engine's choice: wide for a beginner,
    narrow for a master (180 at 500, about 100 at 1500, 25 from about 2400)."""
    elo = 1500 if elo is None else elo
    return round(max(25, min(180, 220 - 0.08 * elo)))


def _opening_move(board, style):
    """The bot's next book move, if any: the first move of its list that is legal here."""
    moves = style.get('opening', {}).get('white' if board.turn == chess.WHITE else 'black') or []
    if not moves or board.fullmove_number > len(moves) + 2:
        return None
    for san in moves:
        try:
            return board.parse_san(san)
        except ValueError:
            continue  # played already, or not possible here
    return None


def _mirror(board):
    """The mirror of the opponent's last move (e2e4 answered by e7e5), when there is one."""
    if not board.move_stack:
        return None
    last = board.peek()
    return chess.Move(chess.square_mirror(last.from_square), chess.square_mirror(last.to_square), last.promotion)


def _rank_for(board, square):
    """A square's rank counted from the side to move's own back rank (0 to 7)."""
    rank = chess.square_rank(square)
    return rank if board.turn == chess.WHITE else 7 - rank


def fits(board, move, quirk):
    """Whether `move` (legal on `board`) is the kind of move `quirk` likes."""
    piece = board.piece_type_at(move.from_square)
    if quirk == 'doublePush':
        return piece == chess.PAWN and abs(chess.square_rank(move.to_square) - chess.square_rank(move.from_square)) == 2
    if quirk == 'knights':
        return piece == chess.KNIGHT
    if quirk == 'rimKnights':
        return piece == chess.KNIGHT and chess.square_file(move.to_square) in (0, 7)
    if quirk == 'mirror':
        return move == _mirror(board)
    if quirk == 'aggressive':
        return board.is_capture(move) or board.gives_check(move)
    if quirk == 'trades':
        taken = board.piece_type_at(move.to_square)
        return taken is not None and piece != chess.KING and scoring.PIECE_VALUES.get(taken) == scoring.PIECE_VALUES.get(piece)
    if quirk == 'castle':
        return board.is_castling(move)
    if quirk == 'fortress':
        # Never a pawn past its own fourth rank.
        return piece != chess.PAWN or _rank_for(board, move.to_square) <= 3
    if quirk == 'earlyQueen':
        return piece == chess.QUEEN and board.fullmove_number <= EARLY_QUEEN_MOVES
    if quirk == 'pawnStorm':
        return piece == chess.PAWN and not board.is_capture(move)
    if quirk == 'develop':
        return (board.is_castling(move) or (piece in (chess.KNIGHT, chess.BISHOP) and _rank_for(board, move.from_square) == 0)) \
            and board.fullmove_number <= DEVELOP_MOVES
    return False


def candidates(board, style):
    """The moves the style would rather play here, the bot's book move first: a list of legal
    moves (empty when nothing fits)."""
    book = _opening_move(board, style)
    if book is not None and book in board.legal_moves:
        return [book]
    quirk = style.get('quirk')
    if quirk is None:
        return []
    return [move for move in board.legal_moves if fits(board, move, quirk)]


def choose(engine_move, scores, fitting, elo):
    """The move to play: of the `fitting` moves scored (`scores`, mover's centipawns), the one
    closest to the engine move's score and no more than tolerance(elo) below it. When the engine
    move was not scored (the look reports only the best few), every reported move is at least as
    good, so the lowest of them is the closest. The engine move when none qualifies."""
    scored = [(scores[move], move) for move in fitting if move in scores]
    if not scored:
        return engine_move
    if engine_move not in scores:
        return min(scored, key=lambda pair: pair[0])[1]
    target = scores[engine_move]
    allowed = [(cp, move) for cp, move in scored if cp >= target - tolerance(elo)]
    if not allowed:
        return engine_move
    return min(allowed, key=lambda pair: abs(pair[0] - target))[1]


def styled_move(engine, board, engine_move, style, elo=None, rng=random):
    """The bot's move with its style applied: (move, styled), styled True when the quirk changed
    it. `engine` is the bot's pooled engine; it scores the fitting moves and the engine's own
    in one shallow look. Falls back to `engine_move` whenever anything is off."""
    if not style:
        return engine_move, False
    book = _opening_move(board, style)
    kind = 'opening' if book is not None else style.get('quirk')
    if kind is None:
        return engine_move, False
    chance = style.get('chance')
    if chance is None or kind == 'opening':
        chance = DEFAULT_CHANCE.get(kind, QUIRK_CHANCE)
    # The roll comes first, so a quirk that does not show this move costs no search.
    if rng.random() >= chance:
        return engine_move, False
    fitting = candidates(board, style)
    if not fitting or (kind != 'opening' and fits(board, engine_move, kind)) or fitting == [engine_move]:
        return engine_move, False
    try:
        roots = fitting + ([] if engine_move in fitting else [engine_move])
        infos = engine.analyse(board, chess.engine.Limit(depth=STYLE_DEPTH), multipv=min(MAX_LINES, len(roots)), root_moves=roots)
    except (chess.engine.EngineError, AttributeError, TypeError):
        return engine_move, False
    if isinstance(infos, dict):
        infos = [infos]
    scores = {}
    for info in infos:
        pv = info.get('pv') or []
        if pv and 'score' in info:
            scores[pv[0]] = info['score'].pov(board.turn).score(mate_score=MATE)
    move = choose(engine_move, scores, fitting, elo)
    if move not in board.legal_moves:
        return engine_move, False
    return move, move != engine_move
