"""The Insights page's data (GET /api/insights).

Reads games.jsonl (all games: results, openings, recurring positions) and
analysis.jsonl (Stockfish per-move analysis, when present) in the data folder.
"""

import io
import logging
import re
from collections import Counter, defaultdict
from pathlib import Path

import chess
import chess.pgn

from torre.analysis import analyze
from torre import jsonio
from torre.analysis import scoring
from torre import paths
log = logging.getLogger(__name__)

ROOT = paths.REPO

GAME_URL = {
    "computer": "https://www.chess.com/game/computer/",
    "live": "https://www.chess.com/game/live/",
    "daily": "https://www.chess.com/game/daily/",
}

PIECES = {
    "K": "♔", "Q": "♕", "R": "♖", "B": "♗", "N": "♘", "P": "♙",
    "k": "♚", "q": "♛", "r": "♜", "b": "♝", "n": "♞", "p": "♟",
}

ECO_NAMES = {
    "A00": "Uncommon Openings", "A01": "Nimzo-Larsen Attack", "A03": "Bird's Opening",
    "A04": "Zukertort Opening", "A40": "Queen's Pawn Game", "A41": "Queen's Pawn: ...d6",
    "A45": "Indian / Trompowsky", "A80": "Dutch Defense",
    "B00": "King's Pawn: Uncommon", "B01": "Scandinavian Defense", "B07": "Pirc Defense",
    "B10": "Caro-Kann Defense", "B20": "Sicilian Defense", "B23": "Sicilian: Closed",
    "C00": "French Defense", "C20": "King's Pawn Game", "C25": "Vienna Game",
    "C30": "King's Gambit", "C40": "King's Knight Opening", "C41": "Philidor Defense",
    "C44": "King's Pawn: Two Knights", "C45": "Scotch Game", "C46": "Three Knights",
    "C50": "Italian Game", "C55": "Two Knights Defense", "C60": "Ruy Lopez",
    "C65": "Ruy Lopez: Berlin", "C70": "Ruy Lopez: Morphy",
    "D00": "Queen's Pawn Game", "D02": "London System", "D04": "Colle System",
    "D06": "Queen's Gambit", "D10": "Slav Defense", "D20": "Queen's Gambit Accepted",
    "D30": "Queen's Gambit Declined", "D35": "QGD: Exchange",
    "A10": "English Opening", "A20": "English Opening", "B06": "Modern Defense",
    "B12": "Caro-Kann: Advance", "B27": "Sicilian: Hyperaccelerated",
    "E00": "Queen's Pawn: Indian", "E10": "Indian: Misc", "E61": "King's Indian Defense",
    "A56": "Benoni Defense",
    "A46": "Queen's Pawn: Indian", "A48": "East Indian Defense", "A47": "Queen's Indian Defense",
}

# Codes without a name of their own get their ECO family's: (first code, last code, name), from the standard ECO volumes.
ECO_FAMILIES = [
    ("A02", "A03", "Bird's Opening"), ("A05", "A06", "Réti Opening"), ("A07", "A08", "King's Indian Attack"),
    ("A09", "A09", "Réti Opening"), ("A10", "A39", "English Opening"), ("A40", "A44", "Queen's Pawn Game"),
    ("A45", "A49", "Queen's Pawn: Indian"), ("A50", "A55", "Indian Defense"), ("A56", "A79", "Benoni Defense"),
    ("A80", "A99", "Dutch Defense"), ("B01", "B01", "Scandinavian Defense"), ("B02", "B05", "Alekhine's Defense"),
    ("B06", "B06", "Modern Defense"), ("B07", "B09", "Pirc Defense"), ("B10", "B19", "Caro-Kann Defense"),
    ("B20", "B99", "Sicilian Defense"), ("C00", "C19", "French Defense"), ("C21", "C22", "Center Game"),
    ("C23", "C24", "Bishop's Opening"), ("C25", "C29", "Vienna Game"), ("C30", "C39", "King's Gambit"),
    ("C40", "C40", "King's Knight Opening"), ("C41", "C41", "Philidor Defense"), ("C42", "C43", "Petrov's Defense"),
    ("C44", "C45", "Scotch Game"), ("C46", "C49", "Four Knights Game"), ("C50", "C54", "Italian Game"),
    ("C55", "C59", "Two Knights Defense"), ("C60", "C99", "Ruy Lopez"), ("D00", "D05", "Queen's Pawn Game"),
    ("D06", "D09", "Queen's Gambit"), ("D10", "D19", "Slav Defense"), ("D20", "D29", "Queen's Gambit Accepted"),
    ("D30", "D69", "Queen's Gambit Declined"), ("D70", "D99", "Grünfeld Defense"), ("E00", "E09", "Catalan Opening"),
    ("E10", "E11", "Indian Defense"), ("E12", "E19", "Queen's Indian Defense"), ("E20", "E59", "Nimzo-Indian Defense"),
    ("E60", "E99", "King's Indian Defense"),
]


LESSONS_DIR = paths.LESSONS
# The course for an opening the user plays, by a word in its name.
OPENING_COURSES = [("london", "london-setup"), ("colle", "colle-setup"), ("philidor", "philidor-setup")]


def lesson_or(*slugs: str) -> str:
    """The first of these lessons that is installed (the last one is the fallback)."""
    return next((s for s in slugs if (LESSONS_DIR / f"{s}.json").exists()), slugs[-1])


def eco_name(eco: str) -> str:
    """The opening's name from its ECO code: its own name if known, else its family's, else the code."""
    if eco in ECO_NAMES:
        return ECO_NAMES[eco]
    return next((name for first, last, name in ECO_FAMILIES if first <= eco <= last), eco)


def fen_to_grid(fen: str):
    rows = []
    for rank in fen.split(" ")[0].split("/"):
        row = []
        for ch in rank:
            if ch.isdigit():
                row.extend([""] * int(ch))
            else:
                row.append(PIECES.get(ch, ""))
        rows.append(row)
    return rows


def short_fen(board: chess.Board) -> str:
    return " ".join(board.fen().split(" ")[:4])


DEFAULT_USER = ""


def game_url(rec) -> str:
    gid = rec.get("id") or ""
    if rec.get("url"):
        return rec["url"]
    if gid.startswith("li-"):
        return "https://lichess.org/" + gid[3:]
    if gid.startswith("pgn-"):
        return ""
    return GAME_URL.get(rec.get("type"), "") + gid


def account_name(data_dir) -> str:
    """The name the insights greet: your chess.com (or Lichess) account from the import page."""
    accounts = jsonio.read_dict(Path(data_dir) / "settings.json").get("accounts")
    accounts = accounts if isinstance(accounts, dict) else {}
    return accounts.get("chesscom") or accounts.get("lichess") or DEFAULT_USER


def load_games(data_dir):
    return [r for r in jsonio.read_jsonl(Path(data_dir) / "games.jsonl") if isinstance(r, dict) and "id" in r]


def load_analysis(data_dir):
    """Analysis records by game id, each with its moves flagged from the full grading timeline (the
    last record of a game wins, as the file is appended to)."""
    return {r["id"]: {**r, "moves": analyze.review_moves(r)}
            for r in jsonio.read_jsonl(Path(data_dir) / "analysis.jsonl") if isinstance(r, dict) and "id" in r}


def parse_game(rec):
    """Parse a games.jsonl record -> dict with opening line, fens, result."""
    pgn = rec.get("pgn", "")
    eco = re.search(r'\[ECO "([^"]+)"\]', pgn)
    eco = eco.group(1) if eco else "?"
    game = chess.pgn.read_game(io.StringIO(pgn))  # a broken game is reported in game.errors, not raised
    if game is None or game.errors:
        return None
    board = game.board()
    sans = []
    probe_fens = {}
    for i, move in enumerate(game.mainline_moves(), 1):
        sans.append(board.san(move))
        board.push(move)
        if i in (6, 8, 10):
            probe_fens[i] = short_fen(board)
    return {
        "eco": eco,
        "line4": " ".join(sans[:4]),
        "probe_fens": probe_fens,
    }


def build_data(data_dir):
    games = load_games(data_dir)
    analysis = load_analysis(data_dir)
    if not games:
        log.info("no games yet — run the export + import first")
        return

    analyzed = [analysis[g["id"]] for g in games if g["id"] in analysis]

    # ---- overall record (ALL games) ----
    n_all = len(games)
    wins = sum(1 for g in games if g.get("user_result") == 1)
    draws = sum(1 for g in games if g.get("user_result") == 0.5)
    losses = n_all - wins - draws
    dates = sorted(g.get("date") or "" for g in games
                   if g.get("date") and not g["date"].startswith("1970"))

    # ---- analyzed aggregates ----
    n_an = len(analyzed)
    tot_moves = sum(r["user_move_count"] for r in analyzed)
    tot_bl = sum(r["blunder"] for r in analyzed)
    tot_mi = sum(r["mistake"] for r in analyzed)
    tot_in = sum(r["inaccuracy"] for r in analyzed)
    avg_cpl = round(sum(r["avg_cpl"] * r["user_move_count"] for r in analyzed) / max(1, tot_moves), 1) if analyzed else None
    # Our own accuracy (analyze.py, Lichess's formula) for every analyzed game; chess.com's only where ours is missing.
    def accuracy(r):
        return r.get("accuracy") if r.get("accuracy") is not None else r.get("user_accuracy")
    accs = [accuracy(r) for r in analyzed if accuracy(r) is not None]
    avg_acc = round(sum(accs) / len(accs), 1) if accs else None
    # Every analyzed move of yours by grade, brilliant to blunder (scoring.grade).
    grade_counts = Counter(scoring.grade(m) for r in analyzed for m in r.get("moves") or [])
    grades = {name: grade_counts.get(name, 0) for name in scoring.GRADES}
    grade_coverage = {'current': sum(len(r.get('moves') or []) for r in analyzed
                                    if r.get('scoring_version') == analyze.SCORING_VERSION),
                      'total': sum(grade_counts.values())}

    analyzed_sorted = sorted(analyzed, key=lambda r: r.get("date") or "")
    series = [{
        "date": r["date"], "acpl": r["avg_cpl"], "acc": accuracy(r),
        "blunders": r["blunder"], "result": r["user_result"], "opp": r["opponent"],
        "id": r["id"], "type": r["type"],
    } for r in analyzed_sorted]

    phases = []
    for ph in ("opening", "middlegame", "endgame"):
        mv = sum(r["phase_counts"][ph]["moves"] for r in analyzed)
        cpl = sum(r["phase_counts"][ph]["cpl"] for r in analyzed)
        phases.append({
            "phase": ph, "moves": mv,
            "acpl": round(cpl / mv, 1) if mv else 0,
            "mistakes": sum(r["phase_counts"][ph]["mistakes"] for r in analyzed),
            "blunders": sum(r["phase_counts"][ph]["blunders"] for r in analyzed),
        })

    colors = []
    for c in ("white", "black"):
        rs = [g for g in games if g.get("user_color") == c]
        an = [analysis[g["id"]] for g in rs if g["id"] in analysis]
        if rs:
            mv = sum(r["user_move_count"] for r in an)
            colors.append({
                "color": c, "games": len(rs),
                "winrate": round(100 * sum(1 for r in rs if r.get("user_result") == 1) / len(rs)),
                "acpl": round(sum(r["avg_cpl"] * r["user_move_count"] for r in an) / max(1, mv), 1) if an else None,
                "bl_per_game": round(sum(r["blunder"] for r in an) / len(an), 2) if an else None,
            })

    by_opp = defaultdict(list)
    for g in games:
        by_opp[g.get("opponent") or "?"].append(g)
    opponents = []
    for opp, rs in sorted(by_opp.items(), key=lambda kv: -len(kv[1]))[:14]:
        an = [analysis[g["id"]] for g in rs if g["id"] in analysis]
        mv = sum(r["user_move_count"] for r in an)
        opponents.append({
            "opp": opp, "games": len(rs),
            "w": sum(1 for r in rs if r.get("user_result") == 1),
            "d": sum(1 for r in rs if r.get("user_result") == 0.5),
            "l": sum(1 for r in rs if r.get("user_result") == 0),
            "acpl": round(sum(r["avg_cpl"] * r["user_move_count"] for r in an) / max(1, mv), 1) if an else None,
        })

    # ---- openings (ALL games + analysis merge) ----
    opening_groups = defaultdict(list)
    fen_counts = Counter()
    fen_sample = {}
    for g in games:
        p = parse_game(g)
        if not p:
            continue
        opening_groups[(p["eco"], g.get("user_color") or "?")].append((g, p))
        for ply, fen in p["probe_fens"].items():
            fen_counts[fen] += 1
            fen_sample.setdefault(fen, (g, p))

    openings = []
    for (eco, color), members in sorted(opening_groups.items(), key=lambda kv: -len(kv[1]))[:18]:
        gs = [m[0] for m in members]
        an = [analysis[g["id"]] for g in gs if g["id"] in analysis]
        mv = sum(r["user_move_count"] for r in an)
        line = Counter(p["line4"] for _, p in members).most_common(1)[0][0]
        # board after the modal line
        board = chess.Board()
        for tok in line.split():
            try:
                board.push_san(tok)
            except ValueError:
                break
        w = sum(1 for r in gs if r.get("user_result") == 1)
        d = sum(1 for r in gs if r.get("user_result") == 0.5)
        recent = sorted(gs, key=lambda r: r.get("date") or "", reverse=True)[:5]
        openings.append({
            "eco": eco, "name": eco_name(eco), "color": color, "line": line,
            "games": len(gs), "w": w, "d": d, "l": len(gs) - w - d,
            "winrate": round(100 * w / len(gs)),
            "acpl": round(sum(r["avg_cpl"] * r["user_move_count"] for r in an) / max(1, mv), 1) if an else None,
            "analyzed": len(an),
            "fen": short_fen(board),
            "recent": [{
                "id": r["id"], "type": r["type"], "date": r.get("date"),
                "opp": r.get("opponent"), "result": r.get("user_result"),
            } for r in recent],
        })

    # ---- recurring positions ----
    recurring = []
    for fen, cnt in fen_counts.most_common(60):
        if cnt < 4:
            break
        g, p = fen_sample[fen]
        recurring.append({
            "fen": fen, "count": cnt,
            "board": fen_to_grid(fen),
            "eco": p["eco"], "name": eco_name(p["eco"]),
            "line": p["line4"],
            "url": game_url(g),
        })
        if len(recurring) >= 4:
            break

    # ---- biggest blunders ----
    worst = []
    for r in analyzed:
        for m in r.get("worst_moves", []):
            worst.append((m["cpl"], r, m))
    worst.sort(key=lambda x: -x[0])
    worst_blunders = [{
        "id": r["id"], "type": r["type"], "ply": m["ply"], "fen": m["fen"],
        "cpl": cpl, "class": m.get("class"), "date": r["date"], "opp": r["opponent"], "san": m["san"],
        "move_number": m["move_number"], "eval_before": m["eval_before"],
        "board": fen_to_grid(m["fen"]),
        "url": game_url(r),
    } for cpl, r, m in worst[:12]]

    # ---- learning concepts (rule-based on YOUR data) ----
    concepts = []
    ph_by_name = {p["phase"]: p for p in phases}
    eg = ph_by_name.get("endgame", {})

    if analyzed:
        worst_phase = max(phases, key=lambda p: p["acpl"])
        if worst_phase["phase"] == "middlegame" and worst_phase["acpl"] > 60:
            concepts.append({
                "tag": "tactics", "title": "Middlegame calculation", "lesson": lesson_or("hanging-pieces", "knight-fork"),
                "evidence": f"ACPL {worst_phase['acpl']} in middlegames — {worst_phase['blunders']} blunders across {worst_phase['moves']} moves. Your biggest leak by far.",
                "text": "Most of your lost points come after the opening: loose pieces and missed tactics. Slow down on every move where material is en prise — run a 10-second 'checks, captures, threats' scan before committing.",
                "links": [
                    {"label": "Lichess tactics trainer", "url": "https://lichess.org/training"},
                    {"label": "Lichess practice: intermediate tactics", "url": "https://lichess.org/practice"},
                    {"label": "YouTube: how to calculate in the middlegame", "url": "https://www.youtube.com/results?search_query=chess+middlegame+calculation+training"},
                ],
            })
        if eg.get("blunders", 0) / max(1, n_an) > 0.2:
            concepts.append({
                "tag": "endgame", "title": "Endgame technique", "lesson": lesson_or("square-of-the-pawn", "opposition"),
                "evidence": f"{eg.get('blunders', 0)} endgame blunders — ACPL {eg.get('acpl', 0)} when the board clears.",
                "text": "You're reaching endgames but giving points back there. King activity and pawn races decide most club-level endgames — learn the opposition and the rule of the square first.",
                "links": [
                    {"label": "Lichess practice: endgames", "url": "https://lichess.org/practice"},
                    {"label": "YouTube: endgame principles for beginners", "url": "https://www.youtube.com/results?search_query=chess+endgame+principles+beginner"},
                ],
            })

    # weakest opening with a real sample size
    cand = [o for o in openings if o["games"] >= 5]
    if cand:
        worst_op = min(cand, key=lambda o: o["winrate"])
        fen_url = "https://lichess.org/analysis/standard/" + worst_op["fen"].replace(" ", "_")
        op_label = worst_op["name"] if worst_op["name"] != worst_op["eco"] else f"ECO {worst_op['eco']} lines"
        concepts.append({
            "tag": "openings", "title": f"Your {op_label}",
            "lesson": lesson_or(*[c for w, c in OPENING_COURSES if w in worst_op["name"].lower()], "opening-principles"),
            "evidence": f"{worst_op['games']} games ({worst_op['eco']}), {worst_op['winrate']}% win rate as {worst_op['color']}"
                        + (f", ACPL {worst_op['acpl']}" if worst_op["acpl"] else "") + ". Your most-played line: " + worst_op["line"],
            "text": "This is your most recurring battlefield, so the masters have a LOT to say about it. Study the plans, not the moves: where the pieces belong, which pawn breaks matter, and what the typical middlegame looks like.",
            "fen": worst_op["fen"], "board": fen_to_grid(worst_op["fen"]),
            "links": [
                {"label": "Master games in this exact position (Lichess explorer)", "url": fen_url},
                {"label": f"YouTube: {worst_op['name']} explained", "url": "https://www.youtube.com/results?search_query=" + re.sub(r"[^A-Za-z0-9 ]", "", worst_op["name"]).replace(" ", "+") + "+chess+opening+explained"},
                {"label": f"chess.com openings: {worst_op['name']}", "url": "https://www.chess.com/openings/" + re.sub(r"[^A-Za-z0-9]+", "-", worst_op["name"]).strip("-")},
            ],
        })

    if recurring:
        top = recurring[0]
        fen_url = "https://lichess.org/analysis/standard/" + top["fen"].replace(" ", "_")
        concepts.append({
            "tag": "patterns", "title": "The position you play most",
            "evidence": f"You've had this exact position {top['count']} times ({top['name']}, line: {top['line']}).",
            "text": "When a position keeps coming back, it's worth seeing how masters handle it. Open the explorer on this exact position — the database shows every master game that reached it and which moves score best.",
            "fen": top["fen"], "board": top["board"],
            "links": [
                {"label": "This position in the master database", "url": fen_url},
                {"label": "Replay a game that reached it", "url": top["url"]},
            ],
        })

    data = {
        "user": account_name(data_dir),
        "coverage": {"analyzed": n_an, "total": n_all},
        "games": n_all, "wins": wins, "draws": draws, "losses": losses,
        "moves": tot_moves, "avgCpl": avg_cpl, "avgAcc": avg_acc, "grades": grades, "gradeCoverage": grade_coverage,
        "totalBlunders": tot_bl, "mistakes": tot_mi, "inaccuracies": tot_in,
        "blPerGame": round(tot_bl / n_an, 2) if n_an else None,
        "series": series, "phases": phases, "opponents": opponents,
        "colors": colors, "openings": openings, "recurring": recurring,
        "worstBlunders": worst_blunders, "concepts": concepts,
        "dateRange": [dates[0] if dates else "?", dates[-1] if dates else "?"],
    }

    return data
