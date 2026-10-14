"""Annotated PGN export, in the format Lichess and chess.com read.

Every move gets the engine evaluation of the position after it as a
standard [%eval] comment (pawns, or #N for mate). Judged moves get the
standard NAGs (?! $6, ? $2, ?? $4, !! $3, the only move $7), a short comment in
Lichess's wording, and the engine's move as a variation. Existing comments such as
[%clk] are kept.
"""

import io
import re

import chess
import chess.engine
import chess.pgn

from torre.analysis import analyze
from torre.analysis import scoring
NAGS = {"inaccuracy": chess.pgn.NAG_DUBIOUS_MOVE, "mistake": chess.pgn.NAG_MISTAKE,
        "blunder": chess.pgn.NAG_BLUNDER}
LABELS = {"inaccuracy": "Inaccuracy", "mistake": "Mistake", "blunder": "Blunder", "miss": "Missed chance"}


def pov_score(ev):
    """Stored White-POV [cp, mate] as a python-chess score, None for checkmate."""
    cp, mate = ev
    if mate is not None:
        return chess.engine.PovScore(chess.engine.Mate(mate), chess.WHITE)
    if abs(cp) >= analyze.MATED_CP:
        return None
    return chess.engine.PovScore(chess.engine.Cp(cp), chess.WHITE)


def annotated_pgn(pgn_text, analysis):
    """The game's PGN with analysis annotations. Without a current analysis
    (no eval timeline) the game is exported as it is."""
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        raise ValueError("Could not read this game's PGN.")
    evals = (analysis or {}).get("evals")
    best_moves = (analysis or {}).get("best_moves") or []
    alternatives = (analysis or {}).get('alternatives') or []
    nodes = list(game.mainline())
    if evals and len(evals) == len(nodes) + 1:
        game.headers["Annotator"] = "Torre (Stockfish)"
        for i, node in enumerate(nodes):
            board = node.parent.board()
            move = node.move
            score = pov_score(evals[i + 1])
            if score is not None:
                node.set_eval(score)
            graded = scoring.classify(board, move,
                {'cp': evals[i][0], 'mate': evals[i][1], 'best': best_moves[i] if i < len(best_moves) else None,
                 'alternative': alternatives[i] if i < len(alternatives) else None},
                {'cp': evals[i + 1][0], 'mate': evals[i + 1][1]},
                {'cp': evals[i - 1][0], 'mate': evals[i - 1][1]} if i > 0 else None)
            cls, name = graded['class'], scoring.grade(graded)
            if name == 'brilliant':
                node.nags.add(chess.pgn.NAG_BRILLIANT_MOVE)
                node.comment = (node.comment + " Brilliant move.").strip()
            elif name == 'great':
                node.nags.add(chess.pgn.NAG_GOOD_MOVE)
                node.comment = (node.comment + " Great move.").strip()
            elif name == 'forced':
                node.nags.add(chess.pgn.NAG_FORCED_MOVE)
                node.comment = (node.comment + " Only move.").strip()
            elif not cls:
                node.comment = (node.comment + f" {name.capitalize()} move.").strip()
            if not cls:
                continue
            node.nags.add(NAGS[cls])
            label = LABELS['miss' if name == 'miss' else cls]
            best = best_moves[i] if i < len(best_moves) else None
            best_move = chess.Move.from_uci(best) if best else None
            if best_move and best_move != move and best_move in board.legal_moves:
                node.comment = (node.comment + f" {label}. {board.san(best_move)} was best.").strip()
                node.parent.add_variation(best_move)
            else:
                node.comment = (node.comment + f" {label}.").strip()
    return str(game) + "\n"


def filename(headers):
    """A safe download name such as 2026.09.05-jhd3197-vs-Duke-BOT.pgn."""
    parts = [headers.get("Date", ""), headers.get("White", "White"), "vs", headers.get("Black", "Black")]
    name = "-".join(p for p in parts if p and p != "????.??.??")
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:120] + ".pgn"
