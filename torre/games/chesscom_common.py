"""chess.com helpers for the importer: moveList decoding and the day a game was played.

The moveList decoding algorithm is ported from
github.com/andyruwruw/chess-web-api (src/endpoints/games.js).
"""

from datetime import datetime, timezone

import chess
import chess.pgn

# --- moveList decoding -------------------------------------------------------

BOARD_POSITIONS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?"
BOARD_FILES = "abcdefgh"
PROMOTION_TABLE = "#@$_[]^()~{}"
PROMOTION_PIECES = "brnq"


def _decode_square(ch: str):
    idx = BOARD_POSITIONS.find(ch)
    if idx == -1:
        return None
    return BOARD_FILES[idx % 8] + str(idx // 8 + 1)


def decode_move_list(move_list: str):
    """Decode chess.com moveList into a list of (from_sq, to_sq, promotion)."""
    if not move_list or len(move_list) % 2 != 0:
        raise ValueError(f"Malformed moveList (len={len(move_list)})")
    moves = []
    for i in range(0, len(move_list), 2):
        frm = _decode_square(move_list[i])
        if frm is None:
            raise ValueError(f"Bad from-char: {move_list[i]!r}")
        to = _decode_square(move_list[i + 1])
        promo = None
        if to is None:
            pidx = PROMOTION_TABLE.find(move_list[i + 1])
            if pidx == -1:
                raise ValueError(f"Bad to-char: {move_list[i + 1]!r}")
            promo = PROMOTION_PIECES[pidx // 3]
            kind = pidx % 3  # 0 = quiet, 1 = capture left, 2 = capture right
            file_idx = BOARD_FILES.find(frm[0])
            if kind == 1:
                file_idx -= 1
            elif kind == 2:
                file_idx += 1
            if not 0 <= file_idx <= 7 or frm[1] not in "27":
                raise ValueError(f"Bad promotion from {frm}")
            to = BOARD_FILES[file_idx] + ("1" if frm[1] == "2" else "8")
        moves.append((frm, to, promo))
    return moves


def build_pgn(pgn_headers: dict, move_list: str) -> str:
    """Replay decoded moves and return a standard PGN string."""
    game = chess.pgn.Game()
    for k, v in pgn_headers.items():
        if k != "FEN":
            game.headers[k] = str(v)
    board = chess.Board(pgn_headers["FEN"]) if "FEN" in pgn_headers else chess.Board()
    node = game
    for frm, to, promo in decode_move_list(move_list):
        uci = frm + to + (promo or "")
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            raise ValueError(f"Illegal move {uci} in position {board.fen()}")
        node = node.add_variation(move)
        board.push(move)
    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
    return game.accept(exporter)


# --- dates -------------------------------------------------------------------

def real_date(headers, end_time_unix=None):
    """The day a game was played, "YYYY.MM.DD": its Date header unless that is a placeholder.

    chess.com's bot and coach games carry Date "1970.01.01" (and other sources "????.??.??"), with the real
    day in EndDate or UTCDate, or only in the end time. None when nothing gives a real day.
    """
    def real(value):
        return value if value and value.replace('.', '').isdigit() and not value.startswith('1970') else None
    found = real(headers.get('Date')) or real(headers.get('EndDate')) or real(headers.get('UTCDate'))
    if found or not end_time_unix:
        return found
    return datetime.fromtimestamp(int(end_time_unix), timezone.utc).strftime('%Y.%m.%d')
