"""Check the chess in lessons/*.json with Stockfish before they ship.

lessons.py only checks that moves are legal. This checks that they are good:

    play    every move the reader must find is Stockfish's choice, or close to it
            (an error), and no other move is just as good (a warning: the reader
            who plays it would be told "wrong"). Replies that are much weaker than
            the best defence are warned about too.
    guess   every move the reader must guess is reported with how it compares to
            Stockfish's choice; a game move that loses a lot is a warning.

    python verify_lessons.py                  # every lesson
    python verify_lessons.py knight-fork pins # some lessons
    python verify_lessons.py --seconds 1.0    # think longer per position

Exits with 1 when any lesson has an error.
"""

import argparse
import json
import sys

import chess
import chess.engine

from torre.learning import lessons
from torre.analysis.engine_service import ENGINE_PATH

MATE = 100_000
WORSE = 80      # centipawns: a reader's move this much worse than the best is an error
TIED = 30       # another move within this of the lesson's move makes the step ambiguous
WEAK_REPLY = 150  # a reply this much worse than the best defence is suspicious
LOSING = 200    # a guessed game move that drops this much is worth a look


def score(info, turn):
    """The score for the side to move, mates as large numbers (sooner is bigger)."""
    pov = info['score'].pov(turn)
    mate = pov.mate()
    if mate is not None:
        return MATE - abs(mate) if mate > 0 else -MATE + abs(mate)
    return pov.score()


def label(value):
    if value >= MATE - 500:
        return f'mate in {MATE - value}'
    if value <= -MATE + 500:
        return f'mated in {value + MATE}'
    return f'{value / 100:+.2f}'


WINNING = 400   # both moves at least this good: either wins, so neither is "much worse"
DECISIVE = 600  # a lead this big wins; past it only keeping the win matters
CLEAR = 250     # past this lead, several winning moves are normal (technique), not an ambiguous step


def too_weak(mine, best):
    """A move that throws away a real part of the best move's value (or the win itself)."""
    if best >= WINNING and mine >= WINNING:
        return False  # both win clearly; the margin between two wins is engine noise for a lesson
    if best >= DECISIVE:
        return mine < DECISIVE // 2
    return best - mine > WORSE


class Checker:
    def __init__(self, engine, seconds):
        self.engine, self.seconds = engine, seconds

    def ranked(self, board, multipv=4):
        """[(move, score)] best first, for the side to move."""
        infos = self.engine.analyse(board, chess.engine.Limit(time=self.seconds), multipv=multipv)
        return [(info['pv'][0], score(info, board.turn)) for info in infos if info.get('pv')]

    def of(self, board, move):
        """The score of one move for the side playing it."""
        info = self.engine.analyse(board, chess.engine.Limit(time=self.seconds), root_moves=[move])
        return score(info, board.turn)

    def reader_move(self, board, move, accepted, where):
        """Problems with a move the reader must find in `board`."""
        errors, warnings = [], []
        after = board.copy(stack=False)
        after.push(move)
        if after.is_checkmate():
            return errors, warnings  # any mate is accepted by the page
        ranked = self.ranked(board)
        best_move, best = ranked[0]
        # One search ranks both moves when it can; separate searches disagree by noise.
        mine = next((value for m, value in ranked if m == move), None)
        if mine is None:
            mine = self.of(board, move)
        if best_move != move and too_weak(mine, best):
            errors.append(f'{where}: {board.san(move)} ({label(mine)}) is much worse than {board.san(best_move)} ({label(best)}).')
        for other, value in ranked:
            if other in accepted:
                continue
            both_mate = value >= MATE - 500 and mine >= MATE - 500
            if abs(mine - value) <= TIED and not both_mate and abs(mine) < CLEAR:
                warnings.append(f'{where}: {board.san(other)} ({label(value)}) is about as good as {board.san(move)} '
                                f'({label(mine)}); list it as an alternative or pick a clearer position.')
            elif both_mate and other != move:
                pass  # a different mate is fine only on the last move, which the page accepts anyway
        return errors, warnings

    def reply(self, board, move, where):
        ranked = self.ranked(board, multipv=1)
        if not ranked:
            return []
        best_move, best = ranked[0]
        if best_move == move:
            return []
        mine = self.of(board, move)
        if best - mine > WEAK_REPLY and best < DECISIVE and mine > -DECISIVE:
            return [f'{where}: the reply {board.san(move)} ({label(mine)}) is much weaker than {board.san(best_move)} '
                    f'({label(best)}); the reader is not shown the real defence.']
        return []

    def play(self, step, where):
        """The main line and each branch; a move two lines share is checked once."""
        errors, warnings, checked = [], [], set()
        for n, line in enumerate([step, *step.get('branches', [])]):
            board = chess.Board(step['fen'])
            label_of = where if n == 0 else f'{where}, branch {n}'
            moves = line['moves']
            for i, move in enumerate(moves):
                uci = chess.Move.from_uci(move['uci'])
                key = (board.fen(), uci, i == len(moves) - 1)
                if key not in checked:
                    checked.add(key)
                    if i % 2 == 0:
                        last = i == len(moves) - 1
                        accepted = {uci} | ({chess.Move.from_uci(a['uci']) for a in line['alternatives']} if last else set())
                        e, w = self.reader_move(board, uci, accepted, f'{label_of}, move {i + 1} ({move["san"]})')
                        errors += e
                        warnings += w
                    else:
                        warnings += self.reply(board, uci, f'{label_of}, reply {i + 1}')
                board.push(uci)
        return errors, warnings

    def guess(self, step, where):
        board = chess.Board(step['fen'])
        stops = {g['ply']: g for g in step['guesses']}
        notes = []
        for ply, move in enumerate(step['moves'], start=1):
            uci = chess.Move.from_uci(move['uci'])
            if ply in stops:
                ranked = self.ranked(board, multipv=3)
                best_move, best = ranked[0]
                mine = next((value for m, value in ranked if m == uci), None)
                if mine is None:
                    mine = self.of(board, uci)
                accepted = {uci} | {chess.Move.from_uci(a['uci']) for a in stops[ply]['also']}
                ties = [board.san(m) for m, v in ranked if m not in accepted and abs(v - mine) <= TIED and abs(mine) < CLEAR]
                text = f'{where}, guess at ply {ply} ({move["san"]}): {label(mine)}, Stockfish {board.san(best_move)} {label(best)}'
                if ties:
                    text += f'; also good: {", ".join(ties)} (consider listing in "also")'
                notes.append(('warning' if (best_move != uci and best - mine > LOSING and mine < DECISIVE) or ties else 'info', text))
            board.push(uci)
        return notes


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('slugs', nargs='*')
    parser.add_argument('--seconds', type=float, default=0.4, help='engine time per position')
    parser.add_argument('--json', action='store_true', help='print the findings as JSON')
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    loaded, problems = lessons.load_all()
    if problems:
        print('Lessons that do not load (fix these first):', *problems, sep='\n  ')
    slugs = args.slugs or list(loaded)
    unknown = [s for s in slugs if s not in loaded]
    if unknown:
        print(f'Unknown or broken lessons: {", ".join(unknown)}')
        return 1
    report = {}
    with chess.engine.SimpleEngine.popen_uci(str(ENGINE_PATH)) as engine:
        checker = Checker(engine, args.seconds)
        for slug in slugs:
            errors, warnings, info = [], [], []
            for i, step in enumerate(loaded[slug]['steps']):
                where = f'step {i + 1} "{step["id"]}"'
                if step['kind'] == 'play':
                    e, w = checker.play(step, where)
                    errors += e
                    warnings += w
                elif step['kind'] == 'guess':
                    for level, text in checker.guess(step, where):
                        (warnings if level == 'warning' else info).append(text)
            report[slug] = {'errors': errors, 'warnings': warnings, 'info': info}
            if not args.json:
                status = 'ERROR' if errors else 'warn' if warnings else 'ok'
                print(f'[{status}] {slug}')
                for line in errors:
                    print(f'   error: {line}')
                for line in warnings:
                    print(f'   warning: {line}')
                for line in info:
                    print(f'   {line}')
    if args.json:
        print(json.dumps(report, indent=1))
    return 1 if any(r['errors'] for r in report.values()) or problems else 0


if __name__ == '__main__':
    sys.exit(main())
