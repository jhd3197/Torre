"""Endgame practice: theoretical positions played out against Stockfish.

Each position has a goal for the side to move (you): "win" or "draw". The
engine defends (or attacks, when you defend) at a low fixed depth, and every
move you send is checked on the server:

- A win counts once you mate, or once you have converted (promoted a pawn, or
  left the defender a bare king) into a position that is clearly won: by the Syzygy
  tablebases when they are installed (`probe`), else when Stockfish scores it
  at WIN_CP or better, or sees mate. A draw by rule, or running out of
  `moves` before converting, fails.
- A draw counts once the game is drawn by rule (stalemate, insufficient
  material, repetition, fifty moves), or when you have held for `moves` moves
  and the position is not lost (above -HOLD_CP). Being mated, or a position
  the tablebases or Stockfish call lost (-LOST_CP or a mate against you),
  fails at once.

Completions live in endgames.json next to the analysis.
"""

import json
import threading
from torre import jsonio
from datetime import datetime, timezone

import chess

LOCK = threading.Lock()
DEFENDER_DEPTH = 12
WIN_CP = 700
LOST_CP = 1000
HOLD_CP = 400
MATE = 100_000

# Every FEN has you to move. Each was checked with Stockfish (depth 32): the
# wins are mates or decisive, the draws score 0.00 with best play.
POSITIONS = [
    {"id": "kqk", "group": "mates", "goal": "win", "moves": 20, "fen": "8/8/8/4k3/8/8/8/4K2Q w - - 0 1",
     "title": {"en": "Queen checkmate", "es": "Mate con dama"},
     "explain": {"en": "Use the queen a knight's move away to box the king in, shrink the box toward the edge, then bring your king up to help. Watch out for stalemate.",
                 "es": "Usa la dama a salto de caballo del rey para encerrarlo, achica la caja hacia el borde y luego acerca tu rey para ayudar. Cuidado con el ahogado."}},
    {"id": "two-rooks", "group": "mates", "goal": "win", "moves": 15, "fen": "8/8/8/3k4/8/8/8/R3K2R w - - 0 1",
     "title": {"en": "Two-rook ladder", "es": "Escalera con dos torres"},
     "explain": {"en": "One rook cuts the king off along a rank while the other checks; then they swap roles and climb rank by rank to the edge. Keep the rooks far from the king.",
                 "es": "Una torre corta al rey en una fila mientras la otra da jaque; luego cambian de papel y suben fila a fila hasta el borde. Mantén las torres lejos del rey."}},
    {"id": "krk", "group": "mates", "goal": "win", "moves": 35, "fen": "8/8/8/4k3/8/8/8/R3K3 w - - 0 1",
     "title": {"en": "Rook checkmate", "es": "Mate con torre"},
     "explain": {"en": "The rook cuts the king off; your king walks up to face it (opposition), and the rook checks or waits with a tempo move. Push the king to the edge, then mate.",
                 "es": "La torre corta al rey; tu rey se acerca hasta enfrentarlo (oposición) y la torre da jaque o espera con una jugada de tiempo. Lleva al rey al borde y da mate."}},
    {"id": "kbbk", "group": "mates", "goal": "win", "moves": 50, "fen": "8/8/8/4k3/8/8/8/2B1KB2 w - - 0 1",
     "title": {"en": "Two bishops mate", "es": "Mate con dos alfiles"},
     "explain": {"en": "Side by side, the bishops make a wall the king cannot cross. Bring your king up, shrink the area, and drive the king into a corner for mate.",
                 "es": "Juntos, los alfiles forman un muro que el rey no puede cruzar. Acerca tu rey, reduce el espacio y lleva al rey a una esquina para dar mate."}},
    {"id": "kpk-sixth", "group": "pawns", "goal": "win", "moves": 25, "fen": "4k3/8/4K3/4P3/8/8/8/8 w - - 0 1",
     "title": {"en": "King on the sixth", "es": "Rey en sexta"},
     "explain": {"en": "With your king on the sixth rank in front of its pawn, the win is certain whoever is to move. Step aside to gain the opposition, then escort the pawn home.",
                 "es": "Con tu rey en sexta delante de su peón, la victoria es segura juegue quien juegue. Hazte a un lado para ganar la oposición y escolta al peón hasta coronar."}},
    {"id": "kpk-key", "group": "pawns", "goal": "win", "moves": 30, "fen": "8/8/4k3/8/2K5/8/3P4/8 w - - 0 1",
     "title": {"en": "Key squares", "es": "Casillas clave"},
     "explain": {"en": "Your king already stands on a key square, two ranks in front of the pawn. Keep it ahead of the pawn and gain ground (c5, then c6 or d6) before pushing. The king leads, the pawn follows.",
                 "es": "Tu rey ya está en una casilla clave, dos filas delante del peón. Mantenlo por delante y gana terreno (c5, luego c6 o d6) antes de avanzar el peón. El rey va delante y el peón lo sigue."}},
    {"id": "opposition", "group": "pawns", "goal": "win", "moves": 30, "fen": "8/8/4k3/8/5K2/4P3/8/8 w - - 0 1",
     "title": {"en": "Take the opposition", "es": "Toma la oposición"},
     "explain": {"en": "Kings facing each other with one square between them: the side not to move has the opposition. Take it now with Ke4, and keep the pawn back as a spare tempo.",
                 "es": "Reyes enfrentados con una casilla entre ellos: tiene la oposición el bando que no mueve. Tómala ya con Re4 y guarda el peón como tiempo de reserva."}},
    {"id": "square-race", "group": "pawns", "goal": "win", "moves": 15, "fen": "7k/8/8/P7/8/8/8/K7 w - - 0 1",
     "title": {"en": "Rule of the square: race", "es": "Regla del cuadrado: carrera"},
     "explain": {"en": "Draw a square from the pawn to its queening rank. If the enemy king cannot step inside it, the pawn simply runs. Push and promote.",
                 "es": "Dibuja un cuadrado desde el peón hasta su fila de coronación. Si el rey enemigo no puede entrar en él, el peón corre solo. Avanza y corona."}},
    {"id": "outside-passer", "group": "pawns", "goal": "win", "moves": 35, "fen": "8/6pp/8/P2k4/8/8/5KPP/8 w - - 0 1",
     "title": {"en": "Outside passed pawn", "es": "Peón pasado alejado"},
     "explain": {"en": "The a-pawn is a decoy: the black king has to go and take it. Meanwhile your king marches to the kingside, eats the pawns there and escorts one of yours home.",
                 "es": "El peón de a es un señuelo: el rey negro tiene que ir a capturarlo. Mientras tanto tu rey marcha al flanco de rey, se come los peones y escolta a uno de los tuyos hasta coronar."}},
    {"id": "breakthrough", "group": "pawns", "goal": "win", "moves": 15, "fen": "7k/ppp5/8/PPP5/8/8/8/7K w - - 0 1",
     "title": {"en": "Pawn breakthrough", "es": "Ruptura de peones"},
     "explain": {"en": "Three against three with the kings far away: 1. b6! sacrifices a pawn so that one of the others gets through. Answer each capture with the other side pawn.",
                 "es": "Tres contra tres con los reyes lejos: 1. b6! sacrifica un peón para que otro pase. Responde a cada captura con el peón del otro lado."}},
    {"id": "queen-vs-pawn", "group": "pieces", "goal": "win", "moves": 25, "fen": "8/8/8/8/8/1K6/3pk3/7Q w - - 0 1",
     "title": {"en": "Queen against a pawn", "es": "Dama contra peón"},
     "explain": {"en": "Check or pin until the king has to stand in front of its pawn, then bring your king one step closer. Repeat, and win the pawn.",
                 "es": "Da jaque o clava hasta que el rey tenga que ponerse delante de su peón; entonces acerca tu rey un paso. Repite y gana el peón."}},
    {"id": "rook-vs-pawn", "group": "pieces", "goal": "win", "moves": 25, "fen": "8/8/8/8/4k3/8/3p4/R5K1 w - - 0 1",
     "title": {"en": "Rook against a pawn", "es": "Torre contra peón"},
     "explain": {"en": "Your king is close enough: bring it toward the pawn while the rook guards the queening square, and win the pawn before it promotes.",
                 "es": "Tu rey está lo bastante cerca: acércalo al peón mientras la torre vigila la casilla de coronación, y gana el peón antes de que corone."}},
    {"id": "lucena", "group": "rooks", "goal": "win", "moves": 30, "fen": "1K6/1P1k4/8/8/8/8/r7/2R5 w - - 0 1",
     "title": {"en": "Lucena position", "es": "Posición de Lucena"},
     "explain": {"en": "Build a bridge: lift your rook to the fourth rank (Rc4) so it can block checks later, then bring your king out from in front of the pawn. When the checks run out of room, block with the rook.",
                 "es": "Construye el puente: sube la torre a la cuarta fila (Tc4) para poder tapar jaques más tarde y saca tu rey de delante del peón. Cuando se acaben los jaques, tápalos con la torre."}},
    {"id": "kpk-defend", "group": "pawns", "goal": "draw", "moves": 20, "fen": "8/4k3/8/4P3/4K3/8/8/8 b - - 0 1",
     "title": {"en": "Hold the opposition", "es": "Mantén la oposición"},
     "explain": {"en": "Stand in front of the pawn and answer each king move by facing the enemy king. Ke6 now; when the pawn reaches the seventh, the king belongs on its queening square.",
                 "es": "Ponte delante del peón y responde a cada jugada del rey enfrentándolo. Ahora Re6; cuando el peón llegue a séptima, tu rey debe estar en la casilla de coronación."}},
    {"id": "kpk-defend-front", "group": "pawns", "goal": "draw", "moves": 20, "fen": "8/8/8/3k4/8/3PK3/8/8 b - - 0 1",
     "title": {"en": "Face the king", "es": "Enfrenta al rey"},
     "explain": {"en": "Take the opposition with Ke5 and keep it: whenever the white king steps forward, step in front of it. Without the opposition White cannot get through.",
                 "es": "Toma la oposición con Re5 y no la sueltes: cada vez que el rey blanco avance, ponte delante. Sin la oposición las blancas no pasan."}},
    {"id": "kpk-defend-back", "group": "pawns", "goal": "draw", "moves": 20, "fen": "8/8/8/8/4k3/8/4P3/4K3 b - - 0 1",
     "title": {"en": "Block the pawn early", "es": "Bloquea el peón a tiempo"},
     "explain": {"en": "Stay directly in front of the pawn and keep facing the white king. If you drift to the side, White's king takes the key squares.",
                 "es": "Quédate justo delante del peón y sigue enfrentando al rey blanco. Si te desvías a un lado, el rey blanco toma las casillas clave."}},
    {"id": "rook-pawn", "group": "pawns", "goal": "draw", "moves": 15, "fen": "k7/8/1K6/P7/8/8/8/8 b - - 0 1",
     "title": {"en": "The rook pawn", "es": "El peón de torre"},
     "explain": {"en": "Against a rook pawn the corner is a fortress: shuttle between a8 and b8 (or b7). If White pushes carelessly, it is stalemate.",
                 "es": "Contra un peón de torre la esquina es una fortaleza: muévete entre a8 y b8 (o b7). Si las blancas avanzan sin cuidado, es ahogado."}},
    {"id": "square-catch", "group": "pawns", "goal": "draw", "moves": 15, "fen": "8/8/7k/8/p7/8/8/4K3 w - - 0 1",
     "title": {"en": "Rule of the square: catch it", "es": "Regla del cuadrado: atrápalo"},
     "explain": {"en": "The pawn's square runs from a4 to d1. Step into it right away (Kd2) and the king catches the pawn in time.",
                 "es": "El cuadrado del peón va de a4 a d1. Entra en él ya (Rd2) y el rey atrapa al peón a tiempo."}},
    {"id": "philidor", "group": "rooks", "goal": "draw", "moves": 25, "fen": "4k3/R7/1r6/4PK2/8/8/8/8 b - - 0 1",
     "title": {"en": "Philidor position", "es": "Posición de Philidor"},
     "explain": {"en": "Keep your rook on the sixth rank so the white king cannot step up. Once the pawn goes to e6, swing the rook to the back and check from behind.",
                 "es": "Mantén la torre en la sexta fila para que el rey blanco no pueda subir. Cuando el peón vaya a e6, lleva la torre atrás y da jaques desde lejos."}},
    {"id": "wrong-bishop", "group": "pieces", "goal": "draw", "moves": 20, "fen": "7k/8/6K1/7P/8/8/4B3/8 b - - 0 1",
     "title": {"en": "The wrong bishop", "es": "El alfil equivocado"},
     "explain": {"en": "The h-pawn queens on a dark square, and White's bishop is light-squared. Get to the corner and stay there: White can stalemate you, but never mate.",
                 "es": "El peón de h corona en casilla oscura y el alfil blanco es de casillas claras. Llega a la esquina y quédate: pueden ahogarte, pero nunca darte mate."}},
]
BY_ID = {p["id"]: p for p in POSITIONS}


def load_state(path):
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}
    state.setdefault("positions", {})
    return state


def save_state(path, state):
    jsonio.write_json(path, state, indent=1)


def _text(field, lang):
    return field.get(lang) or field["en"]


def view(position, state, lang="en"):
    progress = state["positions"].get(position["id"], {})
    board = chess.Board(position["fen"])
    return {"id": position["id"], "group": position["group"], "goal": position["goal"], "moves": position["moves"],
            "fen": position["fen"], "color": "white" if board.turn == chess.WHITE else "black",
            "title": _text(position["title"], lang), "explain": _text(position["explain"], lang),
            "attempts": progress.get("attempts", 0), "completed": progress.get("completed"),
            "best": progress.get("best")}


def catalog(state, lang="en"):
    positions = [view(p, state, lang) for p in POSITIONS]
    return {"positions": positions, "completed": sum(1 for p in positions if p["completed"]), "total": len(positions)}


def _converted(board, start, me):
    """You promoted a pawn, or the defender is down to a bare king."""
    promoted = len(board.pieces(chess.QUEEN, me)) > len(start.pieces(chess.QUEEN, me))
    bare = chess.popcount(board.occupied_co[not me]) == 1 < chess.popcount(start.occupied_co[not me])
    return promoted or bare


def _replay(position, moves):
    board = chess.Board(position["fen"])
    for uci in moves:
        try:
            move = chess.Move.from_uci(str(uci))
        except ValueError:
            move = None
        if move not in board.legal_moves:
            raise ValueError("The move history contains an illegal move.")
        if board.outcome(claim_draw=True):
            raise ValueError("This game has ended.")
        board.push(move)
    return board


def play(position, moves, think, probe=None):
    """Judge your latest move (the last of `moves`, played from the position's FEN)
    and answer it.

    `think(board)` returns the engine's move and its score in centipawns for the
    side to move (mates as +-MATE); `probe(board)` returns the Syzygy WDL for the
    side to move, or None when the position is not in the tablebases.
    Returns {"status": "playing" | "success" | "failed", "reason", "reply", "reply_san", "used"}.
    """
    if not moves or len(moves) % 2 == 0:
        raise ValueError("It is not your move.")
    board = _replay(position, moves)
    me = not board.turn  # you just moved
    used = (len(moves) + 1) // 2
    win = position["goal"] == "win"

    def finish(status, reason, reply=None, reply_san=None):
        return {"status": status, "reason": reason, "reply": reply, "reply_san": reply_san, "used": used}

    def ruled(reply=None, reply_san=None):
        outcome = board.outcome(claim_draw=True)
        if outcome is None:
            return None
        if outcome.winner is None:
            return finish("failed" if win else "success", "drawn", reply, reply_san)
        return finish("success" if outcome.winner == me else "failed", "mate" if outcome.winner == me else "mated", reply, reply_san)

    result = ruled()
    if result:
        return result
    wdl = probe(board) if probe else None
    mine = None if wdl is None else -wdl  # the tablebase answers for the side to move: the engine
    simplified = _converted(board, chess.Board(position["fen"]), me)
    # WDL +-2 is a win or loss; +-1 is one the fifty-move rule turns into a draw.
    if win and simplified and mine == 2:
        return finish("success", "converted")
    if not win and mine == -2:
        return finish("failed", "lost")
    if win and mine is not None and mine < 2:
        return finish("failed", "slipped")

    move, score = think(board)
    mine_cp = -score
    if mine is None:
        if win and simplified and mine_cp >= WIN_CP:
            return finish("success", "converted")
        if not win and mine_cp <= -LOST_CP:
            return finish("failed", "lost")
    reply, reply_san = move.uci(), board.san(move)
    board.push(move)
    result = ruled(reply, reply_san)
    if result:
        return result
    if used >= position["moves"]:
        if win:
            return finish("failed", "limit", reply, reply_san)
        held = mine > -2 if mine is not None else mine_cp > -HOLD_CP
        return finish("success" if held else "failed", "held" if held else "lost", reply, reply_san)
    return finish("playing", None, reply, reply_san)


def record(state, position_id, result, used, now):
    """Count an attempt on its first move and a completion on success."""
    entry = state["positions"].setdefault(position_id, {"attempts": 0})
    if used == 1:
        entry["attempts"] = entry.get("attempts", 0) + 1
    if result["status"] == "success":
        entry["completed"] = entry.get("completed") or now.isoformat()
        entry["best"] = min(entry.get("best") or used, used)
    return entry


def engine_think(engine, depth=DEFENDER_DEPTH):
    """A think() for play() from a python-chess engine searching to `depth`."""
    import chess.engine

    def think(board):
        info = engine.analyse(board, chess.engine.Limit(depth=depth))
        move = (info.get("pv") or [None])[0] or engine.play(board, chess.engine.Limit(depth=depth)).move
        return move, info["score"].pov(board.turn).score(mate_score=MATE)
    return think


def tablebase_probe(directory):
    """probe() from Syzygy files in `directory`, or None when there are none."""
    import chess.syzygy
    if not directory or not directory.is_dir() or not any(directory.glob("*.rtbw")):
        return None
    tables = chess.syzygy.open_tablebase(str(directory))

    def probe(board):
        try:
            return tables.probe_wdl(board)
        except (KeyError, IndexError, ValueError, chess.syzygy.MissingTableError):
            return None
    return probe


def now_utc():
    return datetime.now(timezone.utc)
