"""The estimated game rating (game_rating.py) and the tool that fits its curves (fit_rating.py)."""
import json
import random
import shutil
import tempfile
import unittest
from pathlib import Path

import chess

from torre.analysis import bot_report
from torre.analysis import game_export
from torre.analysis import game_rating
from torre.tools import fit_rating



def _line(plies=80, seed=3):
    """A game of `plies` legal moves that never ends on the board (a seeded random walk)."""
    rng, board, line = random.Random(seed), chess.Board(), []
    while len(line) < plies:
        moves = list(board.legal_moves)
        rng.shuffle(moves)
        for move in moves:
            board.push(move)
            if board.outcome() is None and not board.can_claim_draw():
                line.append(move.uci())
                break
            board.pop()
    return line


# A 40-move game whose evals barely move: both sides play it well.
LINE = _line()
STEADY = [[20, None]] * (len(LINE) + 1)


def stats(accuracy, acpl=40, moves=30):
    return {'accuracy': accuracy, 'acpl': acpl, 'moves': moves}


class SpeedTests(unittest.TestCase):
    def test_speed_follows_the_estimated_game_length(self):
        self.assertEqual(game_rating.speed_of('60+0'), 'bullet')
        self.assertEqual(game_rating.speed_of('120+1'), 'bullet')  # 160 s
        self.assertEqual(game_rating.speed_of('180+0'), 'blitz')
        self.assertEqual(game_rating.speed_of('180+2'), 'blitz')
        self.assertEqual(game_rating.speed_of('600+5'), 'rapid')
        self.assertEqual(game_rating.speed_of('1800+0'), 'classical')
        self.assertEqual(game_rating.speed_of('-'), 'classical')
        self.assertEqual(game_rating.speed_of('1/259200'), 'classical')
        for unknown in (None, '', '?', 'abc'):
            self.assertIsNone(game_rating.speed_of(unknown))


class EstimateTests(unittest.TestCase):
    def test_a_better_game_never_reads_lower(self):
        for speed in (*game_rating.SPEEDS, None):
            values = [game_rating.estimate(stats(acc, acpl), speed) for acc, acpl in ((55, 160), (70, 100), (80, 60), (90, 30), (97, 10))]
            self.assertEqual(values, sorted(values), speed)
            self.assertTrue(all(v % 50 == 0 for v in values))
            low, high = game_rating.RATING['range']
            self.assertTrue(all(low <= v <= high for v in values))

    def test_too_few_moves_is_refused(self):
        self.assertIsNone(game_rating.estimate(stats(85, moves=9), 'blitz'))
        self.assertIsNotNone(game_rating.estimate(stats(85, moves=10), 'blitz'))
        self.assertIsNone(game_rating.estimate({'accuracy': None, 'acpl': None, 'moves': 0}, 'blitz'))

    def test_a_known_rating_anchors_the_estimate_within_the_clamp(self):
        clamp = game_rating.RATING['anchor']['clamp']
        for rating in (800, 1500, 2200):
            for accuracy, acpl in ((40, 250), (75, 70), (99, 2)):
                value = game_rating.estimate(stats(accuracy, acpl), 'rapid', rating)
                self.assertLessEqual(abs(value - rating), clamp + 25)
        self.assertGreater(game_rating.estimate(stats(97, 8), 'blitz', 1500), 1500)
        self.assertLess(game_rating.estimate(stats(50, 200), 'blitz', 1500), 1500)

    def test_a_game_cut_short_is_refused_but_a_quick_mate_is_not(self):
        board = chess.Board()
        moves = [chess.Move.from_uci(u) for u in LINE[:24]]  # 12 moves, then a resignation
        self.assertEqual(game_rating.game_ratings(STEADY[:25], board, moves, '600+0'),
                         {'speed': 'rapid', 'white': None, 'black': None})
        full = [chess.Move.from_uci(u) for u in LINE]
        rated = game_rating.game_ratings(STEADY, board, full, '600+0', {'white': '?', 'black': 1600})
        self.assertIsNotNone(rated['white'])
        self.assertLessEqual(abs(rated['black'] - 1600), game_rating.RATING['anchor']['clamp'] + 25)
        # Scholar's mate ends on the board: not refused for being short, only for the moves made.
        mate = [chess.Move.from_uci(u) for u in ('e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7')]
        self.assertEqual(game_rating.game_ratings([[20, None]] * 8, board, mate)['white'], None)

    def test_acpl_counts_a_mate_as_the_cap(self):
        # A mate found a move late costs 1000 at most, not the ACPL statistics' 2500.
        found = game_rating.side_stats([[None, 2], [None, 3], [None, 1], [100_000, None]])
        self.assertLessEqual(found['white']['acpl'], 1000)


class GameRatingInReportsTests(unittest.TestCase):
    def test_review_export_and_bot_card_carry_the_estimate(self):
        board, san = chess.Board(), []
        for i, uci in enumerate(LINE):
            move = chess.Move.from_uci(uci)
            san.append((f'{i // 2 + 1}. ' if i % 2 == 0 else '') + board.san(move))
            board.push(move)
        pgn = '[TimeControl "600+0"]\n[WhiteElo "1500"]\n[BlackElo "?"]\n\n' + ' '.join(san) + ' *'
        from torre.analysis import analyze
        report = game_export.game_report(pgn, {'scoring_version': analyze.SCORING_VERSION, 'evals': STEADY})
        rating = report['quality']['estimated_rating']
        self.assertEqual(rating['speed'], 'rapid')
        self.assertLessEqual(abs(rating['white'] - 1500), game_rating.RATING['anchor']['clamp'] + 25)
        self.assertIsNotNone(rating['black'])
        card = bot_report.report(chess.STARTING_FEN, LINE, 'white', STEADY)
        self.assertEqual(set(card['rating']), {'you', 'bot'})
        self.assertIsNotNone(card['rating']['you'])
        record = {'id': '1', 'user_color': 'black', 'type': 'computer', 'pgn': pgn, 'opp_rating': 1500}
        estimates = game_rating.for_game(record, {'evals': STEADY})
        self.assertEqual(set(estimates), {'user', 'opp', 'speed'})
        self.assertIsNone(game_rating.for_game(record, {'evals': STEADY[:5]}))


class FitTests(unittest.TestCase):
    def synthetic(self, n=3000, seed=7):
        """Players whose game score rises with rating, plus noise, as in real games."""
        rng = random.Random(seed)
        out = []
        for _ in range(n):
            rating = rng.gauss(1600, 300)
            accuracy = min(99.0, max(30.0, 40 + rating / 40 + rng.gauss(0, 6)))
            acpl = max(5.0, 220 - rating / 12 + rng.gauss(0, 20))
            out.append({'speed': 'blitz', 'accuracy': accuracy, 'acpl': acpl, 'rating': round(rating)})
        return out

    def test_the_fit_is_monotone_and_puts_each_band_in_place(self):
        samples = self.synthetic()
        curve = fit_rating.fit(samples)
        self.assertGreaterEqual(curve['b'], 0)
        self.assertLessEqual(curve['c'], 0)
        for low in (1200, 1400, 1600, 1800):
            band = sorted(fit_rating.predict(curve, s) for s in samples if low <= s['rating'] < low + 200)
            self.assertLess(abs(band[len(band) // 2] - (low + 100)), 120, low)
        curves, lines = fit_rating.fit_all(samples, minimum=500)
        self.assertEqual(set(curves), {*game_rating.SPEEDS, 'unknown'})
        self.assertIn('MAE', lines[1])

    def test_write_replaces_only_the_curves(self):
        folder = Path(tempfile.mkdtemp())
        try:
            target = folder / 'grading.json'
            shutil.copy(fit_rating.GRADING_FILE, target)
            before = json.loads(target.read_text(encoding='utf-8'))
            curves = {name: {'b': 1.0, 'c': -1.0, 'p': 0.5, 'q': 0.001} for name in (*game_rating.SPEEDS, 'unknown')}
            fit_rating.write(curves, target)
            after = json.loads(target.read_text(encoding='utf-8'))
            self.assertEqual(after['gameRating']['curves'], curves)
            self.assertEqual({k: v for k, v in after.items() if k != 'gameRating'}, {k: v for k, v in before.items() if k != 'gameRating'})
        finally:
            shutil.rmtree(folder)

    def test_pgn_samples_read_eval_comments(self):
        folder = Path(tempfile.mkdtemp())
        try:
            board, parts = chess.Board(), []
            for i, uci in enumerate(LINE):
                move = chess.Move.from_uci(uci)
                parts.append((f'{i // 2 + 1}. ' if i % 2 == 0 else '') + board.san(move) + ' { [%eval 0.2] }')
                board.push(move)
            path = folder / 'games.pgn'
            path.write_text('[Event "Rated"]\n[WhiteElo "1700"]\n[BlackElo "1650"]\n[TimeControl "180+0"]\n\n'
                            + ' '.join(parts) + ' 1/2-1/2\n\n', encoding='utf-8')
            samples = fit_rating.pgn_samples(path)
            self.assertEqual(sorted(s['rating'] for s in samples), [1650, 1700])
            self.assertTrue(all(s['speed'] == 'blitz' and s['accuracy'] > 90 for s in samples))
        finally:
            shutil.rmtree(folder)


if __name__ == '__main__':
    unittest.main()
