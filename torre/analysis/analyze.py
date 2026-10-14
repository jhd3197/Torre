"""Analyze games with Stockfish: Lichess-style judgments and accuracy.

Reads:  data/games.jsonl
Writes: data/analysis.jsonl  (resume-safe; one record per game)

Moves are judged the way Lichess does it, by the drop in winning chances
(inaccuracy / mistake / blunder), and game accuracy uses Lichess's formula;
see scoring.py. Moves matching the engine's choice are tagged "best", and
sound sacrifices "brilliant". Centipawn loss (capped at +/-1500, mate beyond
the cap) is still recorded for the ACPL statistics.

Records from an older SCORING_VERSION are re-analyzed first. analyze_archive is
the whole pipeline (analysis, then puzzles mined from the new analyses) behind
`torre analyze` and the studio's background analysis.

Usage: .venv/Scripts/python analyze.py [--depth 12] [--limit N]  (the same as torre analyze)
"""

import io
import json
import logging
import sys
import threading
from pathlib import Path

import chess
import chess.engine
import chess.pgn

from torre.analysis import scoring
from torre.analysis import engines
from torre.analysis import limits
from torre.analysis import phases
from torre import jsonio
GAMES_FILE = Path("data/games.jsonl")
ANALYSIS_FILE = Path("data/analysis.jsonl")

# v3: shared eight-grade classification, opening provenance and runner-up evaluations.
# v4: excellent, miss and forced.
SCORING_VERSION = 4
EVAL_CAP = 1500
DEFAULT_DEPTH = 12
MATED_CP = 100_000  # stored cp for a checkmated side (White POV sign)
# Appends to analysis files and their compaction take turns (within this process).
ANALYSIS_LOCK = threading.Lock()
log = logging.getLogger(__name__)


def evaluate(engine, board: chess.Board, depth: int, alternatives=None):
    """White-POV [cp, mate] for `board`, plus the engine's best move (uci)."""
    if board.is_checkmate():
        if alternatives is not None:
            alternatives.append(None)
        return [-MATED_CP if board.turn == chess.WHITE else MATED_CP, None], None
    if board.is_stalemate() or board.is_insufficient_material():
        if alternatives is not None:
            alternatives.append(None)
        return [0, None], None
    infos = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=2)
    info = infos[0]
    if alternatives is not None:
        runner = infos[1]['score'].white() if len(infos) > 1 else None
        alternatives.append([runner.score(), runner.mate()] if runner is not None else None)
    score = info["score"].white()
    pv = info.get("pv") or []
    best = pv[0].uci() if pv else None
    if score.is_mate():
        return [None, score.mate()], best
    return [score.score(), None], best


def legacy_cp(ev, pov: chess.Color) -> int:
    """Capped centipawns from `pov`, mate beyond the cap (the ACPL scale)."""
    cp, mate = ev
    sign = 1 if pov == chess.WHITE else -1
    if mate is not None or abs(cp) >= MATED_CP:
        winning = (mate if mate is not None else cp) * sign > 0
        return (EVAL_CAP + 1000) if winning else -(EVAL_CAP + 1000)
    return max(-EVAL_CAP, min(EVAL_CAP, cp * sign))


def judge_ply(board: chess.Board, move: chess.Move, before, after):
    """(win_before, win_after, judgment, brilliant) for `move` played in
    `board`, from the mover's point of view. `before` / `after` are the stored
    White-POV evals around the move."""
    white = board.turn == chess.WHITE
    win_before, win_after = scoring.win_pct(*before), scoring.win_pct(*after)
    if not white:
        win_before, win_after = 100 - win_before, 100 - win_after
    if after[0] is not None and abs(after[0]) >= MATED_CP:  # the move gives checkmate
        return win_before, win_after, None, False
    cls = scoring.judge(before, after, white)
    brilliant = cls is None and scoring.is_brilliant(board, move, win_before, win_after)
    return win_before, win_after, cls, brilliant


def analyze_game(engine, rec: dict, depth: int) -> dict:
    game = chess.pgn.read_game(io.StringIO(rec["pgn"]))
    user_color = chess.WHITE if rec["user_color"] == "white" else chess.BLACK
    standard_start = game.board().fen() == chess.STARTING_FEN

    # Evaluate the start position and the position after every ply.
    moves = list(game.mainline_moves())
    board = game.board()
    evals, best_moves, alternatives = [], [], []
    for mv in moves:
        ev, best = evaluate(engine, board, depth, alternatives)
        evals.append(ev)
        best_moves.append(best)
        board.push(mv)
    final_ev, _ = evaluate(engine, board, depth)
    evals.append(final_ev)

    win = [scoring.win_pct(*ev) for ev in evals]
    acc_timeline = [scoring.win_pct(scoring.STANDARD_START_CP)] + win[1:] if standard_start else win
    accuracy = scoring.game_accuracy(acc_timeline, white_starts=game.board().turn == chess.WHITE)

    user_moves, all_grades = [], []
    board = game.board()
    phase = None
    for i, mv in enumerate(moves):
        mover = board.turn
        phase = phases.position_phase(board, phase)
        graded = scoring.classify(board, mv,
            {'cp': evals[i][0], 'mate': evals[i][1], 'best': best_moves[i], 'alternative': alternatives[i]},
            {'cp': evals[i + 1][0], 'mate': evals[i + 1][1]},
            {'cp': evals[i - 1][0], 'mate': evals[i - 1][1]} if i > 0 else None)
        all_grades.append(graded)
        if mover == user_color:
            win_before, win_after, cls, brilliant = judge_ply(board, mv, evals[i], evals[i + 1])
            before = legacy_cp(evals[i], mover)
            cpl = max(0, before - legacy_cp(evals[i + 1], mover))
            user_moves.append({
                "ply": i + 1,
                "move_number": board.fullmove_number,
                "san": board.san(mv),
                "fen": board.fen(),
                "phase": phase,
                "eval_before": before,
                "cpl": cpl,
                "win_before": round(win_before, 1),
                "win_after": round(win_after, 1),
                **graded,
            })
        board.push(mv)

    counts = {"inaccuracy": 0, "mistake": 0, "blunder": 0}
    for m in user_moves:
        if m["class"]:
            counts[m["class"]] += 1

    worst = sorted((m for m in user_moves if m["class"]), key=lambda m: m["win_after"] - m["win_before"])[:5]
    opp = "black" if user_color == chess.WHITE else "white"
    rounded = lambda x: None if x is None else round(x, 1)

    return {
        "id": rec["id"],
        "scoring_version": SCORING_VERSION,
        "move_grades": all_grades,
        "alternatives": alternatives,
        "grades": {name: sum(scoring.grade(m) == name for m in user_moves) for name in scoring.GRADES},
        "date": rec.get("date"),
        "type": rec.get("type"),
        "opponent": rec.get("opponent"),
        "user_color": rec["user_color"],
        "user_result": rec.get("user_result"),
        "user_accuracy": rec.get("user_accuracy"),
        "accuracy": rounded(accuracy[rec["user_color"]]),
        "opp_accuracy": rounded(accuracy[opp]),
        "opp_rating": rec.get("opp_rating"),
        "user_rating": rec.get("user_rating"),
        "user_move_count": len(user_moves),
        "avg_cpl": round(sum(m["cpl"] for m in user_moves) / max(1, len(user_moves)), 1),
        **counts,
        "best": sum(m["best"] for m in user_moves),
        "brilliant": sum(m["brilliant"] for m in user_moves),
        "phase_counts": {
            ph: {
                "moves": sum(1 for m in user_moves if m["phase"] == ph),
                "cpl": sum(m["cpl"] for m in user_moves if m["phase"] == ph),
                "blunders": sum(1 for m in user_moves if m["phase"] == ph and m["class"] == "blunder"),
                "mistakes": sum(1 for m in user_moves if m["phase"] == ph and m["class"] == "mistake"),
            }
            for ph in ("opening", "middlegame", "endgame")
        },
        "worst_moves": worst,
        "key_moments": scoring.key_moments(user_moves),
        "moves": [{k: m[k] for k in ("ply", "san", "class", "best", "brilliant", "great", "book",
                                         "excellent", "miss", "forced", "accuracy")} for m in user_moves],
        "evals": evals,
        "best_moves": best_moves,
    }


def review_moves(record):
    """Player moves with the same flags as the full grading timeline, when available."""
    timeline = record.get('move_grades') or []
    return [{**m, **(timeline[m['ply'] - 1] if 0 < m['ply'] <= len(timeline) else {})}
            for m in record.get('moves') or []]


def _latest(rows) -> dict:
    """One record per game id, preferring the current scoring version, then the latest written."""
    records = {}
    for rec in rows:
        if not isinstance(rec, dict) or "id" not in rec:
            continue
        gid = rec["id"]
        old = records.get(gid)
        if old is None or rec.get("scoring_version") == SCORING_VERSION or old.get("scoring_version") != SCORING_VERSION:
            records[gid] = rec
    return records


def latest(analysis_file: Path = ANALYSIS_FILE) -> dict:
    """The analysis records by game id (see _latest), without changing the file. Shared: read-only."""
    return jsonio.cached(Path(analysis_file), _latest_in)


def _latest_in(path):
    return _latest(jsonio.read_jsonl(path))


def compact(analysis_file: Path = ANALYSIS_FILE) -> dict:
    """Rewrite the analysis file with one record per game (see _latest), in one atomic step and
    never while this process appends to it. Returns the records by id."""
    analysis_file = Path(analysis_file)
    with ANALYSIS_LOCK:
        if not analysis_file.exists():
            return {}
        lines, rows = 0, []
        with analysis_file.open(encoding="utf-8") as f:
            for line in f:
                lines += 1
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        records = _latest(rows)
        if lines != len(records):
            try:
                jsonio.write_atomic(analysis_file, "".join(json.dumps(r) + "\n" for r in records.values()))
            except OSError:  # the file stays as it is: readers already skip the duplicates
                log.warning("Could not compact %s", analysis_file, exc_info=True)
    return records


def pending(games_file: Path = GAMES_FILE, analysis_file: Path = ANALYSIS_FILE):
    """Games still to analyze (outdated records first), and how many are current. Read-only:
    the analysis file is compacted by the analysis run, never here."""
    records = latest(analysis_file)
    done = {gid for gid, rec in records.items() if rec.get("scoring_version") == SCORING_VERSION}
    outdated = set(records) - done
    games = [rec for rec in jsonio.read_jsonl(Path(games_file))
             if isinstance(rec, dict) and "id" in rec and rec["id"] not in done]
    # Outdated records first, then the newest games: recent mistakes are the ones worth drilling.
    games.sort(key=lambda r: r.get("date") or "", reverse=True)
    games.sort(key=lambda r: r["id"] not in outdated)
    return games, len(done), len(outdated)


def run(games, engine_path, analysis_file: Path = ANALYSIS_FILE, depth=DEFAULT_DEPTH, threads=8,
        progress=None, should_stop=lambda: False):
    """Analyze `games`, appending each record as it finishes. `progress` is
    called as progress(index, game, result_or_None, error_or_None)."""
    engine = chess.engine.SimpleEngine.popen_uci(str(engine_path))
    engine.configure(limits.cap({"Threads": threads, "Hash": 512}))
    try:
        for i, rec in enumerate(games, 1):
            if should_stop():
                break
            try:
                result = analyze_game(engine, rec, depth)
            except Exception as e:  # one unreadable game must not stop the run
                if progress:
                    progress(i, rec, None, e)
                continue
            # Opened per record, so compact() can replace the file between two of them.
            with ANALYSIS_LOCK, Path(analysis_file).open("a", encoding="utf-8") as out:
                out.write(json.dumps(result) + "\n")
            if progress:
                progress(i, rec, result, None)
    finally:
        engine.quit()
        compact(analysis_file)


def analyze_archive(games, engine_path, games_file, analysis_file, pack_file, *, depth=DEFAULT_DEPTH, threads=8,
                    batch=None, mine=True, progress=None, mine_progress=None, on_mine=None, should_stop=lambda: False):
    """Analyze `games` (pending()'s list), then mine the new analyses into the "From your games"
    puzzles in `pack_file` (my_puzzles.py). Returns (pack, games mined), the pack being None
    when nothing was mined.

    With `batch`, mining follows every `batch` games, so a long run stopped halfway already feeds
    the puzzles and drills. Each engine takes up to `threads` from engines.POOL.budget.
    progress(index, game, result, error) follows each game and mine_progress (my_puzzles.run's)
    each mined one. on_mine('start', None) comes before each mining pass, then
    on_mine('done', (pack, mined)) or on_mine('failed', exc): a failed pass is then reported
    and the run goes on; without on_mine it is raised.
    """
    from torre.learning import my_puzzles  # it imports this module
    batch = batch or len(games) or 1
    pack, total = None, 0
    for start in range(0, max(len(games), 1), batch):
        chunk = games[start:start + batch]
        if chunk:
            with engines.POOL.budget.reserve(threads) as granted:
                run(chunk, engine_path, analysis_file, depth=depth, threads=granted, should_stop=should_stop,
                    progress=progress and (lambda i, *rest, at=start: progress(at + i, *rest)))
        if mine:
            if on_mine:
                on_mine('start', None)
            try:
                with engines.POOL.budget.reserve(threads) as granted:
                    pack, mined = my_puzzles.run(games_file, analysis_file, pack_file=pack_file, engine_path=engine_path,
                                                 threads=granted, progress=mine_progress)
            except Exception as exc:  # a failed mine never hides the analysis itself
                if not on_mine:
                    raise
                on_mine('failed', exc)
            else:
                total += mined
                if on_mine:
                    on_mine('done', (pack, mined))
        if should_stop():
            break
    return pack, total


def main(argv=None):
    from torre import cli as torre
    return torre.main(['analyze', *(sys.argv[1:] if argv is None else argv)])


if __name__ == "__main__":
    raise SystemExit(main())
