"""Awards: counts of what you have done on the board, with tiers like GitHub achievements.

Every award has four thresholds. Reaching the first unlocks it; the next three
are bronze, silver and gold. Counts come from three places:

* every game you played: the chess.com archive (games.jsonl) and games against
  the studio's bots (played.jsonl), scanned move by move for motifs;
* engine analysis (analysis.jsonl) where a game has it, for brilliant moves;
* puzzles you solved cleanly, by theme (puzzles.json).

The motif detectors are heuristics on the position after each of your moves.
They are meant to recognise the idea, not to judge whether it was sound.
Scans are cached per game in achievement-scan.json, so only new games cost time.
"""
import io
import json
import threading
from collections import Counter
from pathlib import Path

import chess

from torre import translations
from torre import jsonio
import chess.pgn

SCAN_VERSION = 3
TIERS = ('unlocked', 'bronze', 'silver', 'gold')
VALUE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
SLIDER_DIRECTIONS = {
    chess.BISHOP: [(1, 1), (1, -1), (-1, 1), (-1, -1)],
    chess.ROOK: [(1, 0), (-1, 0), (0, 1), (0, -1)],
    chess.QUEEN: [(1, 1), (1, -1), (-1, 1), (-1, -1), (1, 0), (-1, 0), (0, 1), (0, -1)],
}

# id: (family, title, description, unit, [unlock, bronze, silver, gold])
AWARDS = {
    'fork': ('tactics', 'Fork', 'Attack two pieces at once', 'forks', [10, 100, 400, 1000]),
    'pin': ('tactics', 'Pin', 'Pin a piece to its king', 'pins', [10, 50, 150, 400]),
    'skewer': ('tactics', 'Skewer', 'Hit a big piece and win the one behind it', 'skewers', [5, 25, 75, 200]),
    'checkmate': ('tactics', 'Checkmate', 'Deliver checkmate', 'checkmates', [10, 50, 200, 500]),
    'promotion': ('tactics', 'Promotion', 'Promote a pawn', 'promotions', [5, 50, 200, 500]),
    'deflection': ('tactics', 'Deflection', 'Solve deflection and attraction puzzles', 'puzzles', [3, 15, 50, 150]),
    'discovery': ('tactics', 'Discovery', 'Move one piece to uncover a check or a queen attack', 'discoveries', [5, 50, 200, 500]),
    'brilliant': ('tactics', 'Brilliant', 'Play a brilliant move (!!) in an analysed game', 'brilliant moves', [1, 5, 15, 40]),
    'sacrifice': ('strategy', 'Sacrifice', 'Give up a piece, stay down for it, and win', 'sacrifices', [3, 15, 50, 150]),
    'castle': ('strategy', 'Castle', 'Bring your king to safety', 'games castled', [10, 50, 200, 500]),
    'passed-pawn': ('strategy', 'Passed Pawn', 'Push a passed pawn to the sixth rank', 'passed pawns', [10, 100, 400, 1000]),
    'zugzwang': ('strategy', 'Zugzwang', 'Win after leaving your opponent only king and pawn moves', 'squeezes', [3, 15, 50, 150]),
    'back-rank': ('strategy', 'Back Rank', 'Mate a king trapped on its back rank', 'back-rank mates', [3, 15, 50, 150]),
    'outpost': ('strategy', 'Outpost', 'Plant a knight where no pawn can chase it', 'outposts', [10, 50, 150, 400]),
    'endgame': ('strategy', 'Endgame', 'Win a game that reached the endgame', 'endgames won', [5, 25, 100, 300]),
    'swindle': ('strategy', 'Swindle', 'Win after being a rook down', 'swindles', [1, 10, 40, 100]),
    'blitz': ('milestones', 'Blitz', 'Win in 25 moves or fewer', 'quick wins', [5, 25, 100, 300]),
    'scholar': ('milestones', 'Scholar', 'Play games', 'games', [10, 100, 500, 1000]),
    'precision': ('milestones', 'Precision', 'Win without losing a piece', 'clean wins', [3, 15, 50, 150]),
    'summit': ('milestones', 'Summit', 'Reach a rating', 'rating', [800, 1200, 1600, 2000]),
    'patience': ('milestones', 'Patience', 'Win a game of 50 moves or more', 'long wins', [5, 25, 100, 250]),
    'good-sport': ('milestones', 'Good Sport', 'Play a game to the end without resigning', 'games finished', [10, 100, 500, 1000]),
    'tactician': ('milestones', 'Tactician', 'Solve puzzles on the first try', 'puzzles solved', [10, 50, 250, 1000]),
    'legend': ('milestones', 'Legend', 'Win games', 'wins', [10, 100, 500, 1000]),
}

# Puzzle theme tags that count toward an award.
PUZZLE_AWARDS = {
    'deflection': {'deflection', 'attraction'},
    'discovery': {'discoveredAttack', 'doubleCheck'},
    'sacrifice': {'sacrifice'},
    'back-rank': {'backRankMate'},
    'promotion': {'underPromotion'},
    'endgame': {'rookEndgame', 'pawnEndgame', 'bishopEndgame', 'knightEndgame', 'queenEndgame'},
}

LOCK = threading.Lock()


def _ray(square, step):
    file, rank = chess.square_file(square), chess.square_rank(square)
    while True:
        file, rank = file + step[0], rank + step[1]
        if not (0 <= file < 8 and 0 <= rank < 8):
            return
        yield chess.square(file, rank)


def _material(board, color):
    return sum(VALUE[t] * len(board.pieces(t, color)) for t in VALUE)


def _pieces_material(board):
    return sum(VALUE[t] * len(board.pieces(t, c)) for c in chess.COLORS for t in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN))


def _is_fork(board, to, me):
    moved = board.piece_at(to)
    them = not me
    targets = 0
    for sq in board.attacks(to):
        piece = board.piece_at(sq)
        if not piece or piece.color != them:
            continue
        if piece.piece_type == chess.KING or VALUE[piece.piece_type] > VALUE[moved.piece_type] or (
                VALUE[piece.piece_type] >= 3 and not board.is_attacked_by(them, sq)):
            targets += 1
    if targets < 2:
        return False
    safe = not board.is_attacked_by(them, to) or board.is_attacked_by(me, to) or board.is_check()
    return safe


def _new_pins(before, board, to, me):
    them = not me
    if board.piece_type_at(to) not in SLIDER_DIRECTIONS:
        return 0
    pins = 0
    for sq in chess.SquareSet(board.occupied_co[them]):
        piece_type = board.piece_type_at(sq)
        if piece_type in (chess.KING, chess.PAWN):
            continue
        if board.is_pinned(them, sq) and to in board.pin(them, sq) and not before.is_pinned(them, sq):
            pins += 1
    return pins


def _is_skewer(board, to, me):
    them = not me
    moved = board.piece_type_at(to)
    for step in SLIDER_DIRECTIONS.get(moved, []):
        front = None
        for sq in _ray(to, step):
            piece = board.piece_at(sq)
            if not piece:
                continue
            if front is None:
                if piece.color != them or piece.piece_type not in (chess.KING, chess.QUEEN, chess.ROOK):
                    break
                front = piece
                continue
            if piece.color == them and piece.piece_type != chess.PAWN and (
                    front.piece_type == chess.KING or VALUE[front.piece_type] > VALUE[piece.piece_type]) and (
                    not board.is_attacked_by(them, sq) or VALUE[piece.piece_type] > VALUE[moved]) and (
                    not board.is_attacked_by(them, to) or board.is_attacked_by(me, to)):
                return True
            break
    return False


def _is_discovery(board, move, me, captured):
    """A discovered check, or a discovered attack on the queen while the moved piece also strikes."""
    them = not me
    double = captured or board.is_check()
    for sq in chess.SquareSet(board.occupied_co[me]):
        if sq == move.to_square or board.piece_type_at(sq) not in SLIDER_DIRECTIONS:
            continue
        for target in board.attacks(sq):
            piece = board.piece_at(target)
            if piece and piece.color == them and (piece.piece_type == chess.KING or (piece.piece_type == chess.QUEEN and double)) \
                    and move.from_square in chess.SquareSet(chess.between(sq, target)):
                return True
    return False


def _relative_rank(square, color):
    rank = chess.square_rank(square)
    return rank if color == chess.WHITE else 7 - rank


def _is_passed(board, square, color):
    file, rank = chess.square_file(square), chess.square_rank(square)
    for sq in board.pieces(chess.PAWN, not color):
        f, r = chess.square_file(sq), chess.square_rank(sq)
        if abs(f - file) <= 1 and (r > rank if color == chess.WHITE else r < rank):
            return False
    return True


def _is_outpost(board, square, color):
    if _relative_rank(square, color) not in (4, 5):
        return False
    if not any(board.piece_type_at(sq) == chess.PAWN for sq in board.attackers(color, square)):
        return False
    file, rank = chess.square_file(square), chess.square_rank(square)
    for sq in board.pieces(chess.PAWN, not color):
        f, r = chess.square_file(sq), chess.square_rank(sq)
        if abs(f - file) == 1 and (r > rank if color == chess.WHITE else r < rank):
            return False
    return True


def _is_squeeze(board, me):
    """Opponent to move, not in check, in an endgame, with only king and pawn moves."""
    them = not me
    if board.is_check() or board.pieces(chess.QUEEN, them) or board.pieces(chess.QUEEN, me):
        return False
    moves = list(board.legal_moves)
    return bool(moves) and len(moves) <= 4 and all(board.piece_type_at(m.from_square) in (chess.KING, chess.PAWN) for m in moves)


def scan(board, moves, me):
    """Facts about one game from your side: motif counts and a few flags."""
    facts = Counter()
    lost_piece = False
    worst_deficit = 0
    reached_endgame = False
    squeezed = False
    pending_sacrifice = None  # square of a piece you just left en prise
    balance_before_sac = 0
    sacrifices = []  # (ply it was taken, your material balance before you offered it)
    balances = []  # your material balance after every ply
    my_moves = 0
    for ply, move in enumerate(moves):
        mover = board.turn
        if mover == me:
            my_moves += 1
            before = board.copy(stack=False)
            castling = board.is_castling(move)
            captured = board.piece_at(move.to_square)
            board.push(move)
            piece = board.piece_at(move.to_square)
            if castling:
                facts['castled'] = 1
            if move.promotion:
                facts['promotion'] += 1
            if board.is_checkmate():
                facts['checkmate'] = 1
                king = board.king(not me)
                back = 7 if me == chess.WHITE else 0  # the mated king's home rank
                if king is not None and chess.square_rank(king) == back and any(
                        board.piece_type_at(sq) in (chess.ROOK, chess.QUEEN) and chess.square_rank(sq) == back
                        for sq in board.checkers()):
                    facts['back_rank'] = 1
            if _is_fork(board, move.to_square, me):
                facts['fork'] += 1
            facts['pin'] += _new_pins(before, board, move.to_square, me)
            if _is_skewer(board, move.to_square, me):
                facts['skewer'] += 1
            if _is_discovery(board, move, me, captured is not None):
                facts['discovery'] += 1
            if piece.piece_type == chess.PAWN and _relative_rank(move.to_square, me) == 5 and _is_passed(board, move.to_square, me):
                facts['passed_pawn'] += 1
            if piece.piece_type == chess.KNIGHT and _is_outpost(board, move.to_square, me):
                facts['outpost'] += 1
            if not squeezed and _is_squeeze(board, me):
                squeezed = True
            # A piece put where it can be taken for less than it is worth.
            value = VALUE[piece.piece_type]
            pending_sacrifice = None
            balance_before_sac = _material(before, me) - _material(before, not me)
            if value >= 3 and piece.piece_type != chess.KING and VALUE[captured.piece_type if captured else chess.KING] < value:
                attackers = [VALUE[board.piece_type_at(sq)] for sq in board.attackers(not me, move.to_square)]
                if attackers and (not board.is_attacked_by(me, move.to_square) or min(attackers) < value):
                    pending_sacrifice = move.to_square
        else:
            target = board.piece_at(move.to_square)
            board.push(move)
            if target and target.color == me:
                if target.piece_type in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN):
                    lost_piece = True
                if pending_sacrifice == move.to_square:
                    sacrifices.append((ply, balance_before_sac))
            pending_sacrifice = None
        balances.append(_material(board, me) - _material(board, not me))
        if ply >= 20:
            worst_deficit = max(worst_deficit, _material(board, not me) - _material(board, me))
        if not reached_endgame and _pieces_material(board) <= 14:
            reached_endgame = True
    # A sacrifice is material you stayed down for at least two more moves.
    facts['sacrifice'] = sum(1 for taken, before in sacrifices
                             if taken + 4 < len(balances) and balances[taken + 4] <= before - 2)
    facts.update({'my_moves': my_moves, 'lost_piece': int(lost_piece), 'worst_deficit': worst_deficit,
                  'endgame': int(reached_endgame), 'squeeze': int(squeezed)})
    return dict(facts)


def _archive_games(data_dir):
    for record in jsonio.read_jsonl(Path(data_dir) / 'games.jsonl'):
        result = record.get('user_result')
        outcome = 'win' if result == 1 else 'loss' if result == 0 else 'draw' if result == 0.5 else None
        resigned = outcome == 'loss' and 'resignation' in (record.get('end_reason') or '')
        yield record['id'], record, outcome, resigned


def _played_games(data_dir):
    for record in jsonio.read_jsonl(Path(data_dir) / 'played.jsonl'):
        me = record['user_color']
        result = record['result']
        outcome = 'draw' if result == '1/2-1/2' else 'win' if (result == '1-0') == (me == 'white') else 'loss'
        yield record['id'], record, outcome, bool(record.get('resigned'))


def _scan_record(record):
    me = chess.WHITE if record['user_color'] == 'white' else chess.BLACK
    if 'pgn' in record:
        game = chess.pgn.read_game(io.StringIO(record['pgn']))
        if game is None:
            return None
        board = game.board()
        moves = list(game.mainline_moves())
    else:
        board = chess.Board(record.get('initialFen') or chess.STARTING_FEN)
        moves = [chess.Move.from_uci(m) for m in record['moves']]
    try:
        return scan(board, moves, me)
    except (ValueError, AssertionError, AttributeError):
        return None


def _load_cache(path):
    try:
        cache = json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return cache.get('games', {}) if cache.get('version') == SCAN_VERSION else {}


def _brilliancies(path):
    """{game id: brilliant moves} from the latest analysis record of each game."""
    return {row['id']: row.get('brilliant', 0) or 0 for row in jsonio.read_records(path) if 'id' in row}


def counts(data_dir, puzzle_state=None, puzzle_tags=None):
    """{award id: count} from every game and puzzle, plus the number of games scanned."""
    data_dir = Path(data_dir)
    cache_path = data_dir / 'achievement-scan.json'
    with LOCK:
        cache = _load_cache(cache_path)
        changed = False
        total = Counter()
        best_rating = 0
        analysis = jsonio.cached(data_dir / 'analysis.jsonl', _brilliancies)
        games = list(_archive_games(data_dir)) + list(_played_games(data_dir))
        for game_id, record, outcome, resigned in games:
            if outcome is None:
                continue
            facts = cache.get(game_id)
            if facts is None:
                facts = _scan_record(record) or {}
                cache[game_id] = facts
                changed = True
            won = outcome == 'win'
            total['scholar'] += 1
            total['legend'] += won
            total['good-sport'] += not resigned
            total['fork'] += facts.get('fork', 0)
            total['pin'] += facts.get('pin', 0)
            total['skewer'] += facts.get('skewer', 0)
            total['discovery'] += facts.get('discovery', 0)
            total['promotion'] += facts.get('promotion', 0)
            total['passed-pawn'] += facts.get('passed_pawn', 0)
            total['outpost'] += facts.get('outpost', 0)
            total['castle'] += facts.get('castled', 0)
            total['checkmate'] += won and facts.get('checkmate', 0)
            total['back-rank'] += won and facts.get('back_rank', 0)
            total['sacrifice'] += won and min(facts.get('sacrifice', 0), 1)
            total['zugzwang'] += won and facts.get('squeeze', 0)
            total['endgame'] += won and facts.get('endgame', 0)
            total['swindle'] += won and facts.get('worst_deficit', 0) >= 5
            total['blitz'] += won and facts.get('my_moves', 99) <= 25
            total['patience'] += won and facts.get('my_moves', 0) >= 50
            total['precision'] += won and not facts.get('lost_piece', 1)
            total['brilliant'] += analysis.get(game_id, 0)
            best_rating = max(best_rating, int(record.get('user_rating') or 0))
        if changed:
            jsonio.write_json(cache_path, {'version': SCAN_VERSION, 'games': cache})
    total['summit'] = best_rating
    if puzzle_state:
        for puzzle_id, entry in puzzle_state.get('puzzles', {}).items():
            if not entry.get('solved'):
                continue
            total['tactician'] += 1
            tags = set((puzzle_tags or {}).get(puzzle_id, ()))
            for award, wanted in PUZZLE_AWARDS.items():
                if tags & wanted:
                    total[award] += 1
    return {award: int(total[award]) for award in AWARDS}, len(games)


def level(award, count):
    """0 while locked; 1 unlocked, 2 bronze, 3 silver, 4 gold."""
    return sum(count >= threshold for threshold in AWARDS[award][4])


def _text(award, field, english, lang):
    return translations.entry(lang, 'awards', award, field, english)


def board(award_counts, lang='en'):
    """The awards as the UI shows them, in `lang` (content/<lang>/awards.json)."""
    out = []
    for award, (family, title, description, unit, thresholds) in AWARDS.items():
        title, description, unit = (_text(award, 'title', title, lang), _text(award, 'description', description, lang),
                                    _text(award, 'unit', unit, lang))
        count = award_counts.get(award, 0)
        lvl = level(award, count)
        out.append({
            'id': award, 'family': family, 'title': title, 'description': description, 'unit': unit,
            'thresholds': thresholds, 'count': count, 'level': lvl,
            'tier': TIERS[lvl - 1] if lvl else 'locked',
            'next': thresholds[lvl] if lvl < len(thresholds) else None,
        })
    return out


def improvements(before, after, lang='en'):
    """Awards whose level went up between two count snapshots."""
    return [{'id': a, 'title': _text(a, 'title', AWARDS[a][1], lang), 'tier': TIERS[level(a, after[a]) - 1]}
            for a in AWARDS if level(a, after.get(a, 0)) > level(a, before.get(a, 0))]
