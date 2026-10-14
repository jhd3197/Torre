"""Puzzles from your own games: the moments you blundered or missed a win.

    .venv/Scripts/python my_puzzles.py              # mine the games not mined yet
    .venv/Scripts/python my_puzzles.py --rebuild    # forget the pack and mine every game again
    .venv/Scripts/python my_puzzles.py --depth 18

Reads data/games.jsonl and the engine analysis in data/analysis.jsonl
(analyze.py) and writes the "From your games" pack (puzzles.MINE_FILE) in the
bundled packs' format, so puzzles.load_packs() serves it as the MINE theme.

Two kinds of moment become puzzles. "missed": you were to move, the engine's
move was clearly winning and yours threw it away, or you let a forced mate or
your opponent's slip go (scoring.is_miss); you solve it from the position after your
opponent's previous move. "punish": your move was a
blunder that left the opponent clearly winning; that blunder is the setup
move and you find the refutation, as the puzzle generator on Lichess does.
The stored evals only pick candidates; each one is re-checked with a two-line
search and kept when the first move is winning and the only good move. The
line then follows the engine while the solver's move stays the only good one
(or mates), ending on the solver's move. Ratings and themes are heuristics.

Games are mined once: the pack remembers their ids, so later runs only look
at newly analyzed games.
"""
import argparse
import io
import json
import sys
from pathlib import Path

import chess
import chess.engine
import chess.pgn

from torre.analysis import analyze
from torre.analysis import engines
from torre.analysis import limits
from torre.learning import puzzles
from torre.analysis import scoring
from torre import jsonio
from torre import paths
ROOT = paths.REPO
GAMES_FILE = paths.DATA / 'games.jsonl'
ANALYSIS_FILE = paths.DATA / 'analysis.jsonl'
GAME_URL = {'computer': 'https://www.chess.com/game/computer/', 'live': 'https://www.chess.com/game/live/',
            'daily': 'https://www.chess.com/game/daily/'}
SOURCE = 'Your own games (my_puzzles.py)'

DEPTH = 16
WIN_CP = 200        # the solver's first move must be worth at least this (or mate)
DROP = 20           # win% the user's move must have thrown away to be a candidate
ONLY_GAP = 25       # win% the best move must beat the second best by, to be the only move
SECOND_MAX_CP = 300  # ...and the second best must not be crushing on its own
MAX_SOLVER_MOVES = 4
MATE_TAGS = {1: 'mateIn1', 2: 'mateIn2', 3: 'mateIn3', 4: 'mateIn4'}
ENDGAMES = {(chess.ROOK,): 'rookEndgame', (): 'pawnEndgame', (chess.BISHOP,): 'bishopEndgame',
            (chess.KNIGHT,): 'knightEndgame', (chess.QUEEN,): 'queenEndgame'}


def pov_win(ev, color):
    """Win% for `color` from a stored White-POV [cp, mate] eval."""
    win = scoring.win_pct(*ev)
    return win if color == chess.WHITE else 100 - win


def candidates(rec, analysis):
    """[(kind, setup_index)] worth an engine check, from the stored evals.

    `setup_index` is the index in the game's moves of the puzzle's setup move;
    the solver moves next.
    """
    evals = analysis.get('evals') or []
    user = chess.WHITE if rec['user_color'] == 'white' else chess.BLACK
    game = chess.pgn.read_game(io.StringIO(rec['pgn']))
    moves = list(game.mainline_moves())
    if len(evals) != len(moves) + 1:
        return []
    first = game.board().turn
    win_at = scoring.win_pct(WIN_CP)
    found = []
    for i in range(len(moves)):
        if (first if i % 2 == 0 else not first) != user:
            continue
        before, after = pov_win(evals[i], user), pov_win(evals[i + 1], user)
        if i > 0 and scoring.is_miss(evals[i - 1], evals[i], evals[i + 1], user == chess.WHITE):
            # A forced mate let go, or a slip of the opponent's left unpunished: barely a drop in
            # win%, but exactly the puzzle to find again.
            found.append(('missed', i - 1))
            continue
        if before - after < DROP:
            continue
        if i > 0 and before >= win_at:
            found.append(('missed', i - 1))
        if 100 - after >= win_at:
            found.append(('punish', i))
    return found


def _pov(score, color):
    """(cp, mate) for `color` from an engine PovScore."""
    s = score.pov(color)
    return (None, s.mate()) if s.is_mate() else (s.score(), None)


def top_two(engine, board, depth):
    """[(move, (cp, mate))] for the side to move, best first, at most two."""
    infos = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=2)
    infos = infos if isinstance(infos, list) else [infos]
    return [(info['pv'][0], _pov(info['score'], board.turn)) for info in infos if info.get('pv')]


def winning(ev):
    cp, mate = ev
    return mate > 0 if mate is not None else cp >= WIN_CP


def only_move(top):
    """True when the best move is winning and clearly better than the second."""
    if not top or not winning(top[0][1]):
        return False
    if len(top) == 1:
        return True
    best, second = top[0][1], top[1][1]
    if best[1] is not None:  # a forced mate is the answer unless another move mates too
        return second[1] is None or second[1] < 0
    if second[1] is not None:
        return second[1] < 0
    return scoring.win_pct(*best) - scoring.win_pct(*second) >= ONLY_GAP and second[0] < SECOND_MAX_CP


def solve(engine, board, depth=DEPTH):
    """The solution from `board` (solver to move) as UCI moves, or None.

    Follows the engine while each solver move is the only good one, stops at
    mate, and always ends on a solver move.
    """
    board, line = board.copy(), []
    for _ in range(MAX_SOLVER_MOVES):
        if board.is_game_over():
            break
        top = top_two(engine, board, depth)
        mate = top and top[0][1][1] == 1
        if not mate and not only_move(top):
            if line:
                line.pop()  # the opponent's reply we added, waiting for this move
            break
        board.push(top[0][0])
        line.append(top[0][0].uci())
        if board.is_game_over():
            break
        reply = top_two(engine, board, depth)
        if not reply:
            break
        board.push(reply[0][0])
        line.append(reply[0][0].uci())
    if len(line) % 2 == 0:
        line = line[:-1]
    return line or None


def fork_targets(board, move):
    """Squares of the worthwhile pieces `move` (just played on `board`) attacks:
    the king, bigger pieces, or undefended ones."""
    piece = board.piece_at(move.to_square)
    if piece is None or piece.piece_type == chess.KING:
        return set()
    value = scoring.PIECE_VALUES[piece.piece_type]
    return {sq for sq in board.attacks(move.to_square)
            if (target := board.piece_at(sq)) and target.color != piece.color and target.piece_type != chess.PAWN
            and (scoring.PIECE_VALUES[target.piece_type] > value or not board.attackers(target.color, sq))}


def themes_of(board, line):
    """Lichess-style tags cheaply read off the solver position and the line."""
    tags = ['myGames']
    solver, end = board.turn, board.copy()
    moves = [chess.Move.from_uci(u) for u in line]
    for n, move in enumerate(moves):
        mine = n % 2 == 0
        if mine and n == 0 and end.is_capture(move) and not end.is_en_passant(move):
            victim = end.piece_at(move.to_square)
            if victim.piece_type != chess.PAWN and not end.attackers(not solver, move.to_square) and len(moves) <= 3:
                tags.append('hangingPiece')
        if mine and move.promotion:
            tags.append('promotion' if move.promotion == chess.QUEEN else 'underPromotion')
        end.push(move)
        if mine and not end.is_checkmate():
            targets = fork_targets(end, move)
            if len(targets) >= 2 and (n + 1 == len(moves) or n + 2 < len(moves) and moves[n + 2].to_square in targets):
                tags.append('fork')  # attacks two, and the next solver move (if any) takes one
    if end.is_checkmate():
        if (len(moves) + 1) // 2 in MATE_TAGS:
            tags.append(MATE_TAGS[(len(moves) + 1) // 2])
        king = end.king(end.turn)
        rank = chess.square_rank(king)
        if rank in (0, 7) and any(end.piece_at(sq).piece_type in (chess.ROOK, chess.QUEEN)
                                  and chess.square_rank(sq) == rank for sq in end.checkers()):
            tags.append('backRankMate')
    pieces = tuple(sorted({p.piece_type for p in board.piece_map().values()} - {chess.KING, chess.PAWN}))
    if pieces in ENDGAMES and (pieces == () or all(board.pieces(pieces[0], c) for c in chess.COLORS)):
        tags.append(ENDGAMES[pieces])
    return list(dict.fromkeys(t for t in tags if t in puzzles.TAG_TO_SLUG))


def rating_of(board, line, tags):
    """A rough difficulty: longer lines and quiet first moves are harder, hanging pieces easier."""
    first = chess.Move.from_uci(line[0])
    rating = 800 + 250 * (len(line) // 2)
    if not (board.is_capture(first) or board.gives_check(first) or first.promotion):
        rating += 250
    if 'hangingPiece' in tags:
        rating -= 200
    if 'underPromotion' in tags:
        rating += 200
    if 'fork' in tags:
        rating += 100
    return max(400, min(2600, round(rating, -1)))


def mine_game(engine, rec, analysis, depth=DEPTH):
    """The puzzles from one game, each already checked by puzzles.view()."""
    game = chess.pgn.read_game(io.StringIO(rec['pgn']))
    moves = list(game.mainline_moves())
    found = []
    for kind, setup in candidates(rec, analysis):
        board = game.board()
        for move in moves[:setup]:
            board.push(move)
        fen = board.fen()
        board.push(moves[setup])
        if board.is_game_over():
            continue
        line = solve(engine, board, depth)
        if not line:
            continue
        tags = themes_of(board, line)
        played = moves[setup + 1] if kind == 'missed' else None
        if played and played.uci() == line[0]:
            continue  # the user found it after all; the stored eval was too shallow
        url = GAME_URL.get(rec.get('type'))
        item = {'id': f'my{rec["id"]}-{setup + 1}', 'fen': fen, 'moves': [moves[setup].uci()] + line,
                'rating': rating_of(board, line, tags), 'themes': tags,
                'game': f'{url}{rec["id"]}?move={setup + 1}' if url else None,
                'origin': {'game_id': rec['id'], 'date': rec.get('date'), 'opponent': rec.get('opponent'),
                           'user_color': rec['user_color'], 'kind': kind, 'ply': setup + 2,
                           'played': board.san(played) if played else None}}
        try:
            puzzles.view(item)
        except puzzles.PuzzleError:
            continue
        found.append(item)
    return found


def load_pack(path):
    try:
        pack = json.loads(Path(path).read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        pack = {}
    if not isinstance(pack.get('puzzles'), list) or not isinstance(pack.get('mined'), list):
        pack = {'puzzles': [], 'mined': []}
    return {'version': 1, 'source': SOURCE, 'mined': pack['mined'], 'puzzles': pack['puzzles']}


def save_pack(path, pack):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pack['puzzles'].sort(key=lambda p: p['rating'])
    text = json.dumps(pack, separators=(',', ':')).replace('},{"id"', '},\n{"id"')
    jsonio.write_atomic(path, text + '\n')


def _jsonl(path):
    return jsonio.read_records(path)


def run(games_file=GAMES_FILE, analysis_file=ANALYSIS_FILE, pack_file=None, engine=None, depth=DEPTH,
        rebuild=False, progress=None, engine_path=None, threads=4):
    """Mine every analyzed game not mined yet into the pack; returns (pack, games mined now).

    `engine` is an open UCI engine (when None, Stockfish at `engine_path` is started with
    `threads`, and only if there is something to mine). Only
    analyses from the current analyze.SCORING_VERSION count; the pack is
    saved after each game, so a stopped run loses nothing.
    """
    pack_file = Path(pack_file or puzzles.MINE_FILE)
    pack = {'version': 1, 'source': SOURCE, 'mined': [], 'puzzles': []} if rebuild else load_pack(pack_file)
    done = set(pack['mined'])
    games = {r.get('id'): r for r in _jsonl(games_file)}
    todo = [(games[a['id']], a) for a in _jsonl(analysis_file)
            if a.get('scoring_version') == analyze.SCORING_VERSION and a.get('id') in games and a['id'] not in done]
    if not todo:
        if rebuild:
            save_pack(pack_file, pack)
        return pack, 0
    own = engine is None
    if own:
        engine = chess.engine.SimpleEngine.popen_uci(str(engine_path or engines.resolve_engine('stockfish')))
        engine.configure(limits.cap({'Threads': threads, 'Hash': 256}))
    try:
        have = {p['id'] for p in pack['puzzles']}
        for n, (rec, analysis) in enumerate(todo, 1):
            try:
                new = [p for p in mine_game(engine, rec, analysis, depth) if p['id'] not in have]
            except Exception as exc:  # one unreadable game must not stop the run
                if progress:
                    progress(n, len(todo), rec, None, exc)
                continue
            have.update(p['id'] for p in new)
            pack['puzzles'].extend(new)
            pack['mined'].append(rec['id'])
            save_pack(pack_file, pack)
            if progress:
                progress(n, len(todo), rec, new, None)
    finally:
        if own:
            engine.quit()
    return pack, len(todo)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--depth', type=int, default=DEPTH, help=f'search depth for each check (default {DEPTH})')
    parser.add_argument('--rebuild', action='store_true', help='forget the pack and mine every game again')
    parser.add_argument('--out', type=Path, default=puzzles.MINE_FILE, help='the pack file to write')
    args = parser.parse_args()

    def report(n, total, rec, new, error):
        if error:
            print(f'[{n}/{total}] game {rec["id"]} FAILED: {error}', file=sys.stderr)
        else:
            print(f'[{n}/{total}] {rec.get("date")} vs {rec.get("opponent")}: {len(new)} puzzle(s)')

    pack, mined = run(pack_file=args.out, depth=args.depth, rebuild=args.rebuild, progress=report)
    print(f'{mined} game(s) mined, {len(pack["puzzles"])} puzzles from {len(pack["mined"])} games -> {args.out}')


if __name__ == '__main__':
    main()
