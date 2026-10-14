"""Opening recognition is offline and independent of Stockfish or a language model."""
import io
import unittest
from unittest import mock

import chess
import chess.pgn

from torre.analysis import opening_book
from torre.analysis import board_view
def recognize(pgn):
    return opening_book.recognize(chess.pgn.read_game(io.StringIO(pgn)))


class OpeningBookTests(unittest.TestCase):
    def test_specific_variation_without_headers(self):
        found = recognize('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 *')
        self.assertEqual(found['name'], 'Sicilian Defense: Najdorf Variation')
        self.assertEqual((found['eco'], found['ply'], found['played_by'], found['move']), ('B90', 10, 'black', 'a6'))
        self.assertFalse(found['transposed'])
        self.assertIn('5... a6', found['line'])
        self.assertIn('asymmetric', found['family_idea'])

    def test_actual_moves_override_misleading_pgn_tags(self):
        found = recognize('[ECO "B90"]\n[Opening "Sicilian Defense"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 *')
        self.assertEqual(found['name'], 'Ruy Lopez')
        self.assertEqual(found['played_by'], 'white')

    def test_transposition_keeps_the_players_actual_sequence(self):
        found = recognize('1. Nf3 d5 2. d4 Nf6 3. c4 e6 4. Nc3 *')
        self.assertIn("Queen's Gambit Declined", found['name'])
        self.assertTrue(found['transposed'])
        self.assertTrue(found['line'].startswith('1. Nf3 1... d5'))

    def test_retains_opening_after_an_unlisted_continuation(self):
        found = recognize('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. a4 h5 *')
        self.assertIn('Najdorf', found['name'])
        self.assertIn('6... h5', found['continuation'])

    def test_the_first_move_out_of_the_book_and_who_played_it(self):
        found = recognize('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. h4 h5 *')
        self.assertEqual(found['exit'], {'ply': 11, 'move_number': 6, 'move': 'h4', 'played_by': 'white'})
        self.assertEqual(recognize('1. e4 e5 2. Nf3 Nc6 3. Bb5 Ke7 *')['exit']['played_by'], 'black')
        self.assertIsNone(recognize('1. e4 e5 2. Nf3 Nc6 3. Bb5 *')['exit'])  # still in the book at the end

    def test_no_guessed_names_for_empty_or_custom_games(self):
        self.assertIsNone(recognize('[Opening "Sicilian Defense"]\n\n*'))
        self.assertIsNone(recognize('[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 12"]\n\n12. a8=Q+ *'))
        self.assertIsNone(opening_book.recognize(None))

    def test_missing_book_is_optional_and_does_not_use_headers(self):
        with mock.patch.object(opening_book, 'positions', return_value={}):
            self.assertIsNone(recognize('[ECO "C60"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 *'))

    def test_bundled_positions_agree_with_their_legal_lines(self):
        book = opening_book.positions()
        self.assertGreater(len(book), 3000)
        for epd, entry in book.items():
            board = chess.Board()
            for uci in entry['uci']:
                board.push_uci(uci)
            self.assertEqual(board.epd(), epd, entry['name'])

    def test_game_response_contains_opening_without_engine_analysis(self):
        detail = board_view.parse_pgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 *')
        self.assertEqual(detail['opening']['name'], 'Ruy Lopez')


if __name__ == '__main__':
    unittest.main()
