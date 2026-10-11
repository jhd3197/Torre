"""Boards as the app sees them: a position from a start and a move list, what the board page
draws for it (state), and games read from PGN."""
import io

import chess
import chess.pgn

from torre.analysis import opening_book
from torre.server.routes import BadRequest


def moves_of(payload):
    """The request's "moves": a list of UCI strings (none when absent)."""
    moves = payload.get('moves', [])
    if not isinstance(moves, list) or not all(isinstance(uci, str) for uci in moves):
        raise BadRequest('"moves" must be a list of moves.')
    return moves


def position(payload):
    fen = payload.get('initialFen') or chess.STARTING_FEN
    if not isinstance(fen, str):
        raise BadRequest('This position is not a valid chess position.')
    board = chess.Board(fen)
    if not board.is_valid():
        raise ValueError('This position is not a valid chess position.')
    for uci in moves_of(payload):
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            raise ValueError('The move history contains an illegal move.')
        board.push(move)
    return board


def line_sans(payload):
    """SAN for a line of UCI moves, cut at the first illegal one (with an error)."""
    board = position({'initialFen': payload.get('initialFen')})
    moves = []
    for uci in moves_of(payload):
        try:
            move = chess.Move.from_uci(uci)
        except (ValueError, TypeError):
            move = None
        if move is None or move not in board.legal_moves:
            return {'moves': moves, 'error': 'This line contains an illegal move. It was cut at the last legal one.'}
        moves.append({'uci': move.uci(), 'san': board.san(move)})
        board.push(move)
    return {'moves': moves}


def illegal_reason(board, from_square, to_square):
    """Why the side to move cannot play from `from_square` to `to_square`, as a rule a learner can
    read: (reason, details) or None when the move is legal or there is nothing to explain (an empty
    square, the other side's piece, or the mover's own piece in the way, which selects it instead).

    Reasons: pinned (the piece shields its king from `attacker`), inCheck (the king is in check from
    `attacker` and this does not answer it), kingAttacked (the king would step onto a square
    `attacker` covers), exposesKing (it would uncover the king to `attacker`), castleInCheck,
    castleThroughCheck, castleRights, castleBlocked, pathBlocked (`blocker` stands in the way),
    pawnForward (pawns capture diagonally, never straight ahead), pawnDiagonal (a pawn moves
    diagonally only to capture), pawnDouble (two squares only from the starting rank), movement
    (that piece never moves that way)."""
    piece = board.piece_at(from_square)
    if piece is None or piece.color != board.turn:
        return None
    target = board.piece_at(to_square)
    if target is not None and target.color == board.turn:
        return None
    king = board.king(board.turn)
    name = chess.piece_name(piece.piece_type)
    moves = [m for m in (chess.Move(from_square, to_square, promotion=p) for p in (None, chess.QUEEN)) if board.is_pseudo_legal(m)]
    if any(board.is_legal(m) for m in moves) or (board.piece_type_at(from_square) == chess.KING and any(
            m.from_square == from_square and m.to_square == to_square for m in board.generate_castling_moves())):
        return None
    castle = piece.piece_type == chess.KING and chess.square_rank(from_square) == chess.square_rank(to_square) \
        and abs(chess.square_file(from_square) - chess.square_file(to_square)) == 2
    if castle:
        rook_file = 7 if chess.square_file(to_square) > chess.square_file(from_square) else 0
        rook = chess.square(rook_file, chess.square_rank(from_square))
        if not board.has_castling_rights(board.turn) or not (board.castling_rights & chess.BB_SQUARES[rook]):
            return 'castleRights', {}
        if board.is_check():
            return 'castleInCheck', {}
        step = 1 if rook_file == 7 else -1
        between = range(chess.square_file(from_square) + step, rook_file, step)
        if any(board.piece_at(chess.square(f, chess.square_rank(from_square))) for f in between):
            return 'castleBlocked', {}
        return 'castleThroughCheck', {}
    if moves:
        move = moves[0]
        after = board.copy(stack=False)
        after.push(move)
        king_after = after.king(board.turn)
        attackers = sorted(after.attackers(not board.turn, king_after))
        attacker = {'attacker': chess.square_name(attackers[0])} if attackers else {}
        if piece.piece_type == chess.KING:
            return 'kingAttacked', attacker
        if board.is_check():
            return 'inCheck', {'attacker': chess.square_name(sorted(board.checkers())[0])}
        if board.is_pinned(board.turn, from_square):
            return 'pinned', {'piece': name, **attacker}
        return 'exposesKing', attacker
    if piece.piece_type == chess.PAWN:
        forward = 8 if board.turn == chess.WHITE else -8
        start_rank = 1 if board.turn == chess.WHITE else 6
        files = chess.square_file(to_square) - chess.square_file(from_square)
        if files == 0 and to_square - from_square in (forward, 2 * forward):
            if to_square - from_square == 2 * forward and chess.square_rank(from_square) != start_rank:
                return 'pawnDouble', {}
            return 'pawnForward', {}
        if abs(files) == 1 and to_square - from_square in (forward - 1, forward + 1):
            return 'pawnDiagonal', {}
        return 'movement', {'piece': name}
    # A slider aimed along its own line, with something between.
    if piece.piece_type in (chess.BISHOP, chess.ROOK, chess.QUEEN) and to_square in chess.SquareSet(chess.BB_RAYS[from_square][to_square]):
        diagonal = chess.square_file(from_square) != chess.square_file(to_square) and chess.square_rank(from_square) != chess.square_rank(to_square)
        fits = piece.piece_type == chess.QUEEN or (piece.piece_type == chess.BISHOP) == diagonal
        between = chess.SquareSet(chess.between(from_square, to_square)) & board.occupied
        if fits and between:
            return 'pathBlocked', {'piece': name, 'blocker': chess.square_name(min(between, key=lambda s: chess.square_distance(s, from_square)))}
    return 'movement', {'piece': name}


def board_guidance(board):
    """Attacks describe control; planning paths also respect blockers and king safety."""
    plans = {}
    for color in (chess.WHITE, chess.BLACK):
        hypothetical = board.copy(stack=False)
        hypothetical.turn = color
        if color != board.turn:
            hypothetical.ep_square = None
        for move in hypothetical.legal_moves:
            target = hypothetical.piece_at(move.to_square)
            if target and target.piece_type == chess.KING:
                continue
            origin = chess.square_name(move.from_square)
            destination = chess.square_name(move.to_square)
            if destination not in plans.setdefault(origin, []):
                plans[origin].append(destination)
    control = {chess.square_name(square): {
        'white': [chess.square_name(s) for s in board.attackers(chess.WHITE, square)],
        'black': [chess.square_name(s) for s in board.attackers(chess.BLACK, square)],
    } for square in chess.SQUARES}
    return {'plans': plans, 'control': control}


def state(board):
    outcome = board.outcome(claim_draw=True)
    return {
        **board_guidance(board),
        'fen': board.fen(), 'turn': 'white' if board.turn else 'black',
        'pieces': {chess.square_name(s): p.symbol() for s, p in board.piece_map().items()},
        'legal': [m.uci() for m in board.legal_moves],
        'check': chess.square_name(board.king(board.turn)) if board.is_check() else None,
        'result': outcome.result() if outcome else None,
        'termination': outcome.termination.name.replace('_', ' ').lower() if outcome else None,
    }


def parse_pgn(pgn):
    if not isinstance(pgn, str) or not pgn.strip():
        raise ValueError('Paste a PGN game to import.')
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None or game.errors:
        raise ValueError('Could not read this PGN. Check the headers and move notation.')
    board = game.board()
    initial = board.fen()
    if not board.is_valid():
        raise ValueError('The PGN starts from an invalid position.')
    moves = []
    for node in game.mainline():
        move, clock = node.move, node.clock()
        moves.append({'uci': move.uci(), 'san': board.san(move), **({'clock': round(clock, 1)} if clock is not None else {})})
        board.push(move)
    if not moves and not pgn.lstrip().startswith('['):
        raise ValueError('No chess moves were found. Paste PGN headers and move notation.')
    return {'initialFen': initial, 'moves': moves, 'headers': dict(game.headers), 'opening': opening_book.recognize(game)}


def with_clocks(detail, record):
    """Clocks for a game whose PGN has none, from the chess.com timestamps saved with it (tenths of a
    second left after each move, from the extension export and the callback API)."""
    stamps, moves = record.get('move_timestamps'), detail['moves']
    if isinstance(stamps, str):  # the callback API sends "5991,5980,...", the extension a list
        try:
            stamps = [float(stamp) for stamp in stamps.split(',')]
        except ValueError:
            return detail
    # Live games carry one more value than moves, after the last: each move's clock is still in order.
    if not isinstance(stamps, list) or len(stamps) not in (len(moves), len(moves) + 1) or any('clock' in move for move in moves):
        return detail
    stamps = stamps[:len(moves)]
    if not all(isinstance(stamp, (int, float)) and stamp >= 0 for stamp in stamps):
        return detail
    return {**detail, 'moves': [{**move, 'clock': round(stamp / 10, 1)} for move, stamp in zip(moves, stamps)]}
