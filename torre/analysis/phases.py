"""The phase of a position: opening, middlegame or endgame, by the material left.

Phases are judged on the position before each move and never go back:
  endgame     at most 6 minor/major pieces left, or queens off with at most
              20 points of non-pawn material (N/B 3, R 5, Q 9)
  middlegame  past move 12, or at most 10 minor/major pieces left
  opening     otherwise

Every phase split in Torre uses this: the stored analysis (analyze.py's phase_counts), the
review's phase card (bot_report.py), the statistics (game_stats.py) and the export.
"""
import chess

from torre.analysis import scoring

PHASES = ("opening", "middlegame", "endgame")


def position_phase(board, previous=None):
    """Phase of `board`; `previous` is the phase of the position before, so a game never goes
    back a phase."""
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
