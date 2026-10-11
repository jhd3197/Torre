"""Game analytics over the analyzed archive: accuracy and ACPL by phase, error
heatmaps, move times, tilt and results breakdowns.

Reads:  data/games.jsonl, data/played.jsonl (studio bot games) and
        data/analysis.jsonl (analyze.py's per-game eval timeline)

`build_stats(games, analysis)` returns one JSON-serializable dict whose
`summary` lists the key weaknesses as plain facts (LLM coaching input);
`load_stats(data_dir)` reads the files and calls it.

Accuracy is Lichess's (formulas in scoring.py): win% = 50 + 50 * (2 / (1 +
exp(-0.00368208 * cp)) - 1); move accuracy = 103.1668 * exp(-0.04354 * win%
drop) - 3.1669 (+1 uncertainty bonus, clamped 0..100); the accuracy of a set
of moves is the mean of their volatility-weighted mean (std-dev of win% in
the sliding window around each move) and their harmonic mean. A phase's
accuracy keeps each move's weight from its own game's windows; accuracies
over several games are the mean of the per-game values, as Lichess Insights
does. ACPL uses the archive's capped centipawn loss (analyze.legacy_cp).

Phases are judged on the position before each move and never go back:
  endgame     at most 6 minor/major pieces left, or queens off with at most
              20 points of non-pawn material (N/B 3, R 5, Q 9)
  middlegame  past move 12, or at most 10 minor/major pieces left
  opening     otherwise
(analyze.phase_of, used by the stored phase_counts, splits by move number.)

Move times, in order of preference: Play's observed `timings` (ui_active,
partial turns dropped), PGN [%emt], deltas of PGN [%clk], deltas of
Chess.com move_timestamps (deciseconds left after each ply). Deltas add the
increment and need a "base" or "base+inc" TimeControl, like game_export.
"""

import json
import math
import re
from collections import defaultdict
from pathlib import Path
from statistics import mean

import chess

from torre.analysis import analyze
from torre import jsonio
from torre.analysis import motifs
from torre.analysis import scoring
from torre.analysis.game_moves import parse_game
from torre.analysis.insights import eco_name

win_pct, move_accuracy = scoring.win_pct, scoring.move_accuracy
PHASES = ("opening", "middlegame", "endgame")
ERRORS = (scoring.INACCURACY, scoring.MISTAKE, scoring.BLUNDER)
PHASE_METHOD = ("position before the move, never going back: endgame when <= 6 minor/major pieces remain "
                "or queens are off with <= 20 points of non-pawn material; middlegame after move 12 or "
                "when <= 10 minor/major pieces remain; opening otherwise")
MOVE_BUCKET, MOVE_BUCKET_LAST = 5, 60
THINK_BUCKETS = ((2, "<2s"), (5, "2-5s"), (10, "5-10s"), (30, "10-30s"), (60, "30-60s"), (math.inf, "60s+"))
CLOCK_BUCKETS = ("time_trouble", "low", "medium", "plenty")
TIME_TROUBLE_FRAC, TIME_TROUBLE_S = 0.10, 30
TIME_TROUBLE_RULE = "under 10% of the starting clock or under 30s before the move"
RATING_BUCKETS = ("much_lower", "lower", "similar", "higher", "much_higher")
SESSION_GAP_S = 45 * 60
TILT_MIN_STREAK, TILT_MIN_SAMPLE, TILT_SCORE_DROP = 2, 3, 10
MIN_OPENING_GAMES = 3


def _r(x, nd=1):
    return None if x is None else round(x, nd)


def _pct(part, whole):
    return round(100 * part / whole, 1) if whole else None


# ---- accuracy ----------------------------------------------------------------

def volatility_weights(win_pcts):
    """Lichess's per-ply weights: the std-dev of White's win% over the sliding
    window around each ply, clamped to 0.5..12. `win_pcts` has the start
    position and every ply; one weight per ply comes back."""
    moves = len(win_pcts) - 1
    if moves < 1:
        return []
    size = max(2, min(8, moves // 10))
    windows = [win_pcts[:size]] * (size - 2) + [win_pcts[i:i + size] for i in range(len(win_pcts) - size + 1)]
    return [max(0.5, min(12.0, scoring._stdev(w))) for w in windows]


def aggregate_accuracy(pairs):
    """Lichess accuracy of (move accuracy, weight) pairs: the mean of the
    weighted mean and the harmonic mean. None when there are no moves."""
    if not pairs:
        return None
    weighted = sum(a * w for a, w in pairs) / sum(w for _, w in pairs)
    return (weighted + scoring._harmonic_mean([a for a, _ in pairs])) / 2


def position_phase(board, previous=None):
    """Phase of `board` (see the module docstring); `previous` is the phase of
    the position before, so a game never goes back a phase."""
    pieces = [p.piece_type for p in board.piece_map().values() if p.piece_type not in (chess.PAWN, chess.KING)]
    material = sum(scoring.PIECE_VALUES[p] for p in pieces)
    if previous == "endgame" or len(pieces) <= 6 or (chess.QUEEN not in pieces and material <= 20):
        return "endgame"
    if previous == "middlegame" or board.fullmove_number > 12 or len(pieces) <= 10:
        return "middlegame"
    return "opening"


def line_phases(board):
    """The phase of every position in `board`'s game so far, from its root to now (one more than
    its moves), each never going back; the last is the phase the next move is played in."""
    replay = board.root()
    phases = [position_phase(replay)]
    for move in board.move_stack:
        replay.push(move)
        phases.append(position_phase(replay, phases[-1]))
    return phases


# ---- games -------------------------------------------------------------------

def parse_control(tc):
    """(base seconds, increment) for "base" / "base+inc", else (None, None)."""
    m = re.fullmatch(r"(\d+)(?:\+(\d+))?", tc or "")
    return (int(m[1]), int(m[2] or 0)) if m else (None, None)


def normalize_game(rec):
    """A games.jsonl record as is; a played.jsonl (studio) record mapped onto
    the same fields: score in `user_result`, bot as opponent."""
    if "pgn" in rec or "user_result" in rec:
        return rec
    result = rec.get("result")
    white = rec.get("user_color") == "white"
    score = {"1-0": 1 if white else 0, "0-1": 0 if white else 1, "1/2-1/2": 0.5}.get(result)
    return {**rec, "type": rec.get("type", "studio"), "user_result": score, "opponent": rec.get("bot_id"),
            "opp_rating": rec.get("elo"), "time_control": rec.get("time_control"),
            "end_time_unix": rec.get("end_time_unix")}


def move_times(parsed, rec):
    """Per ply {"elapsed_s", "clock_s" (left before the move), "start_s"
    (mover's starting clock), "source"}; unknown values are None."""
    base, inc = parse_control(rec.get("time_control") or parsed["headers"].get("TimeControl"))
    board = parsed["board"]
    standard = board.fen() == chess.STARTING_FEN
    prev = {c: base if standard and base is not None else None for c in chess.COLORS}
    start = {c: base for c in chess.COLORS}
    observed = {t.get("ply"): t for t in rec.get("timings") or [] if isinstance(t, dict)}
    turn, out = board.turn, []
    for ply, (clock, emt) in enumerate(zip(parsed["clocks"], parsed["emts"]), 1):
        elapsed, source = None, None
        if emt is not None and emt >= 0:
            elapsed, source = emt, "pgn_emt"
        elif base is not None and clock is not None and prev[turn] is not None and prev[turn] + inc - clock >= 0:
            elapsed, source = prev[turn] + inc - clock, "clock_delta"
        t = observed.get(ply)
        if t and not t.get("partial") and isinstance(t.get("elapsed_ms"), (int, float)) and t["elapsed_ms"] >= 0:
            elapsed, source = t["elapsed_ms"] / 1000, "ui_active"
        if start[turn] is None and clock is not None:
            start[turn] = clock + (elapsed or 0)
        out.append({"elapsed_s": _r(elapsed, 3), "clock_s": prev[turn] if prev[turn] is not None else clock,
                    "start_s": start[turn], "source": source})
        prev[turn] = clock
        turn = not turn
    return out


def game_moves(rec, analysis):
    """The user's analyzed moves in one game: ply, move number, phase, cpl,
    win% before/after (mover's POV), accuracy, Lichess weight, judgment and
    timing. [] when the analysis is missing or doesn't match the game."""
    parsed = parse_game(rec)
    evals = (analysis or {}).get("evals") or []
    if parsed is None or len(evals) != len(parsed["moves"]) + 1 or rec.get("user_color") not in ("white", "black"):
        return []
    board = parsed["board"].copy()
    win = [win_pct(*ev) for ev in evals]
    timeline = [win_pct(scoring.STANDARD_START_CP)] + win[1:] if board.fen() == chess.STARTING_FEN else win
    weights = volatility_weights(timeline)
    times = move_times(parsed, rec)
    user = chess.WHITE if rec["user_color"] == "white" else chess.BLACK
    out, phase = [], None
    for i, mv in enumerate(parsed["moves"]):
        phase = position_phase(board, phase)
        if board.turn == user:
            before, after = evals[i], evals[i + 1]
            wb, wa = (timeline[i], timeline[i + 1]) if user == chess.WHITE else (100 - timeline[i], 100 - timeline[i + 1])
            mates = after[0] is not None and abs(after[0]) >= analyze.MATED_CP
            t = times[i]
            frac = t["clock_s"] / t["start_s"] if t["clock_s"] is not None and t["start_s"] else None
            out.append({
                "ply": i + 1, "move_number": board.fullmove_number, "phase": phase,
                "cpl": max(0, analyze.legacy_cp(before, user) - analyze.legacy_cp(after, user)),
                "win_before": wb, "win_after": wa, "accuracy": move_accuracy(wb, wa), "weight": weights[i],
                "class": None if mates else scoring.judge(before, after, user == chess.WHITE),
                "elapsed_s": t["elapsed_s"], "clock_s": t["clock_s"], "clock_frac": frac, "time_source": t["source"],
            })
        board.push(mv)
    return out


# ---- breakdowns --------------------------------------------------------------

def rate_row(moves):
    """Move count, error counts, error / blunder rate (% of moves) and ACPL."""
    n = len(moves)
    row = {"moves": n, **{e: sum(m["class"] == e for m in moves) for e in ERRORS}}
    row["error_rate"] = _pct(sum(row[e] for e in ERRORS), n)
    row["blunder_rate"] = _pct(row[scoring.BLUNDER], n)
    row["acpl"] = _r(sum(m["cpl"] for m in moves) / n) if n else None
    return row


def phase_stats(games_moves):
    """Accuracy, ACPL and errors per phase over a list of per-game move lists,
    plus "overall". Accuracy is the mean of per-game Lichess accuracies."""
    out = {}
    for phase in PHASES + ("overall",):
        per_game = [[m for m in gm if phase == "overall" or m["phase"] == phase] for gm in games_moves]
        per_game = [gm for gm in per_game if gm]
        accs = [aggregate_accuracy([(m["accuracy"], m["weight"]) for m in gm]) for gm in per_game]
        row = rate_row([m for gm in per_game for m in gm])
        out[phase] = {"games": len(per_game), "accuracy": _r(mean(accs)) if accs else None, **row}
    return out


def move_bucket(move_number, size=MOVE_BUCKET, last=MOVE_BUCKET_LAST):
    if move_number > last:
        return f"{last + 1}+"
    lo = (move_number - 1) // size * size + 1
    return f"{lo}-{lo + size - 1}"


def error_heatmap(moves, size=MOVE_BUCKET, last=MOVE_BUCKET_LAST):
    """Inaccuracies / mistakes / blunders bucketed by move number (and the
    same counts per phase), each with its move count and rates."""
    labels = [move_bucket(lo, size, last) for lo in range(1, last + 1, size)] + [f"{last + 1}+"]
    groups = defaultdict(list)
    for m in moves:
        groups[move_bucket(m["move_number"], size, last)].append(m)
    by_move = [{"bucket": b, **rate_row(groups[b])} for b in labels if groups[b]]
    errs = [r for r in by_move if r["moves"] >= 10] or by_move
    peak = max(errs, key=lambda r: (r["error_rate"] or 0), default=None)
    return {"bucket_size": size, "by_move": by_move,
            "by_phase": {p: rate_row([m for m in moves if m["phase"] == p]) for p in PHASES},
            "peak": peak and peak["bucket"]}


def think_bucket(seconds):
    return next(label for bound, label in THINK_BUCKETS if seconds < bound)


def clock_bucket(clock_s, frac):
    """time_trouble (< 10% of the start or < 30s), low (< 25%), medium (< 50%), plenty."""
    if clock_s < TIME_TROUBLE_S or (frac is not None and frac < TIME_TROUBLE_FRAC):
        return "time_trouble"
    if frac is None:
        return None
    return "low" if frac < 0.25 else "medium" if frac < 0.5 else "plenty"


def time_stats(moves):
    """Error rates by think time and by clock left before the move, with the
    mean think time per judgment. Only moves with a known time count."""
    timed = [m for m in moves if m["elapsed_s"] is not None]
    clocked = [m for m in moves if m["clock_s"] is not None]
    by_think, by_clock = defaultdict(list), defaultdict(list)
    for m in timed:
        by_think[think_bucket(m["elapsed_s"])].append(m)
    for m in clocked:
        b = clock_bucket(m["clock_s"], m["clock_frac"])
        if b:
            by_clock[b].append(m)
    sources = defaultdict(int)
    for m in timed:
        sources[m["time_source"]] += 1
    think = {(c or "good"): [m["elapsed_s"] for m in timed if m["class"] == c] for c in (None,) + ERRORS}
    trouble = by_clock["time_trouble"]
    calm = [m for b in CLOCK_BUCKETS[1:] for m in by_clock[b]]
    return {"timed_moves": len(timed), "clocked_moves": len(clocked), "sources": dict(sources),
            "time_trouble_rule": TIME_TROUBLE_RULE,
            "by_think_time": [{"bucket": label, **rate_row(by_think[label])} for _, label in THINK_BUCKETS if by_think[label]],
            "by_clock": [{"bucket": b, **rate_row(by_clock[b])} for b in CLOCK_BUCKETS if by_clock[b]],
            "time_trouble": {"in": rate_row(trouble), "out": rate_row(calm)},
            "avg_think_s": {k: _r(mean(v)) if v else None for k, v in think.items()}}


def sessions(games, gap_s=SESSION_GAP_S):
    """Timestamped games (with "end_time_unix") grouped into sessions: same
    date and at most `gap_s` between consecutive end times."""
    timed = sorted((g for g in games if g.get("end_time_unix") is not None), key=lambda g: g["end_time_unix"])
    out = []
    for g in timed:
        last = out[-1][-1] if out else None
        if last and g["end_time_unix"] - last["end_time_unix"] <= gap_s and g.get("date") == last.get("date"):
            out[-1].append(g)
        else:
            out.append([g])
    return out


def tilt(games, gap_s=SESSION_GAP_S, min_streak=TILT_MIN_STREAK):
    """Loss streaks inside sessions, flagged as tilt when accuracy falls along
    the streak, plus how you score after k straight losses and a "take a
    break after N losses" recommendation. `games` need "id", "end_time_unix",
    "date", "score" (1 / 0.5 / 0) and "accuracy" (or None)."""
    sess = sessions([g for g in games if g.get("score") is not None], gap_s)
    after = defaultdict(list)
    flagged = []
    for s in sess:
        streaks, run = [], []
        for g in s:
            after[min(len(run), 3)].append(g["score"])
            if g["score"] == 0:
                run.append(g)
            else:
                streaks.append(run)
                run = []
        streaks.append(run)
        hits = []
        for run in (r for r in streaks if len(r) >= min_streak):
            accs = [g["accuracy"] for g in run if g.get("accuracy") is not None]
            if len(accs) >= 2 and accs[-1] < accs[0]:
                hits.append({"losses": len(run), "game_ids": [g["id"] for g in run],
                             "accuracies": [_r(a) for a in accs], "accuracy_drop": _r(accs[0] - accs[-1])})
        if hits:
            flagged.append({"date": s[0].get("date"), "start_unix": s[0]["end_time_unix"], "games": len(s),
                            "losses": sum(g["score"] == 0 for g in s), "streaks": hits})
    rows = [{"after_losses": k if k < 3 else "3+", "games": len(v), "score_pct": _pct(sum(v), len(v))}
            for k, v in sorted(after.items())]
    base = _pct(sum(after[0]), len(after[0]))
    n = next((r["after_losses"] for r in rows[1:] if r["games"] >= TILT_MIN_SAMPLE and base is not None
              and r["score_pct"] <= base - TILT_SCORE_DROP), None)
    if n is None and flagged:
        n = min(h["losses"] for f in flagged for h in f["streaks"])
    n = 3 if n == "3+" else n
    text = None
    if n is not None:
        row = next((r for r in rows if r["after_losses"] == (n if n < 3 else "3+")), None)
        losses = f"{n} loss{'es' if n > 1 else ''}"
        text = (f"Take a break after {losses} in a row: you score {row['score_pct']}% in games right after "
                f"{losses} in a row vs {base}% otherwise." if row and row["games"] >= TILT_MIN_SAMPLE else
                f"Take a break after {losses} in a row: your accuracy fell during loss streaks of that length.")
    return {"session_gap_min": gap_s // 60, "sessions": len(sess), "multi_game_sessions": sum(len(s) > 1 for s in sess),
            "flagged": flagged, "after_losses": rows,
            "recommendation": {"break_after_losses": n, "text": text}}


def wdl(scores):
    scores = [s for s in scores if s is not None]
    return {"games": len(scores), "wins": scores.count(1), "draws": scores.count(0.5), "losses": scores.count(0),
            "score_pct": _pct(sum(scores), len(scores))}


def time_class(tc):
    """Lichess speed from the TimeControl: estimated duration base + 40 * inc."""
    if tc and "/" in tc:
        return "daily"
    base, inc = parse_control(tc)
    if base is None:
        return "untimed"
    est = base + 40 * inc
    return "bullet" if est < 180 else "blitz" if est < 480 else "rapid" if est < 1500 else "classical"


def rating_bucket(diff):
    """Opponent minus user rating: much_lower < -200 <= lower < -50 <= similar <= 50 < higher <= 200 < much_higher."""
    return ("much_lower" if diff < -200 else "lower" if diff < -50 else "similar" if diff <= 50
            else "higher" if diff <= 200 else "much_higher")


def game_eco(rec):
    m = re.search(r'\[ECO "([^"]+)"\]', rec.get("pgn") or "")
    return rec.get("eco") or (m[1] if m and m[1] != "?" else None)


def performance(games):
    """Win / draw / loss by color, opening (ECO), time control, game type and
    opponent rating relative to yours. `games` are normalized records."""
    groups = {k: defaultdict(list) for k in ("by_color", "by_opening", "by_time_control", "by_type", "by_rating")}
    for g in games:
        s = g.get("user_result")
        groups["by_color"][g.get("user_color")].append(s)
        groups["by_time_control"][time_class(g.get("time_control"))].append(s)
        groups["by_type"][g.get("type") or "unknown"].append(s)
        if game_eco(g):
            groups["by_opening"][game_eco(g)].append(s)
        if isinstance(g.get("opp_rating"), (int, float)) and isinstance(g.get("user_rating"), (int, float)):
            groups["by_rating"][rating_bucket(g["opp_rating"] - g["user_rating"])].append(s)
    out = {"overall": wdl([g.get("user_result") for g in games])}
    for key, grp in groups.items():
        out[key] = {k: wdl(v) for k, v in grp.items() if k}
    out["by_opening"] = sorted(({"eco": eco, "name": eco_name(eco), **row} for eco, row in out["by_opening"].items()),
                               key=lambda r: (-r["games"], r["eco"]))
    out["by_rating"] = {b: out["by_rating"][b] for b in RATING_BUCKETS if b in out["by_rating"]}
    return out


# ---- summary -----------------------------------------------------------------

def summarize(stats):
    """Plain-fact sentences about the biggest weaknesses (and a few context
    facts) for a coaching prompt."""
    weak, facts = [], []
    ph = {p: stats["accuracy"][p] for p in PHASES if stats["accuracy"][p]["moves"] >= 10}
    ov = stats["accuracy"]["overall"]
    if ov["moves"]:
        facts.append(f"Analyzed {ov['games']} games ({ov['moves']} moves): accuracy {ov['accuracy']}, ACPL {ov['acpl']}, "
                     f"{ov['blunder_rate']}% of moves are blunders.")
    if len(ph) >= 2:
        low = min(ph, key=lambda p: ph[p]["accuracy"])
        others = ", ".join(f"{p} {ph[p]['accuracy']}" for p in ph if p != low)
        weak.append(f"Accuracy is lowest in the {low}: {ph[low]['accuracy']} (vs {others}).")
        worst = max(ph, key=lambda p: ph[p]["blunder_rate"] or 0)
        if ph[worst]["blunder_rate"]:
            weak.append(f"Blunders are most frequent in the {worst}: {ph[worst]['blunder_rate']}% of moves "
                        f"(ACPL {ph[worst]['acpl']}).")
    peak = next((r for r in stats["heatmap"]["by_move"] if r["bucket"] == stats["heatmap"]["peak"]), None)
    if peak and peak["error_rate"] and ov["error_rate"] and peak["error_rate"] > ov["error_rate"]:
        weak.append(f"Errors peak at moves {peak['bucket']}: {peak['error_rate']}% of moves there are inaccuracies "
                    f"or worse vs {ov['error_rate']}% overall.")
    tt = stats["time"]["time_trouble"]
    if tt["in"]["moves"] >= 10 and tt["out"]["moves"]:
        weak.append(f"In time trouble ({TIME_TROUBLE_RULE}) your blunder rate is {tt['in']['blunder_rate']}% "
                    f"vs {tt['out']['blunder_rate']}% with more time.")
    fast = [r for r in stats["time"]["by_think_time"] if r["bucket"] in ("<2s", "2-5s")]
    slow = [r for r in stats["time"]["by_think_time"] if r["bucket"] not in ("<2s", "2-5s")]
    nf, ns = sum(r["moves"] for r in fast), sum(r["moves"] for r in slow)
    if nf >= 10 and ns >= 10:
        bf, bs = _pct(sum(r["blunder"] for r in fast), nf), _pct(sum(r["blunder"] for r in slow), ns)
        (weak if bf > bs else facts).append(f"Moves played in under 5s are blunders {bf}% of the time vs {bs}% "
                                            f"for slower moves.")
    rec = stats["tilt"]["recommendation"]
    if rec["text"]:
        weak.append(rec["text"])
    if stats["tilt"]["flagged"]:
        facts.append(f"{len(stats['tilt']['flagged'])} session(s) had loss streaks with falling accuracy.")
    perf = stats["performance"]
    col = perf["by_color"]
    if col.get("white", {}).get("games") and col.get("black", {}).get("games"):
        w, b = col["white"]["score_pct"], col["black"]["score_pct"]
        (weak if abs(w - b) >= 10 else facts).append(f"Score {w}% as White ({col['white']['games']} games) vs {b}% "
                                                     f"as Black ({col['black']['games']} games).")
    ops = [o for o in perf["by_opening"] if o["games"] >= MIN_OPENING_GAMES]
    if len(ops) >= 2:
        lo, hi = min(ops, key=lambda o: o["score_pct"]), max(ops, key=lambda o: o["score_pct"])
        weak.append(f"Worst opening: {lo['name']} ({lo['eco']}), {lo['score_pct']}% over {lo['games']} games.")
        facts.append(f"Best opening: {hi['name']} ({hi['eco']}), {hi['score_pct']}% over {hi['games']} games.")
    for b in ("higher", "much_higher"):
        row = perf["by_rating"].get(b)
        if row and row["games"] >= 3:
            facts.append(f"Against {b.replace('_', ' ')}-rated opponents: {row['score_pct']}% over {row['games']} games.")
    return {"games": perf["overall"]["games"], "analyzed_games": ov["games"], "score_pct": perf["overall"]["score_pct"],
            "accuracy": ov["accuracy"], "acpl": ov["acpl"], "weaknesses": weak, "facts": facts}


# ---- entry points ------------------------------------------------------------

def build_stats(games, analysis):
    """All analytics for `games` (games.jsonl / played.jsonl records) and
    `analysis` (analysis.jsonl records, a list or a dict by id). JSON-ready."""
    games = [normalize_game(g) for g in games]
    by_id = {a["id"]: a for a in (analysis.values() if isinstance(analysis, dict) else analysis or [])}
    games_moves, per_game, sess_games = [], [], []
    for g in games:
        a = by_id.get(g.get("id"))
        moves = game_moves(g, a) if a else []
        acc = aggregate_accuracy([(m["accuracy"], m["weight"]) for m in moves])
        if moves:
            games_moves.append(moves)
            per_game.append({
                "id": g.get("id"), "date": g.get("date"), "color": g.get("user_color"), "result": g.get("user_result"),
                "opponent": g.get("opponent"), "accuracy": _r(acc), "acpl": rate_row(moves)["acpl"],
                "phases": {p: _r(aggregate_accuracy([(m["accuracy"], m["weight"]) for m in moves if m["phase"] == p]))
                           for p in PHASES},
                **{e: sum(m["class"] == e for m in moves) for e in ERRORS},
            })
        accuracy = (a or {}).get("accuracy") or (acc if moves else None) or g.get("user_accuracy")
        sess_games.append({"id": g.get("id"), "end_time_unix": g.get("end_time_unix"), "date": g.get("date"),
                           "score": g.get("user_result"), "accuracy": accuracy})
    flat = [m for gm in games_moves for m in gm]
    stats = {
        "version": 1, "phase_method": PHASE_METHOD,
        "counts": {"games": len(games), "analyzed": len(games_moves),
                   "timed_games": sum(any(m["elapsed_s"] is not None for m in gm) for gm in games_moves)},
        "accuracy": phase_stats(games_moves),
        "heatmap": error_heatmap(flat),
        "time": time_stats(flat),
        "tilt": tilt(sess_games),
        "performance": performance(games),
        "per_game": per_game,
        "motifs": motifs.build(games, by_id),
    }
    stats["summary"] = summarize(stats)
    return stats


def _jsonl(path):
    return jsonio.read_records(path)


def load_stats(data_dir="data"):
    """build_stats over data_dir's games.jsonl + played.jsonl and
    analysis.jsonl (current scoring version preferred, then latest)."""
    data_dir = Path(data_dir)
    analysis = {}
    for rec in _jsonl(data_dir / "analysis.jsonl"):
        if "id" not in rec:
            continue
        old = analysis.get(rec["id"])
        if old is None or rec.get("scoring_version") == analyze.SCORING_VERSION or old.get("scoring_version") != analyze.SCORING_VERSION:
            analysis[rec["id"]] = rec
    return build_stats(_jsonl(data_dir / "games.jsonl") + _jsonl(data_dir / "played.jsonl"), analysis)


if __name__ == "__main__":
    print(json.dumps(load_stats()["summary"], indent=2))
