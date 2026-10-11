"""Turn a master game into a game-story lesson: find it, find its key moments, write the skeleton.

A game story (see lessons/README.md) is a short lesson: the setup, the game
playing itself with stops where the reader guesses the move, and a takeaway.
This script does the chess part; the words are written by hand afterwards.

    python game_story.py find Morphy --opponent Duke --year 1858
        games in games/masters/Morphy.pgn matching the filters, numbered
    python game_story.py moments Morphy 42
        Stockfish's key moments of game 42: moves where only one move works
    python game_story.py skeleton Morphy 42 morphy-opera-house --unit "Paul Morphy" --order 1
        writes lessons/morphy-opera-house.json with TODO text and guess stops at the key moments

The master files come from download_masters.py. A key moment is a move by the
winner that was Stockfish's choice and much better than the next best one.
"""

import argparse
import json
import sys
from pathlib import Path

import chess
import chess.engine
import chess.pgn

from torre.analysis.engine_service import ENGINE_PATH
from torre import paths

ROOT = Path(__file__).resolve().parents[1]
MASTERS = ROOT / 'games' / 'masters'
LESSONS = paths.LESSONS
MATE = 100_000
GAP = 150          # centipawns between the best and the second-best move for a "only move"
SKIP_PLIES = 10    # the first moves are opening theory, not moments
SPACING = 4        # plies between two chosen moments


def games(player):
    path = MASTERS / f'{player}.pgn'
    if not path.exists():
        sys.exit(f'{path} is missing: run python download_masters.py {player}')
    with path.open(encoding='latin-1') as handle:
        while (game := chess.pgn.read_game(handle)) is not None:
            yield game


def describe(i, game):
    h = game.headers
    return f'{i:5}  {h.get("White")} - {h.get("Black")}  {h.get("Result")}  {h.get("Event")}, {h.get("Date", "?")[:4]}  ({game.end().ply() // 2 + 1} moves)'


def nth(player, index):
    for i, game in enumerate(games(player)):
        if i == index:
            return game
    sys.exit(f'{player} has no game {index}')


def score(info, turn):
    pov = info['score'].pov(turn)
    mate = pov.mate()
    if mate is not None:
        return MATE - abs(mate) if mate > 0 else -MATE + abs(mate)
    return pov.score()


def moments(game, seconds):
    """[(ply, san, gap, best score)] for the winner's only-moves, biggest gap first."""
    result = game.headers.get('Result')
    winner = chess.WHITE if result == '1-0' else chess.BLACK if result == '0-1' else None
    found = []
    board = game.board()
    with chess.engine.SimpleEngine.popen_uci(str(ENGINE_PATH)) as engine:
        for ply, move in enumerate(game.mainline_moves(), start=1):
            if ply > SKIP_PLIES and (winner is None or board.turn == winner):
                infos = engine.analyse(board, chess.engine.Limit(time=seconds), multipv=2)
                ranked = [(i['pv'][0], score(i, board.turn)) for i in infos if i.get('pv')]
                if len(ranked) == 2 and ranked[0][0] == move:
                    gap = ranked[0][1] - ranked[1][1]
                    if gap >= GAP:
                        found.append((ply, board.san(move), gap, ranked[0][1]))
            board.push(move)
    return sorted(found, key=lambda m: -m[2])


def spaced(found, limit):
    chosen = []
    for moment in found:
        if all(abs(moment[0] - c[0]) >= SPACING for c in chosen):
            chosen.append(moment)
        if len(chosen) == limit:
            break
    return sorted(chosen)


def label(value):
    return f'mate in {MATE - value}' if value >= MATE - 500 else f'{value / 100:+.2f}'


def skeleton(game, chosen, unit, order, orientation):
    h = game.headers
    board = game.board()
    moves = [m.uci() for m in game.mainline_moves()]
    title = f'{h.get("White")} – {h.get("Black")}, {h.get("Event")} {h.get("Date", "?")[:4]}'
    lesson = {
        'version': 1, 'title': 'TODO title', 'summary': 'TODO one line for the card.', 'category': 'history',
        'level': 'intermediate', 'minutes': 6, 'unit': unit, 'order': order, 'orientation': orientation,
        'steps': [
            {'id': 'the-setting', 'kind': 'explain', 'title': 'TODO', 'fen': board.fen(),
             'text': f'TODO who, when, what was at stake. Source game: {title} ({h.get("Result")}).',
             'narration': 'TODO 1-3 spoken sentences.', 'pose': 'present'},
            {'id': 'the-game', 'kind': 'guess', 'title': title, 'text': 'TODO what to watch for.',
             'narration': 'TODO', 'pose': 'playing', 'moves': moves, 'notes': [],
             'guesses': [{'ply': ply, 'prompt': f'TODO question ({san}, gap {gap / 100:.1f}, eval {label(best)})',
                          'hint': 'TODO', 'why': 'TODO'} for ply, san, gap, best in chosen]},
            {'id': 'the-lesson', 'kind': 'explain', 'title': 'TODO the takeaway', 'fen': board.fen(),
             'text': 'TODO one idea to remember.', 'narration': 'TODO', 'pose': 'idea'},
        ],
    }
    return lesson


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    find = sub.add_parser('find')
    find.add_argument('player')
    find.add_argument('--opponent', default='')
    find.add_argument('--event', default='')
    find.add_argument('--year', default='')
    find.add_argument('--wins', action='store_true', help="only the player's wins")
    for name in ('moments', 'skeleton'):
        cmd = sub.add_parser(name)
        cmd.add_argument('player')
        cmd.add_argument('index', type=int)
        cmd.add_argument('--seconds', type=float, default=0.3)
        cmd.add_argument('--count', type=int, default=4, help='how many guess stops')
        if name == 'skeleton':
            cmd.add_argument('slug')
            cmd.add_argument('--unit')
            cmd.add_argument('--order', type=int, default=0)
            cmd.add_argument('--orientation', choices=('white', 'black'))
            cmd.add_argument('--force', action='store_true')
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    if args.command == 'find':
        for i, game in enumerate(games(args.player)):
            h = game.headers
            sides = f'{h.get("White")} {h.get("Black")}'.lower()
            if args.opponent.lower() not in sides or args.event.lower() not in h.get('Event', '').lower():
                continue
            if args.year and not h.get('Date', '').startswith(args.year):
                continue
            if args.wins:
                won = (h.get('Result') == '1-0' and args.player.lower() in h.get('White', '').lower()) or \
                      (h.get('Result') == '0-1' and args.player.lower() in h.get('Black', '').lower())
                if not won:
                    continue
            print(describe(i, game))
        return 0

    game = nth(args.player, args.index)
    found = moments(game, args.seconds)
    chosen = spaced(found, args.count)
    if args.command == 'moments':
        print(describe(args.index, game))
        for ply, san, gap, best in found:
            mark = '*' if (ply, san, gap, best) in chosen else ' '
            print(f'  {mark} ply {ply:3}  {(ply + 1) // 2}{"." if ply % 2 else "..."}{san:8} gap {gap / 100:6.1f}  eval {label(best)}')
        return 0

    target = LESSONS / f'{args.slug}.json'
    if target.exists() and not args.force:
        sys.exit(f'{target} exists (use --force to overwrite)')
    winner_black = game.headers.get('Result') == '0-1'
    orientation = args.orientation or ('black' if winner_black else 'white')
    lesson = skeleton(game, chosen, args.unit, args.order, orientation)
    target.write_text(json.dumps(lesson, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'wrote {target.relative_to(ROOT)} with {len(chosen)} guess stops; fill in every TODO, then run verify_lessons.py {args.slug}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
