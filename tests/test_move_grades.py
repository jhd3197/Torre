"""The grades agree across engines, reviews, tallies and portable exports."""
import unittest
import json
import threading
import urllib.request
from collections import Counter
from unittest.mock import patch

import chess

from torre.analysis import analyze
from torre.games import arena
from torre.analysis import game_export
from torre.analysis import insights
from torre.analysis import opening_book
from torre.analysis import pgn_export
from torre.analysis import scoring
from torre.analysis import engine_service
from torre.server import studio
from tests import test_scoring
from tests.test_scoring import FakeEngine


class FinerGradeTests(unittest.TestCase):
    ROOK = chess.Board('4k3/8/8/8/8/8/8/R3K3 w Q - 0 30')

    def grade(self, before, after, uci='a1a2', best='a1a7', earlier=None, board=None):
        board = board or self.ROOK
        return scoring.classify(board, chess.Move.from_uci(uci), {'cp': before, 'mate': None, 'best': best},
                                {'cp': after, 'mate': None}, earlier)

    def test_excellent_is_near_best_and_good_is_the_rest(self):
        self.assertEqual(scoring.grade(self.grade(300, 295)), 'excellent')
        self.assertEqual(scoring.grade(self.grade(300, 280)), 'good')
        self.assertEqual(scoring.grade(self.grade(300, 300, uci='a1a7')), 'best')
        self.assertFalse(self.grade(300, 300, uci='a1a7')['excellent'])

    def test_the_only_legal_move_is_forced_and_never_judged(self):
        board = chess.Board('7k/8/8/8/8/8/6q1/7K w - - 0 1')
        result = self.grade(-200, -900, uci='h1g2', best='h1g2', board=board)
        self.assertTrue(result['forced'])
        self.assertIsNone(result['class'])
        self.assertEqual(result['accuracy'], 100.0)
        self.assertEqual(scoring.grade(result), 'forced')

    def test_a_slip_left_unpunished_is_a_miss(self):
        punished = {'cp': 0, 'mate': None}  # the opponent's last move threw away 4 pawns
        self.assertEqual(scoring.grade(self.grade(400, 250, earlier=punished)), 'miss')
        self.assertTrue(self.grade(400, 250, earlier=punished)['miss'])
        # The same drop after a sound move is an inaccuracy; a blunder stays a blunder.
        self.assertEqual(scoring.grade(self.grade(400, 250, earlier={'cp': 380, 'mate': None})), 'inaccuracy')
        self.assertEqual(scoring.grade(self.grade(400, 250)), 'inaccuracy')
        self.assertEqual(scoring.grade(self.grade(400, 100, earlier=punished)), 'blunder')

    def test_a_mate_let_go_is_a_miss_while_the_game_stays_playable(self):
        board, move = self.ROOK, chess.Move.from_uci('a1a2')
        let_go = scoring.classify(board, move, {'cp': None, 'mate': 3, 'best': 'a1a7'}, {'cp': 500, 'mate': None})
        self.assertEqual(scoring.grade(let_go), 'miss')
        self.assertEqual(let_go['class'], 'blunder')  # Lichess's judgment stays for the error counts
        thrown = scoring.classify(board, move, {'cp': None, 'mate': 3, 'best': 'a1a7'}, {'cp': -100, 'mate': None})
        self.assertEqual(scoring.grade(thrown), 'blunder')

    def test_misses_count_as_errors_but_excellent_and_forced_are_clean(self):
        self.assertTrue(scoring.counts_as_error({'class': 'inaccuracy', 'miss': True}))
        self.assertTrue(scoring.counts_as_error({'class': 'mistake'}))
        self.assertFalse(scoring.counts_as_error({'class': 'inaccuracy'}))
        self.assertFalse(scoring.counts_as_error({'class': None, 'excellent': True}))
        self.assertFalse(scoring.counts_as_error({'class': None, 'forced': True}))

    def test_taking_a_repetition_from_a_slightly_better_position_is_not_an_error(self):
        board = chess.Board()
        for uci in ('g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'):
            board.push_uci(uci)
        repeat = chess.Move.from_uci('g1f3')
        following = board.copy()
        following.push(repeat)
        self.assertIsNone(following.outcome(claim_draw=True).winner)
        for edge in (20, 40, 50):
            before = {'cp': edge, 'mate': None, 'best': 'e2e4'}
            result = scoring.classify(board, repeat, before, scoring.verdict(following, None),
                                      {'cp': edge, 'mate': None})
            self.assertIsNone(result['class'], edge)
            self.assertFalse(result['miss'], edge)
            self.assertNotIn(scoring.grade(result), ('inaccuracy', 'miss', 'mistake', 'blunder'))


class MoveGradeTests(unittest.TestCase):
    def test_cached_review_api_sends_shared_grade_at_a_batch_boundary(self):
        board = chess.Board(test_scoring.BrilliantTests.GREEK_GIFT)
        move = test_scoring.BrilliantTests.BXH7
        following = board.copy()
        following.push(move)
        known = {
            'stockfish:' + engine_service.eval_key(board): {'best': move.uci(), 'lines': [
                {'cp': 230, 'mate': None, 'moves': ['Bxh7+'], 'uci': [move.uci()]}]},
            'stockfish:' + engine_service.eval_key(following): {'best': None, 'lines': [
                {'cp': 230, 'mate': None, 'moves': [], 'uci': []}]},
        }
        with patch.object(engine_service, 'saved_evals', return_value=known), patch.object(engine_service, 'save_evals'):
            server = studio.ThreadingHTTPServer(('127.0.0.1', 0), studio.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                body = {'initialFen': board.fen(), 'moves': [move.uci()], 'from': 1, 'to': 1, 'cachedOnly': True}
                request = urllib.request.Request(f'http://127.0.0.1:{server.server_port}/api/review',
                    json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'X-Chess-Studio': '1'})
                with urllib.request.urlopen(request) as response:
                    result = json.load(response)
                self.assertEqual(len(result['plies']), 1)
                self.assertTrue(result['plies'][0]['grade']['brilliant'])
                self.assertEqual(scoring.grade(result['plies'][0]['grade']), 'brilliant')
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
    def test_insights_counts_every_player_move_once_and_tracks_old_analysis(self):
        rec = {'id': '1', 'user_color': 'white', 'user_result': 1, 'type': 'computer',
               'date': '2026.10.07', 'opponent': 'Test', 'pgn': '1. e4 e5 2. Nf3 Nc6 *'}
        current = analyze.analyze_game(FakeEngine(), rec, 1)
        old = {**current, 'id': '2', 'scoring_version': 2}
        old['moves'] = [{k: v for k, v in m.items() if k not in ('great', 'book')} for m in old['moves']]
        with patch.object(insights, 'load_games', return_value=[rec, {**rec, 'id': '2'}]), \
             patch.object(insights, 'load_analysis', return_value={'1': current, '2': old}):
            stats = insights.build_data('unused')
        self.assertEqual(sum(stats['grades'].values()), 4)
        self.assertEqual(stats['gradeCoverage'], {'current': 2, 'total': 4})
        self.assertEqual(stats['grades']['book'], 2)

    def test_book_prefixes_transpositions_and_unlisted_moves(self):
        board = chess.Board()
        self.assertTrue(opening_book.is_book_move(board, chess.Move.from_uci('e2e4')))
        for uci in ('g1f3', 'd7d5', 'd2d4', 'g8f6'):
            board.push_uci(uci)
        self.assertTrue(opening_book.is_book_move(board, chess.Move.from_uci('c2c4')))
        self.assertFalse(opening_book.is_book_move(board, chess.Move.from_uci('h1g1')))

    def test_errors_override_book_and_each_move_has_one_category(self):
        board = chess.Board()
        move = chess.Move.from_uci('e2e4')
        result = scoring.classify(board, move, {'cp': 0, 'best': 'e2e4'}, {'cp': -500})
        self.assertTrue(result['book'])
        self.assertEqual(scoring.grade(result), 'blunder')
        self.assertEqual(scoring.grade({'great': True, 'best': True}), 'great')
        self.assertEqual(scoring.grade({'brilliant': True, 'great': True, 'book': True}), 'brilliant')
        self.assertEqual(len(set(scoring.GRADES)), 11)

    def test_great_requires_a_meaningful_alternative_for_both_colors(self):
        white = chess.Board('4k3/8/8/8/8/8/8/R3K3 w Q - 0 30')
        for board, uci, sign in ((white, 'a1a7', 1), (white.mirror(), 'a8a2', -1)):
            move = chess.Move.from_uci(uci)
            before = {'cp': sign * 300, 'mate': None, 'best': uci, 'alternative': (0, None)}
            after = {'cp': sign * 290, 'mate': None}
            self.assertEqual(scoring.grade(scoring.classify(board, move, before, after)), 'great')
            for alternative in (None, (sign * 280, None)):
                result = scoring.classify(board, move, {**before, 'alternative': alternative}, after)
                self.assertFalse(result['great'])
            # One legal move is forced, however much worse an invented runner-up is.
            with patch.object(chess.LegalMoveGenerator, 'count', return_value=1):
                self.assertFalse(scoring.classify(board, move, before, after)['great'])

    def test_brilliant_matches_arena_and_review_scoring(self):
        board = chess.Board(test_scoring.BrilliantTests.GREEK_GIFT)
        move = test_scoring.BrilliantTests.BXH7
        before = {'cp': 230, 'mate': None, 'best': move.uci()}
        after = {'cp': 230, 'mate': None}
        self.assertEqual(arena.grade_move(board, move, before, after), scoring.classify(board, move, before, after))
        self.assertTrue(arena.grade_move(board, move, before, after)['brilliant'])
        self.assertEqual(board.fen(), test_scoring.BrilliantTests.GREEK_GIFT)
        self.assertIsNone(scoring.classify(board, move, None, after))

    def test_archive_tally_and_export_use_identical_exclusive_grades(self):
        rec = {'id': '1', 'user_color': 'white', 'user_result': 1,
               'pgn': '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0'}
        analysis = analyze.analyze_game(FakeEngine(), rec, 1)
        self.assertEqual(sum(analysis['grades'].values()), analysis['user_move_count'])
        self.assertEqual(analysis['grades']['book'], 2)
        self.assertEqual(analysis['grades']['best'], 1)
        self.assertEqual(Counter(scoring.grade(m) for m in analysis['moves']), Counter({g: n for g, n in analysis['grades'].items() if n}))
        report = game_export.game_report(rec['pgn'], analysis)
        exported = Counter(d['grade'] for d in report['quality']['moves'][::2])
        self.assertEqual(exported, Counter({g: n for g, n in analysis['grades'].items() if n}))
        text = pgn_export.annotated_pgn(rec['pgn'], analysis)
        self.assertIn('Book move.', text)
        self.assertIn('Best move.', text)


if __name__ == '__main__':
    unittest.main()
