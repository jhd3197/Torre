"""Scoring checks: .venv/Scripts/python -m unittest test_scoring -v"""
import math
import unittest

import chess
import chess.engine

from torre.analysis import analyze
from torre.analysis import scoring
from torre.analysis.scoring import BLUNDER, INACCURACY, MISTAKE


class WinPercentTests(unittest.TestCase):
    def test_lichess_curve(self):
        self.assertAlmostEqual(scoring.win_pct(0), 50)
        self.assertAlmostEqual(scoring.win_pct(300), 50 + 50 * (2 / (1 + math.exp(-0.00368208 * 300)) - 1))
        self.assertAlmostEqual(scoring.win_pct(-300), 100 - scoring.win_pct(300))

    def test_ceiling_and_mate(self):
        self.assertAlmostEqual(scoring.win_pct(5000), scoring.win_pct(1000))
        self.assertAlmostEqual(scoring.win_pct(None, 3), scoring.win_pct(1000))
        self.assertAlmostEqual(scoring.win_pct(None, -1), scoring.win_pct(-1000))


class AccuracyTests(unittest.TestCase):
    def test_move_accuracy(self):
        self.assertEqual(scoring.move_accuracy(50, 50), 100)
        self.assertEqual(scoring.move_accuracy(40, 60), 100)
        expected = 103.1668100711649 * math.exp(-0.04354415386753951 * 20) - 3.166924740191411 + 1
        self.assertAlmostEqual(scoring.move_accuracy(60, 40), expected)
        self.assertEqual(scoring.move_accuracy(100, 0), 0)

    def test_flawless_game(self):
        self.assertEqual(scoring.game_accuracy([50] * 41), {"white": 100, "black": 100})

    def test_one_blunder_costs_only_the_blunderer(self):
        timeline = [50] * 21 + [10] * 20  # ply 21 (White) drops 40 points
        acc = scoring.game_accuracy(timeline)
        self.assertLess(acc["white"], 90)
        self.assertEqual(acc["black"], 100)

    def test_black_to_start(self):
        acc = scoring.game_accuracy([50, 90], white_starts=False)
        self.assertIsNone(acc["white"])
        self.assertLess(acc["black"], 50)

    def test_harmonic_mean_punishes_zero(self):
        timeline = [50, 50, 100, 0, 0]  # Black's second move goes from 100% to 0%
        self.assertLess(scoring.game_accuracy(timeline)["black"], 60)


class MissedMateTests(unittest.TestCase):
    def test_a_forced_mate_let_go_is_missed_even_while_still_winning(self):
        self.assertEqual(scoring.missed_mate((None, 4), (1200, None), True), 4)
        self.assertEqual(scoring.missed_mate((None, -3), (-800, None), False), 3)  # Black's mate, White POV
        # The Lichess grade for it is no worse than an inaccuracy: this is why it needs its own rule.
        self.assertIn(scoring.judge((None, 4), (1200, None), True), (None, INACCURACY))

    def test_keeping_or_playing_the_mate_is_not_a_miss(self):
        self.assertIsNone(scoring.missed_mate((None, 4), (None, 5), True))       # a slower mate is still a mate
        self.assertIsNone(scoring.missed_mate((None, 1), (100_000, None), True))  # the move mated (analyze.py's score)
        self.assertIsNone(scoring.missed_mate((None, 1), (None, 0), True))
        self.assertIsNone(scoring.missed_mate((None, 9), (300, None), True))      # too long to count
        self.assertIsNone(scoring.missed_mate((500, None), (100, None), True))   # no mate to miss


class JudgmentTests(unittest.TestCase):
    def test_winning_chance_thresholds(self):
        cases = [(-40, None), (-100, INACCURACY), (-130, MISTAKE), (-300, BLUNDER)]
        for after, expected in cases:
            with self.subTest(after=after):
                self.assertEqual(scoring.judge([0, None], [after, None], True), expected)
                self.assertEqual(scoring.judge([0, None], [-after, None], False), expected)

    def test_small_drop_when_already_winning(self):
        self.assertIsNone(scoring.judge([900, None], [800, None], True))

    def test_walking_into_mate(self):
        self.assertEqual(scoring.lichess_judge([0, None], [None, -2], True), BLUNDER)
        self.assertEqual(scoring.lichess_judge([-800, None], [None, -2], True), MISTAKE)
        self.assertEqual(scoring.lichess_judge([-1200, None], [None, -2], True), INACCURACY)
        self.assertEqual(scoring.lichess_judge([0, None], [None, 2], False), BLUNDER)

    def test_losing_a_forced_mate(self):
        self.assertEqual(scoring.lichess_judge([None, 3], [1200, None], True), INACCURACY)
        self.assertEqual(scoring.lichess_judge([None, 3], [800, None], True), MISTAKE)
        self.assertEqual(scoring.lichess_judge([None, 3], [100, None], True), BLUNDER)
        self.assertEqual(scoring.lichess_judge([None, 3], [None, -1], True), BLUNDER)

    def test_a_game_left_as_decided_as_it_was_is_at_most_an_inaccuracy(self):
        self.assertEqual(scoring.judge([-800, None], [None, -2], True), INACCURACY)  # lost before and after
        self.assertEqual(scoring.judge([None, 8], [690, None], True), INACCURACY)    # still clearly winning
        self.assertEqual(scoring.judge([None, -8], [-690, None], False), INACCURACY)
        self.assertEqual(scoring.judge([None, 3], [500, None], True), BLUNDER)       # under 90% after
        self.assertEqual(scoring.judge([0, None], [None, -2], True), BLUNDER)
        self.assertEqual(scoring.judge([900, None], [200, None], True), BLUNDER)

    def test_mate_delayed_or_still_lost(self):
        self.assertIsNone(scoring.judge([None, 3], [None, 5], True))
        self.assertIsNone(scoring.judge([None, -3], [None, -2], True))


class StaticExchangeTests(unittest.TestCase):
    def test_hanging_and_defended(self):
        board = chess.Board("4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1")
        self.assertEqual(scoring.see(board, chess.D5), 3)
        board = chess.Board("4k3/8/4p3/3p4/8/8/8/3RK3 w - - 0 1")
        self.assertEqual(scoring.see(board, chess.D5), 0)

    def test_pinned_defender_does_not_count(self):
        pinned = chess.Board("4k3/4n3/8/8/8/1B6/8/K3R3 w - - 0 1")
        self.assertEqual(scoring.material_offered(pinned, chess.Move.from_uci("b3d5")), 0)
        free = chess.Board("4k3/4n3/8/8/8/1B6/8/K6R w - - 0 1")
        self.assertEqual(scoring.material_offered(free, chess.Move.from_uci("b3d5")), 3)

    def test_trades_are_not_offers(self):
        board = chess.Board("4k3/8/5n2/3n4/8/4N3/8/4K3 w - - 0 1")
        self.assertEqual(scoring.material_offered(board, chess.Move.from_uci("e3d5")), 0)
        board = chess.Board("4k3/8/8/3n4/8/8/8/Q3K3 w - - 0 1")
        self.assertEqual(scoring.material_offered(board, chess.Move.from_uci("a1d4")), 0)

    def test_exchange_sacrifice(self):
        board = chess.Board("4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1")
        self.assertEqual(scoring.material_offered(board, chess.Move.from_uci("d1d5")), 2)


class BrilliantTests(unittest.TestCase):
    GREEK_GIFT = "r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 4 8"
    BXH7 = chess.Move.from_uci("d3h7")

    def test_greek_gift(self):
        board = chess.Board(self.GREEK_GIFT)
        self.assertEqual(scoring.material_offered(board, self.BXH7), 2)
        self.assertTrue(scoring.is_brilliant(board, self.BXH7, 70, 70))

    def test_unsound_or_unnecessary_sacrifice(self):
        board = chess.Board(self.GREEK_GIFT)
        self.assertFalse(scoring.is_brilliant(board, self.BXH7, 70, 60))   # engine disagrees
        self.assertFalse(scoring.is_brilliant(board, self.BXH7, 45, 45))   # still worse after it
        self.assertFalse(scoring.is_brilliant(board, self.BXH7, 96, 96))   # already won

    def test_quiet_best_move_is_not_brilliant(self):
        board = chess.Board(self.GREEK_GIFT)
        self.assertFalse(scoring.is_brilliant(board, chess.Move.from_uci("e1g1"), 70, 70))

    def test_checkmate_is_not_a_sacrifice(self):
        board = chess.Board("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1")
        self.assertFalse(scoring.is_brilliant(board, chess.Move.from_uci("a1a8"), 80, 80))


class KeyMomentTests(unittest.TestCase):
    def test_brilliants_then_biggest_drops_in_game_order(self):
        moves = [
            {"ply": 1, "class": None, "brilliant": False, "win_before": 50, "win_after": 50},
            {"ply": 3, "class": INACCURACY, "brilliant": False, "win_before": 50, "win_after": 44},
            {"ply": 5, "class": BLUNDER, "brilliant": False, "win_before": 50, "win_after": 10},
            {"ply": 7, "class": None, "brilliant": True, "win_before": 60, "win_after": 60},
            {"ply": 9, "class": MISTAKE, "brilliant": False, "win_before": 50, "win_after": 35},
        ]
        self.assertEqual([m["ply"] for m in scoring.key_moments(moves, limit=3)], [5, 7, 9])


class FakeEngine:
    """Every position is equal and the engine always 'prefers' the first legal move."""
    def analyse(self, board, limit, multipv=1):
        return [{"score": chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE),
                 "pv": [move]} for move in list(board.legal_moves)[:multipv]]


class AnalyzeGameTests(unittest.TestCase):
    def test_record_shape_and_mating_move(self):
        rec = {"id": 1, "user_color": "white", "user_result": 1,
               "pgn": "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0"}
        result = analyze.analyze_game(FakeEngine(), rec, depth=1)
        self.assertEqual(result["scoring_version"], analyze.SCORING_VERSION)
        self.assertEqual(len(result["evals"]), 8)
        self.assertEqual(result["evals"][-1], [analyze.MATED_CP, None])
        self.assertEqual(result["user_move_count"], 4)
        self.assertIsNone(result["moves"][-1]["class"])
        self.assertEqual(result["moves"][-1]["accuracy"], 100)
        self.assertIsNotNone(result["accuracy"])
        for key in ("inaccuracy", "mistake", "blunder", "best", "brilliant", "phase_counts", "worst_moves", "key_moments"):
            self.assertIn(key, result)


if __name__ == "__main__":
    unittest.main()


class GradeTests(unittest.TestCase):
    def test_a_move_gets_one_grade_best_first(self):
        self.assertEqual(scoring.grade({'brilliant': True, 'class': None, 'best': True, 'accuracy': 100}), 'brilliant')
        self.assertEqual(scoring.grade({'class': 'mistake', 'best': False, 'accuracy': 40}), 'mistake')
        self.assertEqual(scoring.grade({'class': None, 'best': True, 'accuracy': 100}), 'best')
        # The eight-grade system keeps near-best non-errors in Good.
        self.assertEqual(scoring.grade({'class': None, 'best': False, 'accuracy': 95}), 'good')
        self.assertEqual(scoring.grade({'class': None, 'best': False, 'accuracy': 80}), 'good')
        self.assertEqual(scoring.grade({}), 'good')


class RealDateTests(unittest.TestCase):
    def test_a_placeholder_date_gives_way_to_the_real_day(self):
        from torre.games.chesscom_common import real_date
        self.assertEqual(real_date({'Date': '2025.06.12'}), '2025.06.12')
        self.assertEqual(real_date({'Date': '1970.01.01', 'EndDate': '2025.06.12'}), '2025.06.12')
        self.assertEqual(real_date({'Date': '????.??.??', 'UTCDate': '2024.03.01'}), '2024.03.01')
        self.assertEqual(real_date({'Date': '1970.01.01'}, 1749761865), '2025.06.12')
        self.assertIsNone(real_date({'Date': '1970.01.01'}))
