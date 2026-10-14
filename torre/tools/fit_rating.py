"""Fit the game-rating curves (analysis/game_rating.py) on games whose players' ratings are known.

    python -m torre.tools.fit_rating                        # the archive in data/: print the fit
    python -m torre.tools.fit_rating --pgn lichess.pgn      # add games with [%eval] comments
    python -m torre.tools.fit_rating --pgn a.pgn --write    # and store it in content/grading.json

Two sources, each side of a game one sample (speed, accuracy, ACPL, rating):

  the archive    analysis.jsonl with games.jsonl: the ratings in each record or its PGN headers.
                 The opponent of a "computer" game is a site's bot, whose rating is a label, not
                 a strength, so only your side of those games counts. Games against Torre's bots
                 (played.jsonl) count when they were analysed: the bot's rating is the one it
                 was set to.
  --pgn files    games annotated with [%eval] (the Lichess database's analysed games), with
                 WhiteElo, BlackElo and TimeControl. --limit takes that many games, spread
                 evenly over the file.

Per speed it first finds the mix of accuracy and ACPL that tracks rating best (the direction
of the least-squares fit of rating on logit(accuracy) and ln(1 + ACPL)): the score
b * logit(accuracy) + c * ln(1 + ACPL). Then it fits the score players of each rating usually
reach, p + q * rating, which game_rating inverts. Regressing rating on one game directly would
pull every estimate to the pool's average; the inverse says at what rating this game is typical.
A speed with fewer than --min samples takes the fit of all games. It prints each fit with its
error (mean absolute and root mean square, by 5-fold cross-validation, next to always guessing
the mean), the spread of its estimates next to the ratings' own, and the median estimate of the
players in each rating band (each should land in its band), and the error on the archive alone
when PGN files are given, so it can be run again as the archive grows. One game is a noisy
measure: expect the error to be large next to the spread of the ratings.
"""
import argparse
import io
import json
import math
import re
from pathlib import Path

import chess
import chess.pgn

from torre import jsonio
from torre import paths
from torre.analysis import analyze
from torre.analysis import game_rating
from torre.analysis import scoring

GRADING_FILE = paths.CONTENT / "grading.json"
EVAL = re.compile(r"\[%eval\s+(#?)(-?[\d.]+)\]")
FOLDS = 5


def _sample(speed, stats, rating):
    if stats["accuracy"] is None or stats["moves"] < game_rating.RATING["minMoves"] or not rating:
        return None
    return {"speed": speed, "accuracy": stats["accuracy"], "acpl": stats["acpl"], "rating": rating}


def archive_samples(data_dir):
    """Samples from an archive's analysed games (see the module notes)."""
    data_dir = Path(data_dir)
    analysis = analyze.latest(data_dir / "analysis.jsonl")
    out = []
    for record in jsonio.read_jsonl(data_dir / "games.jsonl"):
        if not isinstance(record, dict) or record.get("id") not in analysis:
            continue
        from torre.analysis import game_moves
        parsed = game_moves.parse_game(record)
        evals = analysis[record["id"]].get("evals") or []
        if parsed is None or len(evals) != len(parsed["moves"]) + 1 or record.get("user_color") not in ("white", "black"):
            continue
        board, headers = parsed["board"], parsed["headers"]
        stats = game_rating.side_stats(evals, board.turn == chess.WHITE, board.fen() == chess.STARTING_FEN)
        speed = game_rating.speed_of(record.get("time_control") or headers.get("TimeControl"))
        user = record["user_color"]
        opp = "black" if user == "white" else "white"
        ratings = {user: record.get("user_rating"), opp: record.get("opp_rating")}
        for color, header in (("white", "WhiteElo"), ("black", "BlackElo")):
            ratings[color] = ratings.get(color) or headers.get(header)
        for color in (user,) if record.get("type") == "computer" else (user, opp):
            sample = _sample(speed, stats[color], game_rating.known_rating(ratings[color]))
            if sample:
                out.append(sample)
    for record in jsonio.read_jsonl(data_dir / "played.jsonl"):
        if not isinstance(record, dict) or record.get("id") not in analysis or record.get("user_color") not in ("white", "black"):
            continue
        evals = analysis[record["id"]].get("evals") or []
        board = chess.Board(record.get("initialFen") or chess.STARTING_FEN)
        if len(evals) != len(record.get("moves") or []) + 1:
            continue
        stats = game_rating.side_stats(evals, board.turn == chess.WHITE, board.fen() == chess.STARTING_FEN)
        bot = "black" if record["user_color"] == "white" else "white"
        sample = _sample(None, stats[bot], game_rating.known_rating(record.get("elo")))
        if sample:
            out.append(sample)
    return out


def _eval_of(node):
    found = EVAL.search(node.comment or "")
    if not found:
        board = node.board()
        if board.is_checkmate():
            return [-analyze.MATED_CP if board.turn == chess.WHITE else analyze.MATED_CP, None]
        return None
    if found[1]:
        return [None, int(found[2])]
    return [round(float(found[2]) * 100), None]


def pgn_samples(path, limit=None):
    """Samples from a PGN file of games annotated with [%eval] (see the module notes)."""
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    starts = [m.start() for m in re.finditer(r"^\[Event ", text, re.M)]
    if limit and len(starts) > limit:
        step = len(starts) / limit
        starts = [starts[int(i * step)] for i in range(limit)]
    out = []
    for start in starts:
        game = chess.pgn.read_game(io.StringIO(text[start:start + 20000]))
        if game is None or game.errors or game.board().fen() != chess.STARTING_FEN:
            continue
        evals = [[scoring.STANDARD_START_CP, None]]
        for node in game.mainline():
            ev = _eval_of(node)
            if ev is None:
                break
            evals.append(ev)
        else:
            stats = game_rating.side_stats(evals)
            speed = game_rating.speed_of(game.headers.get("TimeControl"))
            for color, header in (("white", "WhiteElo"), ("black", "BlackElo")):
                sample = _sample(speed, stats[color], game_rating.known_rating(game.headers.get(header)))
                if sample:
                    out.append(sample)
    return out


def _solve(rows, targets):
    """Least squares: the coefficients x minimizing |rows . x - targets|, by the normal equations."""
    n = len(rows[0])
    a = [[sum(r[i] * r[j] for r in rows) for j in range(n)] + [sum(r[i] * t for r, t in zip(rows, targets))] for i in range(n)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda k: abs(a[k][col]))
        a[col], a[pivot] = a[pivot], a[col]
        for k in range(n):
            if k != col and a[col][col]:
                factor = a[k][col] / a[col][col]
                a[k] = [x - factor * y for x, y in zip(a[k], a[col])]
    return [a[i][n] / a[i][i] for i in range(n)]


def fit(samples):
    """{"b", "c", "p", "q"} for these samples (see the module notes)."""
    _, b, c = _solve([[1.0, game_rating._logit(s["accuracy"]), math.log1p(s["acpl"])] for s in samples],
                     [s["rating"] for s in samples])
    # The direction that tracks rating best, kept monotone: more accuracy and less ACPL never read lower.
    b, c = max(0.0, b), min(0.0, c)
    if not b and not c:
        b = 1.0
    p, q = _solve([[1.0, s["rating"]] for s in samples], [game_rating.score(s["accuracy"], s["acpl"], {"b": b, "c": c}) for s in samples])
    return {"b": round(b, 3), "c": round(c, 3), "p": round(p, 4), "q": round(q, 7)}


def predict(curve, sample):
    return game_rating.curve(sample["accuracy"], sample["acpl"], curve)


def _report(gaps, ratings, estimates):
    sd = lambda xs: math.sqrt(sum((x - sum(xs) / len(xs)) ** 2 for x in xs) / len(xs))
    return (sum(abs(g) for g in gaps) / len(gaps), math.sqrt(sum(g * g for g in gaps) / len(gaps)),
            sd(estimates), sd(ratings))


def errors(curve, samples):
    """(MAE, RMSE, spread of the estimates, spread of the ratings) of `curve` on `samples`."""
    estimates = [predict(curve, s) for s in samples]
    ratings = [s["rating"] for s in samples]
    return _report([e - r for e, r in zip(estimates, ratings)], ratings, estimates)


def cross_validated(samples):
    """errors() of fitting on 4/5 of the samples and predicting the rest, over 5 folds."""
    estimates, ratings = [], []
    for fold in range(FOLDS):
        curve = fit([s for i, s in enumerate(samples) if i % FOLDS != fold])
        for s in samples[fold::FOLDS]:
            estimates.append(predict(curve, s))
            ratings.append(s["rating"])
    return _report([e - r for e, r in zip(estimates, ratings)], ratings, estimates)


def bands(curve, samples, width=200):
    """"rated 1400-1600: 1550" per band of `width` with 100 samples or more: the median estimate of
    the players rated in it. A sound curve puts each band's median inside the band."""
    out = []
    for low in range(0, 3400, width):
        estimates = sorted(predict(curve, s) for s in samples if low <= s["rating"] < low + width)
        if len(estimates) >= 100:
            out.append(f"{low}-{low + width}: {estimates[len(estimates) // 2]:.0f}")
    return ", ".join(out)


def fit_all(samples, minimum):
    """{speed: curve} for every speed and "unknown", with a report line per speed."""
    pooled = fit(samples)
    curves, lines = {}, []
    for speed in game_rating.SPEEDS:
        mine = [s for s in samples if s["speed"] == speed]
        enough = len(mine) >= minimum
        curves[speed] = fit(mine) if enough else pooled
        if mine:
            mean = sum(s["rating"] for s in mine) / len(mine)
            baseline = sum(abs(s["rating"] - mean) for s in mine) / len(mine)
            mae, rmse, spread, real = cross_validated(mine) if enough else errors(pooled, mine)
            lines.append(f"{speed:<10} {len(mine):>6} sides  MAE {mae:4.0f}  RMSE {rmse:4.0f}  spread {spread:4.0f} "
                         f"of {real:4.0f}  (guessing the mean: MAE {baseline:4.0f}){'' if enough else '  [all-games fit]'}")
            lines.append(f"{'':<10} median estimate by rating: {bands(curves[speed], mine)}")
        else:
            lines.append(f"{speed:<10}      0 sides  [all-games fit]")
    curves["unknown"] = curves[game_rating.RATING["unknown"]]
    return curves, lines


def write(curves, path=GRADING_FILE):
    """Store the curves in grading.json's gameRating, one line per speed."""
    text = path.read_text(encoding="utf-8")
    body = ",\n".join(f'      "{speed}": {json.dumps(curve)}' for speed, curve in curves.items())
    text, count = re.subn(r'("curves": \{\n).*?(\n    \})', lambda m: m[1] + body + m[2], text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit("grading.json has no gameRating curves block to replace.")
    json.loads(text)
    path.write_text(text, encoding="utf-8", newline="\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", default=str(paths.DATA), help="the archive folder (analysis.jsonl, games.jsonl)")
    parser.add_argument("--pgn", action="append", default=[], help="a PGN file with [%%eval] comments (repeatable)")
    parser.add_argument("--limit", type=int, default=30000, help="games taken from each PGN file")
    parser.add_argument("--min", type=int, default=500, help="samples a speed needs for its own curve")
    parser.add_argument("--write", action="store_true", help="store the fit in content/grading.json")
    args = parser.parse_args(argv)

    archive = archive_samples(args.data)
    samples = list(archive)
    for path in args.pgn:
        found = pgn_samples(path, args.limit)
        print(f"{path}: {len(found)} sides")
        samples += found
    print(f"archive: {len(archive)} sides")
    if len(samples) < 50:
        raise SystemExit("Too few games with known ratings to fit (50 sides at least).")
    curves, lines = fit_all(samples, args.min)
    print("\n".join(lines))
    if args.pgn and archive:
        estimates = [predict(curves[s["speed"] or "unknown"], s) for s in archive]
        mae, rmse, _, _ = _report([e - s["rating"] for e, s in zip(estimates, archive)], [s["rating"] for s in archive], estimates)
        print(f"archive alone, with the fitted curves: MAE {mae:.0f}  RMSE {rmse:.0f}")
    for speed, curve in curves.items():
        print(f"{speed:<10} {json.dumps(curve)}")
    if args.write:
        write(curves)
        print(f"Wrote {GRADING_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
