"""Move scoring: Lichess win%, accuracy and move judgments, plus Brilliant.

Everything except `is_brilliant` follows Lichess's published method:

  win%          50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1), cp clamped to
                +/-1000 and mate scores treated as +/-1000.
  move accuracy 103.1668 * exp(-0.043544 * win%_drop) - 3.1669, plus Lichess's
                +1 "uncertainty bonus", clamped to [0, 100]; 100 when the
                mover's win% did not drop.
  game accuracy mean of (a) per-move accuracy weighted by the volatility
                (std-dev of win%) around each move and (b) the harmonic mean
                of the per-move accuracies.
  judgments     drop in winning chances (-1..1 scale) of >= 0.1 inaccuracy,
                >= 0.2 mistake, >= 0.3 blunder; finding or losing a forced
                mate is judged by Lichess's mate rules instead. Unlike
                Lichess, a move that leaves the game as decided as it was
                (the mover at 90%+ before and after, or 10% or less) is at
                most an inaccuracy: from mate in 8 to +7 is not a blunder.

Evaluations are (cp, mate) pairs from White's point of view: exactly one of
the two is set. `mate` is signed, positive when White mates.

Brilliant has no Lichess equivalent, so it is defined here (see is_brilliant), and so are
excellent (a near-best move), miss (a chance let go, see is_miss) and forced (the only
legal move).
"""

import json
import math
from pathlib import Path

import chess
from torre import paths

# Shared with the web app (web/src/lib/grades.ts) through content/grading.json; test_grade_parity pins both.
GRADING = json.loads((paths.CONTENT / "grading.json").read_text(encoding="utf-8"))
WIN_CP_CEILING = GRADING["winCeilingCp"]
WIN_CHANCES_K = GRADING["winChancesK"]
ACCURACY = GRADING["accuracy"]
STANDARD_START_CP = 15  # Lichess prepends this eval for the initial position
INACCURACY, MISTAKE, BLUNDER = "inaccuracy", "mistake", "blunder"
CP_THRESHOLDS = tuple((threshold, label) for threshold, label in GRADING["judgments"])
MATE_LOSS_CP = GRADING["mateLossCp"]
STILL_DECIDED = GRADING["stillDecided"]
EXCELLENT_MAX_DROP = GRADING["excellentMaxDrop"]
MISS = GRADING["miss"]

PIECE_VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
                chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 100}


def forced_cp(cp, mate):
    """Centipawns with mate forced to the ceiling (Lichess's forceAsCp)."""
    if mate is not None:
        return WIN_CP_CEILING if mate > 0 else -WIN_CP_CEILING
    return max(-WIN_CP_CEILING, min(WIN_CP_CEILING, cp))


def winning_chances(cp, mate=None):
    """Winning chances on Lichess's -1..1 scale."""
    return 2 / (1 + math.exp(-WIN_CHANCES_K * forced_cp(cp, mate))) - 1


def win_pct(cp, mate=None):
    """White's win percentage, 0..100."""
    return 50 + 50 * winning_chances(cp, mate)


def move_accuracy(win_before, win_after):
    """Accuracy of one move from the mover's win% before and after it."""
    if win_after >= win_before:
        return 100.0
    raw = ACCURACY["scale"] * math.exp(-ACCURACY["decay"] * (win_before - win_after)) - ACCURACY["offset"]
    return max(0.0, min(100.0, raw + ACCURACY["bonus"]))


def _stdev(xs):
    mean = sum(xs) / len(xs)
    return math.sqrt(sum((x - mean) ** 2 for x in xs) / len(xs))


def _harmonic_mean(xs):
    if any(x <= 0 for x in xs):
        return 0.0
    return len(xs) / sum(1 / x for x in xs)


def game_accuracy(white_win_pcts, white_starts=True):
    """Lichess game accuracy per colour.

    `white_win_pcts` holds White's win% for the start position and after every
    ply. Returns {"white": float|None, "black": float|None}.
    """
    moves = len(white_win_pcts) - 1
    if moves < 1:
        return {"white": None, "black": None}
    size = max(2, min(8, moves // 10))
    first = white_win_pcts[:size]
    windows = [first] * (size - 2) + [white_win_pcts[i:i + size] for i in range(len(white_win_pcts) - size + 1)]
    weights = [max(0.5, min(12.0, _stdev(w))) for w in windows]

    per_color = {"white": [], "black": []}
    for i in range(moves):
        white_moved = (i % 2 == 0) == white_starts
        before, after = white_win_pcts[i], white_win_pcts[i + 1]
        if not white_moved:
            before, after = 100 - before, 100 - after
        per_color["white" if white_moved else "black"].append((move_accuracy(before, after), weights[i]))

    result = {}
    for color, pairs in per_color.items():
        if not pairs:
            result[color] = None
            continue
        weighted = sum(a * w for a, w in pairs) / sum(w for _, w in pairs)
        harmonic = _harmonic_mean([a for a, _ in pairs])
        result[color] = (weighted + harmonic) / 2
    return result


def chances_drop(before, after, mover_is_white):
    """How much the mover's winning chances (-1..1 scale) fell with the move, mates as the ceiling.
    `before` / `after` are White-POV (cp, mate) evals around the move."""
    sign = 1 if mover_is_white else -1
    def pov(ev):
        cp, mate = ev
        return forced_cp(None if cp is None else cp * sign, None if mate is None else mate * sign)
    return winning_chances(pov(before)) - winning_chances(pov(after))


def mover_win(ev, mover_is_white):
    """The mover's win% for a White-POV (cp, mate) eval."""
    win = win_pct(*ev)
    return win if mover_is_white else 100 - win


def judge(before, after, mover_is_white):
    """Judgment of one move, or None: Lichess's, with mistakes and blunders that leave the game
    as decided as it was capped at an inaccuracy (STILL_DECIDED).

    `before` / `after` are White-POV (cp, mate) evals around the move.
    """
    label = lichess_judge(before, after, mover_is_white)
    if label in (MISTAKE, BLUNDER):
        wins = mover_win(before, mover_is_white), mover_win(after, mover_is_white)
        if min(wins) >= STILL_DECIDED["winning"] or max(wins) <= STILL_DECIDED["lost"]:
            return INACCURACY
    return label


def lichess_judge(before, after, mover_is_white):
    """Lichess's judgment of one move, or None. `before` / `after` are White-POV (cp, mate) evals."""
    sign = 1 if mover_is_white else -1
    prev_cp, prev_mate = before
    next_cp, next_mate = after
    prev_mate = None if prev_mate is None else prev_mate * sign
    next_mate = None if next_mate is None else next_mate * sign
    prev_pov = forced_cp(None if prev_cp is None else prev_cp * sign, prev_mate)
    next_pov = forced_cp(None if next_cp is None else next_cp * sign, next_mate)

    # Lichess mate rules: walking into a forced mate, or letting one slip.
    if prev_mate is None and next_mate is not None and next_mate < 0:
        if prev_pov < -MATE_LOSS_CP[INACCURACY]:
            return INACCURACY
        if prev_pov < -MATE_LOSS_CP[MISTAKE]:
            return MISTAKE
        return BLUNDER
    if prev_mate is not None and prev_mate > 0 and (next_mate is None or next_mate < 0):
        if next_mate is None and next_pov > MATE_LOSS_CP[INACCURACY]:
            return INACCURACY
        if next_mate is None and next_pov > MATE_LOSS_CP[MISTAKE]:
            return MISTAKE
        return BLUNDER
    if prev_mate is not None or next_mate is not None:
        return None

    drop = chances_drop(before, after, mover_is_white)
    for threshold, label in CP_THRESHOLDS:
        if drop >= threshold:
            return label
    return None


MISSED_MATE_MAX = 5  # forced mates up to this long count as missed when let go
MATED_SCORE = 10000  # a cp score this large is a mate already on the board


def missed_mate(before, after, mover_is_white, longest=MISSED_MATE_MAX):
    """The mate in N (N <= `longest`) the mover had before the move, when the move let it go;
    None otherwise. `before` / `after` are White-POV (cp, mate) evals around the move.

    Lichess grades letting a mate go as at most an inaccuracy while the position stays won, so
    a skipped mate in 4 left no mark anywhere: no drill, no puzzle, nothing for the coach. This is
    the rule that catches it. A move that keeps a forced mate (even a longer one) is not a miss."""
    sign = 1 if mover_is_white else -1
    had = before[1] * sign if before[1] is not None else None
    if had is None or not 0 < had <= longest:
        return None
    # The move gave mate: stored as mate 0, or (analyze.py) as a decisive cp score for the mover.
    if after[1] == 0 or (after[1] is None and after[0] is not None and after[0] * sign >= MATED_SCORE):
        return None
    kept = after[1] * sign if after[1] is not None else None
    return had if kept is None or kept < 0 else None


def is_miss(earlier, before, after, mover_is_white):
    """A chance let go while the game stays playable: a forced mate let go (missed_mate), or the
    opponent's last move was judged an error, the mover stood at 70% or more and dropped an
    inaccuracy or a mistake. Falling below 45% keeps the move's own judgment.

    `earlier`, `before` and `after` are White-POV (cp, mate) evals before the opponent's last
    move, before this move and after it; `earlier` may be None (the first move)."""
    sign = 1 if mover_is_white else -1
    if after[1] == 0 or (after[1] is None and after[0] is not None and after[0] * sign >= MATED_SCORE):
        return False  # the move gave mate
    judgment = judge(before, after, mover_is_white)
    if judgment is None or mover_win(after, mover_is_white) < MISS["minAfter"]:
        return False
    if missed_mate(before, after, mover_is_white):
        return True
    return (judgment in MISS["replaces"] and earlier is not None
            and mover_win(before, mover_is_white) >= MISS["minBefore"]
            and judge(earlier, before, not mover_is_white) is not None)


def counts_as_error(move):
    """Moves the drills, puzzles and blind spots learn from: mistakes, blunders and misses."""
    return bool(move.get("miss")) or move.get("class") in (MISTAKE, BLUNDER)


def see(board, square):
    """Static exchange evaluation: material (pawn units) the side to move wins
    by starting a capture sequence on `square`, 0 if no capture pays.

    Uses legal moves at every step, so pins and king safety are respected,
    and each side always recaptures with its least valuable piece.
    """
    target = board.piece_at(square)
    if target is None:
        return 0
    captures = [m for m in board.legal_moves if m.to_square == square]
    if not captures:
        return 0
    move = min(captures, key=lambda m: PIECE_VALUES[board.piece_type_at(m.from_square)])
    gain = PIECE_VALUES[target.piece_type]
    if move.promotion:
        gain += PIECE_VALUES[move.promotion] - PIECE_VALUES[chess.PAWN]
    board.push(move)
    try:
        return max(0, gain - see(board, square))
    finally:
        board.pop()


def material_offered(board, move):
    """Material the mover puts up for grabs with `move`: the most the opponent
    can win by static exchange on any of the mover's pieces afterwards, net of
    what `move` itself captured. `board` is the position before the move."""
    taken = 0
    if board.is_en_passant(move):
        taken = PIECE_VALUES[chess.PAWN]
    elif board.piece_at(move.to_square):
        taken = PIECE_VALUES[board.piece_type_at(move.to_square)]
    mover = board.turn
    after = board.copy(stack=False)
    after.push(move)
    best = 0
    for square in chess.SquareSet(after.occupied_co[mover]):
        if after.piece_type_at(square) != chess.KING:
            best = max(best, see(after, square))
    return best - taken


# Brilliant thresholds (our definition; see is_brilliant).
BRILLIANT_MIN_OFFER = 2           # pawn units: at least an exchange / minor piece net
BRILLIANT_MAX_WIN_DROP = 2.0      # win% points: the sacrifice must be sound
BRILLIANT_MIN_WIN_AFTER = 50.0    # not a desperate sacrifice in a lost position
BRILLIANT_MAX_WIN_BEFORE = 90.0   # not a flourish in an already won position


def is_brilliant(board, move, win_before, win_after):
    """A sound sacrifice, found by static exchange evaluation.

    Brilliant if, after the move, the opponent could win at least two pawns of
    material by exchanges (net of anything the move captured), the mover's
    win% drops by at most two points (the engine agrees it's sound), the mover
    is not worse afterwards, and was not already completely winning.
    `win_before` / `win_after` are from the mover's point of view.
    """
    if win_before - win_after > BRILLIANT_MAX_WIN_DROP:
        return False
    if win_after < BRILLIANT_MIN_WIN_AFTER or win_before > BRILLIANT_MAX_WIN_BEFORE:
        return False
    return material_offered(board, move) >= BRILLIANT_MIN_OFFER


GRADES = ("brilliant", "great", "best", "excellent", "good", "book", "forced",
          "inaccuracy", "miss", "mistake", "blunder")


def grade(move):
    """One exclusive display/count category. Book provenance never hides an error."""
    if move.get("forced"):
        return "forced"
    if move.get("brilliant"):
        return "brilliant"
    if move.get("miss"):
        return "miss"
    if move.get("class"):
        return move["class"]
    if move.get("book"):
        return "book"
    if move.get("great"):
        return "great"
    if move.get("best"):
        return "best"
    if move.get("excellent"):
        return "excellent"
    return "good"


def verdict(board, result):
    """Normalize UI engine lines into White-POV scores; terminal results are exact."""
    outcome = board.outcome(claim_draw=True)
    if outcome:
        return {'cp': 0 if outcome.winner is None else (100_000 if outcome.winner else -100_000),
                'mate': None, 'best': None}
    lines = (result or {}).get('lines') or []
    if not lines:
        return None
    first = lines[0]
    out = {'cp': first['cp'], 'mate': first.get('mate'), 'best': result.get('best')}
    if len(lines) > 1:
        out['alternative'] = (lines[1]['cp'], lines[1].get('mate'))
    return out


def classify(board, move, before, after, earlier=None):
    """Shared grading for saved analysis, interactive review, Arena and exports.

    Great is our conservative definition: the engine's best move preserves winning
    chances >=70% where the runner-up has <=55%, or >=45% where the runner-up
    has <=30%. It must lose <=2 percentage points, and not be a forced legal move.
    Without a second engine line, Great is unknown and is never guessed.
    Excellent is a move other than the engine's that loses under 0.02 winning chances,
    miss is is_miss (`earlier` is the eval before the opponent's last move, if known), and
    forced is the only legal move: it is never judged and loses nothing.
    """
    if before is None or after is None:
        return None
    from torre.analysis import opening_book
    sign = 1 if board.turn else -1
    def chances(ev):
        value = win_pct(ev['cp'], ev.get('mate'))
        return value if sign == 1 else 100 - value
    prev, nxt = chances(before), chances(after)
    following = board.copy(stack=False)
    following.push(move)
    mating = following.is_checkmate()
    cls = None if mating else judge((before['cp'], before.get('mate')), (after['cp'], after.get('mate')), board.turn)
    best = mating or before.get('best') == move.uci()
    brilliant = not mating and cls is None and is_brilliant(board, move, prev, nxt)
    pair = lambda ev: (ev['cp'], ev.get('mate'))
    if board.legal_moves.count() == 1:
        return {'class': None, 'best': best, 'brilliant': False, 'great': False, 'book': False,
                'excellent': False, 'miss': False, 'forced': True, 'accuracy': 100.0}
    miss = not mating and is_miss(None if earlier is None else pair(earlier), pair(before), pair(after), board.turn)
    excellent = not best and cls is None and chances_drop(pair(before), pair(after), board.turn) < EXCELLENT_MAX_DROP
    alternative = before.get('alternative')
    great = False
    if best and cls is None and alternative is not None and board.legal_moves.count() > 1 and prev - nxt <= 2:
        runner = win_pct(*alternative)
        runner = runner if sign == 1 else 100 - runner
        great = (min(prev, nxt) >= 70 and runner <= 55) or (min(prev, nxt) >= 45 and runner <= 30)
    return {'class': cls, 'best': best, 'brilliant': brilliant, 'great': great,
            'book': not mating and opening_book.is_book_move(board, move),
            'excellent': excellent, 'miss': miss, 'forced': False, 'accuracy': round(move_accuracy(prev, nxt), 1)}


def key_moments(moves, limit=5):
    """The game's turning points for the player: every Brilliant, then the
    judged moves with the biggest win% drop, up to `limit`, in game order.

    `moves` are analyzed user moves with "ply", "class", "brilliant",
    "win_before" and "win_after" (mover's POV)."""
    brilliant = [m for m in moves if m.get("brilliant")]
    judged = sorted((m for m in moves if m.get("class")),
                    key=lambda m: m["win_after"] - m["win_before"])
    picked = (brilliant + judged)[:limit]
    return sorted(picked, key=lambda m: m["ply"])
