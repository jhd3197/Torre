"""Estimated game rating: how strongly each side played one game, in rating points.

One game says little about a player, so this is an estimate, rounded to 50 and refused when the
game is too short to mean anything. The constants live in content/grading.json ("gameRating");
torre/tools/fit_rating.py fits them on games whose players' ratings are known.

  curve     the score b * logit(accuracy) + c * ln(1 + ACPL), mapped to the rating at which
            players usually reach it: players rated R score p + q * R on average, so a game
            scoring z reads as (z - p) / q. One curve per speed (bullet, blitz, rapid,
            classical); a game without a time control (a bot game, a game read without one) uses
            the "unknown" speed's curve.
  anchored  when the game carries the player's rating R, the estimate starts there and moves by
            how far the game's score sits from the usual one at R, (z - p - q * R) / q, times a
            weight (one game is noisy), clamped to +/- the anchor's clamp.
  refused   (None) fewer than minMoves moves by that side, or a game shorter than minFullMoves
            moves that did not end on the board (a resignation, a flag, an abandoned game).

Accuracy is Lichess's (scoring.game_accuracy); ACPL is the average centipawn loss with scores
capped at +/-1000 as Lichess does (a mate counts as the cap). Evals are White-POV (cp, mate)
pairs, one per position.
"""
import math

import chess

from torre.analysis import game_stats
from torre.analysis import scoring

RATING = scoring.GRADING["gameRating"]
SPEEDS = ("bullet", "blitz", "rapid", "classical")


def speed_of(time_control):
    """bullet / blitz / rapid / classical from a PGN TimeControl ("600+5"), by the estimated
    game length base + 40 * increment; "-" and daily controls are classical; None when unknown."""
    if not time_control or time_control == "?":
        return None
    if time_control == "-" or "/" in time_control:
        return "classical"
    base, inc = game_stats.parse_control(time_control)
    if base is None:
        return None
    seconds = base + 40 * inc
    return next((name for limit, name in RATING["speeds"] if seconds < limit), "classical")


def side_stats(evals, white_starts=True, standard_start=True):
    """{"white": {"accuracy", "acpl", "moves"}, "black": {...}} from the evals of a whole game
    (len = plies + 1). A side that did not move has accuracy None."""
    win = [scoring.win_pct(*ev) for ev in evals]
    timeline = [scoring.win_pct(scoring.STANDARD_START_CP)] + win[1:] if standard_start else win
    accuracy = scoring.game_accuracy(timeline, white_starts=white_starts)
    losses = {"white": [], "black": []}
    for i in range(len(evals) - 1):
        white = (i % 2 == 0) == white_starts
        sign = 1 if white else -1
        loss = sign * (_capped(evals[i]) - _capped(evals[i + 1]))
        losses["white" if white else "black"].append(max(0, loss))
    return {color: {"accuracy": accuracy[color], "moves": len(losses[color]),
                    "acpl": sum(losses[color]) / len(losses[color]) if losses[color] else None}
            for color in ("white", "black")}


def _capped(ev):
    """White-POV centipawns capped at +/-1000, a mate (or a mated score) as the cap: a mate found a
    move late in a won game costs the cap at most, not the 2500 of the ACPL statistics."""
    cp, mate = ev
    if mate is None and cp is not None and abs(cp) >= scoring.MATED_SCORE:
        mate = 1 if cp > 0 else -1
    return scoring.forced_cp(cp, mate)


def _logit(accuracy):
    share = min(99.0, max(1.0, accuracy)) / 100
    return math.log(share / (1 - share))


def score(accuracy, acpl, fit):
    """One side's game as a single number: more accuracy and less ACPL score higher."""
    return fit["b"] * _logit(accuracy) + fit["c"] * math.log1p(acpl)


def curve(accuracy, acpl, fit):
    """The rating at which players usually play a game like this one (`fit`: one speed's curve)."""
    return (score(accuracy, acpl, fit) - fit["p"]) / fit["q"]


def anchored(accuracy, acpl, rating, fit):
    """`rating` moved by how far the game's score sits from the usual one at that rating."""
    anchor = RATING["anchor"]
    shift = anchor["weight"] * (score(accuracy, acpl, fit) - fit["p"] - fit["q"] * rating) / fit["q"]
    return rating + max(-anchor["clamp"], min(anchor["clamp"], shift))


def estimate(stats, speed, rating=None):
    """The rounded estimate for one side's stats (side_stats), or None when there are too few
    moves to judge. `rating` is the player's known rating, if any."""
    if not stats or stats["accuracy"] is None or stats["moves"] < RATING["minMoves"]:
        return None
    fit = RATING["curves"][speed or "unknown"]
    value = anchored(stats["accuracy"], stats["acpl"], rating, fit) if rating else curve(stats["accuracy"], stats["acpl"], fit)
    low, high = RATING["range"]
    step = RATING["round"]
    return int(round(max(low, min(high, value)) / step) * step)


def game_ratings(evals, board, moves, time_control=None, ratings=None):
    """{"white": int | None, "black": int | None, "speed": str | None} for the game played from
    `board` with `moves`, whose evals cover every ply. `ratings` holds the players' known ratings
    by colour (anything else, or a missing one, is no rating)."""
    ratings = ratings or {}
    end = board.copy(stack=False)
    for move in moves:
        end.push(move)
    speed = speed_of(time_control)
    full_moves = (len(moves) + (0 if board.turn == chess.WHITE else 1) + 1) // 2
    short = full_moves < RATING["minFullMoves"] and end.outcome() is None
    stats = side_stats(evals, board.turn == chess.WHITE, board.fen() == chess.STARTING_FEN)
    return {"speed": speed, **{color: None if short else estimate(stats[color], speed, known_rating(ratings.get(color)))
                               for color in ("white", "black")}}


def known_rating(value):
    """A positive whole rating, or None ("?", "", 0 and the like)."""
    try:
        value = int(value)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def for_game(record, analysis):
    """{"user", "opp", "speed"} estimates for an archived game (games.jsonl) and its analysis, or
    None when the analysis does not cover it. Known ratings come from the record, then the PGN
    headers; the opponent of a "computer" game is a site's bot, whose rating is only a label."""
    from torre.analysis import game_moves
    evals = (analysis or {}).get("evals") or []
    if record.get("user_color") not in ("white", "black"):
        return None
    parsed = game_moves.parse_game(record)
    if parsed is None or len(evals) != len(parsed["moves"]) + 1:
        return None
    headers = parsed["headers"]
    user, opp = record["user_color"], "black" if record["user_color"] == "white" else "white"
    known = {user: record.get("user_rating") or headers.get("WhiteElo" if user == "white" else "BlackElo"),
             opp: None if record.get("type") == "computer"
             else record.get("opp_rating") or headers.get("WhiteElo" if opp == "white" else "BlackElo")}
    result = game_ratings(evals, parsed["board"], parsed["moves"], record.get("time_control") or headers.get("TimeControl"), known)
    return {"user": result[user], "opp": result[opp], "speed": result["speed"]}
