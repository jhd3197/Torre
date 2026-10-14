"""Blunder drills: positions where you went wrong, scheduled with FSRS.

Each mistake or blunder in your analyzed games becomes a card: the position
before your move, to be answered with a better one. A move counts as solved
when it is the engine's choice, or when the engine judges it no worse than
an inaccuracy would be by the Lichess rules (see scoring.judge), so equally
good alternatives are accepted. Solved cards are reviewed as Good, missed
cards as Again; FSRS (the open scheduling algorithm Anki uses, via the MIT
`fsrs` package) decides when each comes back.

Completed lesson `play` steps join the same queue as review cards (see
add_lesson_card): they share the new-per-day cap and the scheduler, carry
`source: "lesson"` so the page can label them, and are answered with the
step's own line instead of an engine choice.

Progress lives in drills.json next to the analysis.
"""

import json
import threading
from datetime import datetime, timezone

import chess
from fsrs import Card, Rating, Scheduler

from torre.analysis import analyze
from torre.analysis import scoring
from torre import jsonio
NEW_PER_DAY = 10
MASTERED_DAYS = 21  # a card the scheduler would not show again for three weeks counts as fixed
SCHEDULER = Scheduler()
LOCK = threading.Lock()


def build_deck(analysis_records):
    """Cards by id from current analysis records, newest games first."""
    deck = {}
    records = sorted(analysis_records, key=lambda r: (r.get("date") or "", r["id"]), reverse=True)
    for rec in records:
        if rec.get("scoring_version") != analyze.SCORING_VERSION:
            continue
        for m in rec.get("worst_moves", []):
            if not scoring.counts_as_error(m):
                continue
            ply = m["ply"]
            best = rec["best_moves"][ply - 1] if ply - 1 < len(rec["best_moves"]) else None
            if not best:
                continue
            deck[f"{rec['id']}:{ply}"] = {
                "id": f"{rec['id']}:{ply}", "game_id": rec["id"], "ply": ply,
                "fen": m["fen"], "best": best, "played": m["san"], "class": m["class"],
                "move_number": m["move_number"], "opponent": rec.get("opponent"),
                "date": rec.get("date"), "eval_before": rec["evals"][ply - 1],
            }
    return deck


def missed_mate_cards(analysis_records, games_by_id):
    """Cards for the forced mates you let go (scoring.missed_mate), which the deck above misses:
    letting a mate go while still winning grades as an inaccuracy at most, and such a move is
    rarely among a game's worst. Each card asks for the mating move from the position before.
    `games_by_id` gives the game records, whose moves place the positions."""
    from torre.analysis import game_moves
    deck = {}
    for rec in analysis_records:
        if rec.get("scoring_version") != analyze.SCORING_VERSION or rec.get("user_color") not in ("white", "black"):
            continue
        evals, best = rec.get("evals") or [], rec.get("best_moves") or []
        game = games_by_id.get(rec["id"])
        parsed = game_moves.parse_game(game) if game else None
        if parsed is None or len(evals) != len(parsed["moves"]) + 1:
            continue
        user = chess.WHITE if rec["user_color"] == "white" else chess.BLACK
        board = parsed["board"].copy()
        for i, move in enumerate(parsed["moves"]):
            mate = None
            if board.turn == user and i < len(best) and best[i]:
                mate = scoring.missed_mate(evals[i], evals[i + 1], user == chess.WHITE)
            if mate:
                deck[f"{rec['id']}:{i + 1}"] = {
                    "id": f"{rec['id']}:{i + 1}", "game_id": rec["id"], "ply": i + 1, "fen": board.fen(), "best": best[i],
                    "played": board.san(move), "class": "inaccuracy", "mate": mate, "move_number": board.fullmove_number,
                    "opponent": rec.get("opponent"), "date": rec.get("date"), "eval_before": evals[i],
                }
            board.push(move)
    return deck


def load_state(path):
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}
    state.setdefault("cards", {})
    state.setdefault("introduced", {})
    state.setdefault("lesson_cards", {})
    return state


def save_state(path, state):
    jsonio.write_json(path, state, indent=1)


def _due(entry):
    return datetime.fromisoformat(entry["fsrs"]["due"])


def add_lesson_card(state, lesson, step, now):
    """Queue a lesson's `play` step as a review card; returns the card, None if known.

    The card asks for the step's first move; its stored line is the expected
    answer, so it carries no engine eval (answer() accepts the line's move, a
    listed alternative on a one-move line, any checkmate, or a move the engine
    rates as good as the line's, as lessons do).
    Keyed by lesson slug and step id, so only the first completion enqueues.
    """
    card_id = f"lesson:{lesson['slug']}/{step['id']}"
    if card_id in state["lesson_cards"]:
        return None
    card = {"id": card_id, "source": "lesson", "lesson": lesson["slug"], "lesson_title": lesson["title"],
            "step": step["id"], "fen": step["fen"], "best": step["moves"][0]["uci"],
            "alternatives": [a["uci"] for a in step.get("alternatives", [])] if len(step["moves"]) == 1 else [],
            "added": now.date().isoformat()}
    state["lesson_cards"][card_id] = card
    return card


def _full_deck(deck, state):
    """Game-mistake cards plus queued lesson reviews, lessons first."""
    return {**state.get("lesson_cards", {}), **deck}


def summary(deck, state, now):
    return queue(_full_deck(deck, state), state, now)


def queue(deck, state, now, new_per_day=NEW_PER_DAY):
    """Counts for a deck of cards by id and the order to show them: due
    reviews first (most overdue first), then up to the day's new cards in
    deck order. Shared by every deck scheduled here (see openings.py)."""
    today = now.date().isoformat()
    known = {cid: e for cid, e in state["cards"].items() if cid in deck}
    due = sorted((cid for cid, e in known.items() if _due(e) <= now), key=lambda cid: _due(known[cid]))
    new = [cid for cid in deck if cid not in known]
    new_left = max(0, new_per_day - state["introduced"].get(today, 0))
    upcoming = [_due(e) for cid, e in known.items() if _due(e) > now]
    return {
        "total": len(deck), "learned": len(known), "due": len(due),
        "mastered": sum(1 for e in known.values() if (e["fsrs"].get("stability") or 0) >= MASTERED_DAYS),
        "new": min(len(new), new_left), "new_total": len(new), "new_per_day": new_per_day,
        "next_due": min(upcoming).isoformat() if upcoming else None,
        "_queue": due + (new[:new_left]),
    }


def card_view(card):
    """What the board needs before the card is answered (no solution)."""
    if card.get("source") == "lesson":
        return {k: card[k] for k in ("id", "source", "lesson", "lesson_title", "step", "fen")}
    view = {k: card[k] for k in ("id", "game_id", "ply", "fen", "class", "move_number", "opponent", "date")}
    return {**view, "mate": card["mate"]} if card.get("mate") else view


def next_card(deck, state, now):
    """The next card to answer and the deck's counts; `lesson_due` counts the lesson positions
    in today's queue (the Lessons page offers them). Pass an empty `deck` for lesson cards only."""
    deck = _full_deck(deck, state)
    info = summary(deck, state, now)
    queue = info.pop("_queue")
    return {**info, "lesson_due": sum(1 for cid in queue if deck[cid].get("source") == "lesson"),
            "card": card_view(deck[queue[0]]) if queue else None}


def answer(deck, state, card_id, uci, evaluate, now):
    """Grade a move for a card and reschedule it.

    `evaluate(board)` returns the White-POV [cp, mate] of a position; it is
    only called when the move differs from the engine's choice. Lesson cards
    carry no eval: their stored line is the answer, so any other move that is
    not checkmate is a miss. "reviewed" is False when the card was answered
    ahead of schedule (a duplicate retry), so XP is paid once per review.
    """
    card = _full_deck(deck, state).get(card_id)
    if card is None:
        raise ValueError("This drill is no longer available. Its game may have been re-analyzed.")
    board = chess.Board(card["fen"])
    move = chess.Move.from_uci(uci)
    if move not in board.legal_moves:
        raise ValueError("That move is not legal in this position.")
    best = chess.Move.from_uci(card["best"])
    san, best_san = board.san(move), board.san(best)

    if move == best or uci in card.get("alternatives", []):
        correct, verdict = True, "best"
    else:
        after = board.copy(stack=False)
        after.push(move)
        if after.is_checkmate():
            correct, verdict = True, "mate"
        elif card.get("source") == "lesson":
            # The lesson's move is the yardstick: another move counts when the engine finds it
            # no worse than an inaccuracy next to it, as lessons accept equally good moves.
            expected = board.copy(stack=False)
            expected.push(best)
            judgment = scoring.judge(evaluate(expected), evaluate(after), board.turn == chess.WHITE)
            correct, verdict = judgment is None, judgment or "good"
        elif card.get("eval_before") is None:
            correct, verdict = False, "line"
        else:
            judgment = scoring.judge(card["eval_before"], evaluate(after), board.turn == chess.WHITE)
            correct, verdict = judgment is None, judgment or "good"

    fsrs_card, reviewed = review(state, card_id, correct, now)

    result = {"correct": correct, "verdict": verdict, "san": san, "best_san": best_san, "best": card["best"],
              "played": card.get("played"), "game_id": card.get("game_id"), "ply": card.get("ply"),
              "reviewed": reviewed, "next_review": fsrs_card.due.isoformat()}
    if card.get("source") == "lesson":
        result.update({k: card[k] for k in ("source", "lesson", "lesson_title", "step")})
    return result


def review(state, card_id, correct, now):
    """Reschedule a graded card: Good when correct, Again when missed.

    Returns the new FSRS card and whether this was a scheduled review (False
    when the card was answered again before it was due). A card seen for the
    first time counts toward the day's new cards.
    """
    entry = state["cards"].get(card_id)
    reviewed = entry is None or _due(entry) <= now
    if entry is None:
        today = now.date().isoformat()
        state["introduced"][today] = state["introduced"].get(today, 0) + 1
        entry = {"fsrs": Card().to_dict(), "reviews": 0, "lapses": 0}
    fsrs_card, _ = SCHEDULER.review_card(Card.from_dict(entry["fsrs"]), Rating.Good if correct else Rating.Again, now)
    entry["fsrs"] = fsrs_card.to_dict()
    entry["reviews"] += 1
    entry["lapses"] += 0 if correct else 1
    state["cards"][card_id] = entry
    return fsrs_card, reviewed


def now_utc():
    return datetime.now(timezone.utc)
