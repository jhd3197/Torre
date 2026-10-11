"""Trainer checks: .venv/Scripts/python -m unittest test_trainer -v"""
import json
import shutil
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import chess
import chess.engine

from torre.analysis import analyze
from torre.games import masters
from torre.learning import trainer
from torre.analysis.board_view import position

NOW = datetime(2026, 10, 6, 12, tzinfo=timezone.utc)
# 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6?? 4. Qxf7#  (Black, the user, blunders on ply 6)
PGN = '[White "Bot"]\n[Black "Me"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n'
BEFORE_NF6 = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3'


def analysis(**extra):
    return {
        'id': '1', 'scoring_version': analyze.SCORING_VERSION, 'user_color': 'black', 'opponent': 'Bot', 'date': '2026.09.01',
        'evals': [[30, None], [30, None], [25, None], [20, None], [40, None], [30, None], [None, 1], [100_000, None]],
        'best_moves': ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g7g6', 'h5f7', None],
        'moves': [{'ply': 2, 'san': 'e5', 'class': 'inaccuracy'}, {'ply': 4, 'san': 'Nc6', 'class': 'mistake'},
                  {'ply': 6, 'san': 'Nf6', 'class': 'blunder'}],
        **extra,
    }


def score(cp):
    return chess.engine.PovScore(chess.engine.Cp(cp), chess.WHITE)


class FakeEngine:
    """Scores moves from a table (White's point of view), best first."""

    def __init__(self, table):
        self.table = {chess.Move.from_uci(k): v for k, v in table.items()}
        self.calls = []

    def analyse(self, board, limit, multipv=None, root_moves=None):
        self.calls.append('multipv' if multipv else 'root')
        if root_moves:
            return {'score': score(self.table[root_moves[0]]), 'pv': root_moves}
        ranked = sorted(self.table, key=lambda m: -self.table[m] if board.turn else self.table[m])
        return [{'score': score(self.table[m]), 'pv': [m]} for m in ranked[:multipv]]


class MistakeTests(unittest.TestCase):
    def test_stops_at_mistakes_and_blunders_with_the_position_before(self):
        walk = trainer.mistakes(PGN, analysis())
        self.assertEqual([s['ply'] for s in walk['mistakes']], [6])  # Nc6 matched the engine: no stop
        stop = walk['mistakes'][0]
        self.assertEqual((stop['fen'], stop['played_san'], stop['best_san'], stop['class']), (BEFORE_NF6, 'Nf6', 'g6', 'blunder'))
        self.assertEqual(len(walk['moves']), 7)
        self.assertEqual(walk['moves'][5], {'uci': 'g8f6', 'san': 'Nf6'})

    def test_inaccuracies_on_request(self):
        rec = analysis(best_moves=['e2e4', 'c7c5', 'd1h5', 'b8c6', 'f1c4', 'g7g6', 'h5f7', None])
        self.assertEqual([s['ply'] for s in trainer.mistakes(PGN, rec, inaccuracies=True)['mistakes']], [2, 6])

    def test_an_unanalyzed_game_is_refused(self):
        with self.assertRaises(ValueError):
            trainer.mistakes(PGN, None)
        with self.assertRaises(ValueError):
            trainer.mistakes(PGN, analysis(scoring_version=1))

    def test_results_keep_the_best_run(self):
        state = trainer.load_state(Path(tempfile.gettempdir()) / 'no-such-trainer.json')
        trainer.record_mistakes(state, 1, 2, 3, NOW)
        entry = trainer.record_mistakes(state, 1, 1, 3, NOW)
        self.assertEqual((entry['runs'], entry['best'], entry['last'], entry['total']), (2, 2, 1, 3))
        with self.assertRaises(ValueError):
            trainer.record_mistakes(state, 1, 4, 3, NOW)


class GuessTests(unittest.TestCase):
    def setUp(self):
        self.board = chess.Board()

    def guess(self, table, move, expected):
        return trainer.score_guess(FakeEngine(table), self.board, chess.Move.from_uci(move), chess.Move.from_uci(expected))

    def test_the_masters_move_earns_full_points(self):
        result = self.guess({'e2e4': 30, 'd2d4': 25, 'a2a3': -20}, 'e2e4', 'e2e4')
        self.assertEqual((result['points'], result['exact'], result['master_san']), (trainer.GUESS_POINTS, True, 'e4'))

    def test_other_moves_earn_points_scaled_by_loss(self):
        near = self.guess({'e2e4': 30, 'd2d4': 25, 'a2a3': -20}, 'd2d4', 'e2e4')
        self.assertEqual((near['loss'], near['points'], near['exact']), (5, 9, False))
        far = self.guess({'e2e4': 30, 'd2d4': 25, 'a2a3': -400}, 'a2a3', 'e2e4')
        self.assertEqual((far['loss'], far['points']), (430, 0))
        self.assertEqual(trainer.guess_points(125), 4)

    def test_a_move_better_than_the_masters_loses_nothing(self):
        result = self.guess({'e2e4': 30, 'd2d4': 25, 'a2a3': -20}, 'e2e4', 'd2d4')
        self.assertEqual((result['loss'], result['points'], result['best_san']), (0, trainer.GUESS_NEAR, 'e4'))

    def test_only_moves_are_critical(self):
        self.assertTrue(self.guess({'e2e4': 300, 'd2d4': 50}, 'e2e4', 'e2e4')['critical'])
        self.assertFalse(self.guess({'e2e4': 300, 'd2d4': 250}, 'e2e4', 'e2e4')['critical'])
        self.assertFalse(self.guess({'e2e4': 300, 'd2d4': 50}, 'e2e4', 'd2d4')['critical'])  # the master missed it

    def test_mates_are_capped(self):
        board = chess.Board()
        self.assertEqual(trainer._cp(chess.engine.PovScore(chess.engine.Mate(3), chess.WHITE), board), trainer.GUESS_CAP)

    def test_best_scores(self):
        state = {'mistakes': {}, 'masters': {}}
        self.assertTrue(trainer.record_guess(state, 'Ding', 4, 50, 100, NOW)['improved'])
        self.assertFalse(trainer.record_guess(state, 'Ding', 4, 40, 100, NOW)['improved'])
        entry = trainer.record_guess(state, 'Ding', 4, 70, 100, NOW)
        self.assertEqual((entry['best'], entry['runs'], entry['improved']), (70, 3, True))


MASTER_PGN = '''[Event "Training"]
[Date "1990.01.01"]
[White "Tester,Ann"]
[Black "Other,Bob"]
[Result "1-0"]

1. e4 {a comment} e5 2. Nf3 (2. f4 exf4) Nc6 3. Bb5 1-0

[Event "Training"]
[Date "1991.01.01"]
[White "Third,Cy"]
[Black "Tester,Ann"]
[Result "0-1"]

1. d4 d5 0-1

[Event "Training"]
[Date "1992.01.01"]
[White "Tester,A"]
[Black "Other,Bob"]
[Result "1/2-1/2"]

1. c4 1/2-1/2
'''


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir)
        old = masters.DATA_DIR
        masters.use_data_dir(self.dir)
        self.addCleanup(masters.use_data_dir, old)
        (self.dir / 'masters' / 'pgn').mkdir(parents=True)
        (self.dir / 'masters' / 'pgn' / 'Testmaster.pgn').write_text(MASTER_PGN, encoding='utf-8')
        self.files = {'games.jsonl': [{'id': '1', 'pgn': PGN}], 'analysis.jsonl': [analysis()]}

    def get(self, path, query=None):
        return trainer.get(path, query or {}, lambda name: self.files.get(name, []), self.dir)

    def test_a_legends_games_and_one_game(self):
        body, status = self.get('/api/trainer/masters/Testmaster')
        self.assertEqual(status, 200)
        self.assertEqual([(g['side'], g['moves'], g['year']) for g in body['games']], [('white', 3, 1990), ('black', 1, 1991), ('white', 1, 1992)])
        body, status = self.get('/api/trainer/masters/Testmaster/0')
        self.assertEqual(status, 200)
        self.assertEqual([m['san'] for m in body['moves']], ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])  # the variation left out
        self.assertEqual((body['side'], body['white'], body['black']), ('white', 'Ann Tester', 'Bob Other'))
        self.assertEqual(self.get('/api/trainer/masters/Testmaster/9')[1], 400)
        self.assertEqual(self.get('/api/trainer/masters/Nobody')[1], 404)

    def test_a_walkthrough_and_its_saved_result(self):
        body, status = self.get('/api/trainer/mistakes/1')
        self.assertEqual((status, len(body['mistakes']), body['progress']), (200, 1, None))
        self.assertEqual(self.get('/api/trainer/mistakes/2')[1], 404)
        entry, status = trainer.post('/api/trainer/mistakes/result', {'gameId': 1, 'found': 1, 'total': 1}, self.dir, None, position)
        self.assertEqual((status, entry['best']), (200, 1))
        self.assertEqual(self.get('/api/trainer/mistakes/1')[0]['progress']['best'], 1)
        self.assertEqual(json.loads((self.dir / 'trainer.json').read_text())['mistakes']['1']['runs'], 1)

    def test_guesses_need_stockfish_and_best_scores_show_in_the_listing(self):
        body, status = trainer.post('/api/trainer/guess', {'moves': [], 'move': 'e2e4', 'expected': 'e2e4'}, self.dir, None, position)
        self.assertEqual(status, 503)
        engine = FakeEngine({'e2e4': 30, 'd2d4': 25})
        body, status = trainer.post('/api/trainer/guess', {'moves': [], 'move': 'd2d4', 'expected': 'e2e4'}, self.dir,
                                    lambda work: work(engine), position)
        self.assertEqual((status, body['points']), (200, 9))
        trainer.post('/api/trainer/masters/result', {'masterId': 'Testmaster', 'index': 1, 'score': 12, 'max': 20}, self.dir, None, position)
        games = self.get('/api/trainer/masters/Testmaster')[0]['games']
        self.assertEqual([g['best'] for g in games], [None, 12, None])


if __name__ == '__main__':
    unittest.main()
