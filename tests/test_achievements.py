"""Award detectors and tiers: .venv/Scripts/python -m unittest test_achievements -v"""
import json
import tempfile
import unittest
from pathlib import Path

import chess

from torre.learning import achievements
def facts(fen, *moves, me=chess.WHITE):
    board = chess.Board(fen)
    return achievements.scan(board, [chess.Move.from_uci(m) for m in moves], me)


class DetectorTests(unittest.TestCase):
    def test_knight_fork_of_king_and_rook(self):
        # Nc7+ forks the king on e8 and the rook on a8.
        self.assertEqual(facts('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'd5c7')['fork'], 1)

    def test_a_knight_attacking_pawns_is_no_fork(self):
        self.assertEqual(facts('4k3/8/2p1p3/8/3N4/8/8/4K3 w - - 0 1', 'd4c2').get('fork', 0), 0)

    def test_bishop_pins_knight_to_king(self):
        self.assertEqual(facts('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', 'f1b5')['pin'], 1)

    def test_rook_skewers_king_and_rook(self):
        # Re1+ hits the king on e5; the rook on e8 behind it falls.
        self.assertEqual(facts('4r3/8/8/4k3/8/8/8/R5K1 w - - 0 1', 'a1e1')['skewer'], 1)

    def test_discovered_check(self):
        # The knight steps off the e-file and the rook on e1 checks.
        self.assertEqual(facts('4k3/8/8/8/4N3/8/8/4RK2 w - - 0 1', 'e4c5')['discovery'], 1)

    def test_back_rank_mate(self):
        result = facts('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8')
        self.assertEqual((result['checkmate'], result['back_rank']), (1, 1))

    def test_outpost_and_passed_pawn(self):
        # Nc5 is guarded by the d4 pawn; a black pawn on b7 could still chase it with ...b6.
        self.assertEqual(facts('4k3/8/8/8/3P4/1N6/8/4K3 w - - 0 1', 'b3c5')['outpost'], 1)
        self.assertEqual(facts('4k3/1p6/8/8/3P4/1N6/8/4K3 w - - 0 1', 'b3c5').get('outpost', 0), 0)
        self.assertEqual(facts('4k3/8/8/1P6/8/8/8/4K3 w - - 0 1', 'b5b6')['passed_pawn'], 1)

    def test_castling_and_promotion(self):
        self.assertEqual(facts('4k3/8/8/8/8/8/8/4K2R w K - 0 1', 'e1g1')['castled'], 1)
        self.assertEqual(facts('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', 'b7b8q')['promotion'], 1)

    def test_only_your_moves_count(self):
        # Black forks, but the scan is from White's side.
        self.assertEqual(facts('4k3/8/8/8/3n4/8/8/R3K3 b - - 0 1', 'd4c2').get('fork', 0), 0)


class TierTests(unittest.TestCase):
    def test_levels_follow_the_thresholds(self):
        self.assertEqual([achievements.level('fork', n) for n in (0, 9, 10, 100, 400, 1000)], [0, 0, 1, 2, 3, 4])

    def test_improvements_report_new_levels_only(self):
        before = {award: 0 for award in achievements.AWARDS}
        after = {**before, 'fork': 10, 'legend': 5}
        self.assertEqual(achievements.improvements(before, after), [{'id': 'fork', 'title': 'Fork', 'tier': 'unlocked'}])

    def test_counts_combine_played_games_and_puzzles(self):
        with tempfile.TemporaryDirectory() as folder:
            mate = ['f2f3', 'e7e5', 'g2g4', 'd8h4']  # Fool's mate, played as Black
            Path(folder, 'played.jsonl').write_text(json.dumps({
                'id': 'g1', 'user_color': 'black', 'result': '0-1', 'initialFen': chess.STARTING_FEN, 'moves': mate}) + '\n')
            state = {'puzzles': {'p1': {'solved': 1}, 'p2': {'solved': 0}}}
            counts, games = achievements.counts(folder, state, {'p1': ['fork', 'deflection']})
            self.assertEqual(games, 1)
            self.assertEqual((counts['checkmate'], counts['legend'], counts['blitz'], counts['tactician'], counts['deflection']),
                             (1, 1, 1, 1, 1))
            self.assertTrue(Path(folder, 'achievement-scan.json').exists())


if __name__ == '__main__':
    unittest.main()
