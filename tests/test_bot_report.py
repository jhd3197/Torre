"""The after-game bot card and phase strengths: .venv/Scripts/python -m unittest test_bot_report -v"""
import unittest

import chess

from torre.server import api_board
from torre.analysis import bot_report
from torre.analysis import game_stats
from torre.server.routes import BadRequest

# 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6?? 4. Qxf7#: the bot (Black) slips on move 3.
MOVES = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7']
EVALS = [[20, None], [30, None], [25, None], [0, None], [10, None], [5, None], [None, 1], [10000, None]]


class ReportTests(unittest.TestCase):
    def test_phases_slips_and_ratings(self):
        notes = [{'ply': 2, 'slip': False, 'elo': 800}, {'ply': 4, 'slip': True, 'elo': 800}, {'ply': 6, 'slip': True, 'elo': 800}]
        card = bot_report.report(chess.STARTING_FEN, MOVES, 'white', EVALS, notes)
        opening = card['phases']['opening']
        self.assertEqual((opening['you']['moves'], opening['bot']['moves']), (4, 3))
        self.assertIsNone(card['phases']['endgame']['you'])
        self.assertEqual(opening['bot']['blunder'], 1)  # Nf6 walked into mate
        self.assertEqual([s['san'] for s in card['slips']], ['Nc6', 'Nf6'])
        self.assertEqual(card['luckySlips'], 1)  # Nc6 was fine: a random move can be a good one
        self.assertEqual(card['ratings'], {'opening': [800]})
        self.assertGreater(card['overall']['you']['accuracy'], card['overall']['bot']['accuracy'])
        self.assertIsNone(card['retry'])  # you made no mistake to retry

    def test_your_costliest_mistake_is_offered_to_retry(self):
        card = bot_report.report(chess.STARTING_FEN, MOVES, 'black', EVALS)
        self.assertEqual((card['retry']['ply'], card['retry']['san'], card['retry']['class']), (6, 'Nf6', 'blunder'))
        self.assertEqual(chess.Board(card['retry']['fen']).turn, chess.BLACK)

    def test_each_phase_gets_a_grade_and_where_it_starts(self):
        card = bot_report.report(chess.STARTING_FEN, MOVES, 'white', EVALS)
        opening = card['phases']['opening']
        self.assertEqual(opening['you']['grade'], bot_report.phase_grade(opening['you']['accuracy'], 4))
        self.assertEqual(opening['bot']['grade'], bot_report.phase_grade(opening['bot']['accuracy'], 3))
        self.assertIsNone(opening['you']['rating'])  # under 8 moves: no rating for the phase
        self.assertEqual(card['starts'], {'opening': 1, 'middlegame': None, 'endgame': None})
        # A brilliant move in a sharp phase lifts its grade; the flags come from the review's grades.
        flags = [None] * len(MOVES)
        flags[2] = {'brilliant': True, 'class': None}
        lifted = bot_report.report(chess.STARTING_FEN, MOVES, 'white', EVALS, grades=flags)['phases']['opening']['you']
        self.assertEqual(lifted['grade'], 'brilliant' if lifted['accuracy'] >= 85 else opening['you']['grade'])

    def test_phase_grade_ladder(self):
        grade = bot_report.phase_grade
        self.assertIsNone(grade(95, 2))                      # fewer than 3 moves: "–"
        self.assertEqual(grade(95, 5), 'best')
        self.assertEqual(grade(85, 5), 'excellent')
        self.assertEqual(grade(75, 5), 'good')
        self.assertEqual(grade(65, 5), 'inaccuracy')
        self.assertEqual(grade(55, 5), 'mistake')
        self.assertEqual(grade(40, 5), 'blunder')
        self.assertEqual(grade(86, 5, brilliant=1), 'brilliant')
        self.assertEqual(grade(84, 5, brilliant=1), 'excellent')
        self.assertEqual(grade(88, 5, great=1), 'great')

    def test_evals_must_cover_the_game(self):
        with self.assertRaises(ValueError):
            bot_report.report(chess.STARTING_FEN, MOVES, 'white', EVALS[:-1])


class PhaseTests(unittest.TestCase):
    def test_line_phases_move_forward_only(self):
        board = chess.Board()
        self.assertEqual(game_stats.line_phases(board), ['opening'])
        endgame = chess.Board('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1')
        endgame.push_san('e4')
        self.assertEqual(game_stats.line_phases(endgame), ['endgame', 'endgame'])

    def test_phase_elo_is_checked(self):
        good = {'opening': 1200, 'middlegame': 900, 'endgame': 1500}
        self.assertEqual(api_board._phase_elo({'phaseElo': good}), good)
        self.assertIsNone(api_board._phase_elo({}))
        for bad in ({'opening': 1200}, {**good, 'endgame': 99}, {**good, 'opening': 'strong'}, [1200, 900, 1500]):
            with self.subTest(bad), self.assertRaises((BadRequest, ValueError)):
                api_board._phase_elo({'phaseElo': bad})


if __name__ == '__main__':
    unittest.main()
