"""Opening trainer: your repertoire, drilled with the blunder drills' FSRS queue.

The repertoire comes from your own games. Every position in the first
MAX_PLIES plies where it is your move, reached in at least MIN_SEEN games,
becomes a card per color, answered with the move you play there most often.
When analysis judges that move a mistake or blunder (scoring.judge), the next
most frequent sound move is expected instead; if you never played a sound
one, the engine's choice is, and the card says it was corrected. Lines you
add yourself (state["lines"]) take precedence over the games.

A card is answered by playing the expected move: right is reviewed as Good,
anything else as Again (drills.review), so a missed position resurfaces soon
and a known one is pushed further out. Progress lives in openings.json next
to the analysis.
"""

import hashlib
import io
import json
import re
import threading
from collections import Counter

import chess
import chess.pgn

from torre.analysis import analyze
from torre.analysis import insights
from torre.learning import drills
from torre.analysis import scoring
MAX_PLIES = 12  # six moves each
MIN_SEEN = 2
MAX_CARDS = 80  # per color, most played first
NEW_PER_DAY = 10
MAX_LINE_PLIES = 40
LOCK = threading.Lock()
COLORS = ("white", "black")


def position_key(board):
    """A position independent of move counters, so transpositions share a card."""
    return " ".join(board.fen().split()[:4])


def _read(pgn):
    game = chess.pgn.read_game(io.StringIO(pgn or ""))  # a malformed game is skipped, like the insights do
    if game is None or game.errors or game.board().fen() != chess.STARTING_FEN:
        return None
    return game


def build_repertoire(games, analysis=None, max_plies=MAX_PLIES, min_seen=MIN_SEEN, max_cards=MAX_CARDS):
    """Repertoire cards by id from games.jsonl records; `analysis` maps game id to its record."""
    analysis = analysis or {}
    stats = {}
    for rec in games:
        color = rec.get("user_color")
        game = _read(rec.get("pgn")) if color in COLORS else None
        if game is None:
            continue
        found = analysis.get(rec.get("id"))
        current = found and found.get("scoring_version") == analyze.SCORING_VERSION
        evals = (found.get("evals") or []) if current else []
        engine = (found.get("best_moves") or []) if current else []
        eco = re.search(r'\[ECO "([^"]+)"\]', rec.get("pgn", ""))
        mine = chess.WHITE if color == "white" else chess.BLACK
        board, sans, last = game.board(), [], None
        for ply, move in enumerate(game.mainline_moves(), 1):
            if ply > max_plies:
                break
            if board.turn == mine:
                key = f"{color}:{position_key(board)}"
                s = stats.setdefault(key, {"color": color, "fen": board.fen(), "line": list(sans), "seen": 0,
                                           "moves": Counter(), "bad": Counter(), "sound": Counter(),
                                           "engine": Counter(), "ecos": Counter(), "next": {}})
                if last:  # how your previous move continues here, whatever the opponent answered
                    stats[last[0]]["next"].setdefault(last[1], set()).add(key)
                last = (key, move.uci())
                s["seen"] += 1
                s["moves"][move.uci()] += 1
                if eco:
                    s["ecos"][eco.group(1)] += 1
                if ply < len(evals) and evals[ply - 1] and evals[ply]:
                    judgment = scoring.judge(evals[ply - 1], evals[ply], mine == chess.WHITE)
                    s["bad" if judgment in (scoring.MISTAKE, scoring.BLUNDER) else "sound"][move.uci()] += 1
                if ply - 1 < len(engine) and engine[ply - 1]:
                    s["engine"][engine[ply - 1]] += 1
            sans.append(board.san(move))
            board.push(move)

    # Only positions your own expected moves lead to: after 1. d4 is your choice,
    # the odd 1. e4 game adds no cards for the lines that follow it.
    cards = {key: _games_card(key, s) for key, s in stats.items() if s["seen"] >= min_seen}
    todo = [k for k, s in stats.items() if len(s["line"]) == (0 if s["color"] == "white" else 1)]
    reachable = set()
    while todo:
        key = todo.pop()
        if key in reachable or not cards.get(key):
            continue
        reachable.add(key)
        todo.extend(stats[key]["next"].get(cards[key]["best"], ()))
    deck = {}
    for color in COLORS:
        mine = sorted((cards[k] for k in reachable if cards[k]["color"] == color),
                      key=lambda c: (-c["seen"], len(c["line"]), c["id"]))
        deck.update((card["id"], card) for card in mine[:max_cards])
    return deck


def _games_card(key, s):
    ranked = sorted(s["moves"].items(), key=lambda mc: (-mc[1], mc[0]))
    best = next((uci for uci, _ in ranked if s["bad"][uci] <= s["sound"][uci]), None)
    corrected = best is None
    if corrected:
        best = s["engine"].most_common(1)[0][0] if s["engine"] else None
    board = chess.Board(s["fen"])
    try:
        move = chess.Move.from_uci(best) if best else None
    except ValueError:
        move = None
    if move is None or move not in board.legal_moves:
        return None
    eco = s["ecos"].most_common(1)[0][0] if s["ecos"] else None
    return {"id": key, "source": "games", "color": s["color"], "fen": s["fen"], "line": s["line"],
            "best": best, "seen": s["seen"], "corrected": corrected,
            "played": [{"san": board.san(chess.Move.from_uci(uci)), "count": n} for uci, n in ranked[:3]],
            "opening": insights.eco_name(eco) if eco else None}


def load_state(path):
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}
    state.setdefault("cards", {})
    state.setdefault("introduced", {})
    state.setdefault("lines", [])
    return state


save_state = drills.save_state


def parse_line(text):
    """UCI moves for a line typed as SAN or UCI ("1. e4 e5 2. Nf3", "e2e4 e7e5")."""
    board, moves = chess.Board(), []
    for token in re.sub(r"\d+\.(\.\.)?", " ", str(text or "")).split():
        if token in ("*", "1-0", "0-1", "1/2-1/2"):
            continue
        try:
            move = board.parse_san(token)
        except ValueError:
            try:
                move = chess.Move.from_uci(token)
            except ValueError:
                move = None
            if move not in board.legal_moves:
                raise ValueError(f"{token} is not a legal move in this line.")
        moves.append(move.uci())
        board.push(move)
    if not moves:
        raise ValueError("Type the line's moves, for example 1. e4 e5 2. Nf3.")
    if len(moves) > MAX_LINE_PLIES:
        raise ValueError(f"A line can have at most {MAX_LINE_PLIES // 2} moves each.")
    return moves


def _sans(moves):
    board, sans = chess.Board(), []
    for uci in moves:
        move = chess.Move.from_uci(uci)
        sans.append(board.san(move))
        board.push(move)
    return sans


def add_line(state, color, text, now):
    """Add a line of your own for `color`; returns it. Every position on it where
    it is your move becomes a card answered with the line's move."""
    if color not in COLORS:
        raise ValueError('"color" must be white or black.')
    moves = parse_line(text)
    if len(moves) < (1 if color == "white" else 2):
        raise ValueError("This line has no move of yours to practice.")
    line_id = hashlib.sha1(f"{color}:{' '.join(moves)}".encode()).hexdigest()[:10]
    existing = next((line for line in state["lines"] if line["id"] == line_id), None)
    if existing:
        return existing
    line = {"id": line_id, "color": color, "moves": moves, "added": now.date().isoformat()}
    state["lines"].append(line)
    return line


def delete_line(state, line_id):
    before = len(state["lines"])
    state["lines"] = [line for line in state["lines"] if line["id"] != line_id]
    if len(state["lines"]) == before:
        raise ValueError("That line is not in your repertoire.")


def line_cards(line):
    mine = chess.WHITE if line["color"] == "white" else chess.BLACK
    board, sans, cards = chess.Board(), [], {}
    for uci in line["moves"]:
        move = chess.Move.from_uci(uci)
        if board.turn == mine:
            key = f"{line['color']}:{position_key(board)}"
            cards.setdefault(key, {"id": key, "source": "custom", "line_id": line["id"], "color": line["color"],
                                   "fen": board.fen(), "line": list(sans), "best": uci})
        sans.append(board.san(move))
        board.push(move)
    return cards


def full_deck(deck, state):
    """Your own lines first (they win over the games), then the games' cards."""
    full = {}
    for line in state["lines"]:
        for key, card in line_cards(line).items():
            full.setdefault(key, card)
    for key, card in deck.items():
        full.setdefault(key, card)
    return full


def line_view(line):
    sans = _sans(line["moves"])
    text = " ".join((f"{i // 2 + 1}. " if i % 2 == 0 else "") + san for i, san in enumerate(sans))
    return {"id": line["id"], "color": line["color"], "text": text, "added": line.get("added")}


def card_view(card):
    """What the board needs before the card is answered (no solution)."""
    return {k: card.get(k) for k in ("id", "source", "color", "fen", "line", "seen", "opening")}


def next_card(deck, state, now):
    info = drills.queue(deck, state, now, NEW_PER_DAY)
    queue = info.pop("_queue")
    colors = {c: sum(1 for card in deck.values() if card["color"] == c) for c in COLORS}
    return {**info, "colors": colors, "card": card_view(deck[queue[0]]) if queue else None,
            "lines": [line_view(line) for line in state["lines"]]}


def answer(deck, state, card_id, uci, now):
    """Grade a move for a repertoire card and reschedule it."""
    card = deck.get(card_id)
    if card is None:
        raise ValueError("This position is no longer in your repertoire.")
    board = chess.Board(card["fen"])
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        move = None
    if move not in board.legal_moves:
        raise ValueError("That move is not legal in this position.")
    best = chess.Move.from_uci(card["best"])
    correct = move == best
    fsrs_card, reviewed = drills.review(state, card_id, correct, now)
    return {"correct": correct, "san": board.san(move), "best": card["best"], "best_san": board.san(best),
            "source": card["source"], "seen": card.get("seen"), "played": card.get("played", []),
            "corrected": bool(card.get("corrected")), "reviewed": reviewed, "next_review": fsrs_card.due.isoformat()}
