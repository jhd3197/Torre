"""A game record read into its start board, moves and clocks: an archive game (games.jsonl, with
its PGN) or a game played against a studio bot (played.jsonl, with UCI moves). game_stats and
motifs both read games this way."""
import io

import chess
import chess.pgn


def parse_game(rec):
    """Start board, moves, headers and per-ply clock / emt seconds (None when
    unknown) of a game record, or None if it can't be read."""
    if rec.get("pgn"):
        game = chess.pgn.read_game(io.StringIO(rec["pgn"]))
        if game is None or game.errors:
            return None
        nodes = list(game.mainline())
        moves, headers = [n.move for n in nodes], dict(game.headers)
        clocks, emts = [n.clock() for n in nodes], [n.emt() for n in nodes]
        board = game.board()
    else:
        try:
            board = chess.Board(rec.get("initialFen") or chess.STARTING_FEN)
            moves, b = [], board.copy()
            for uci in rec.get("moves") or []:
                mv = chess.Move.from_uci(uci)
                if mv not in b.legal_moves:
                    return None
                moves.append(mv)
                b.push(mv)
        except ValueError:
            return None
        headers, clocks, emts = {}, [None] * len(moves), [None] * len(moves)
    stamps = rec.get("move_timestamps") or []
    if isinstance(stamps, str):
        stamps = stamps.split(",")
    if rec.get("type") == "live" and all(c is None for c in clocks) and len(stamps) >= len(moves):
        try:
            clocks = [int(s) / 10 for s in stamps[:len(moves)]]
        except ValueError:
            pass
    return {"board": board, "moves": moves, "headers": headers, "clocks": clocks, "emts": emts}
