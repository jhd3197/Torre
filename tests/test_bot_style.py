"""Bot quirks (bot_style): a character's move fits its description when that costs little."""
import random
import unittest

import chess
import chess.engine

from torre.analysis import bot_style


class Always:
    """An rng whose roll always lets the quirk show."""
    def random(self):
        return 0.0


class Never:
    def random(self):
        return 0.999


class ScoredEngine:
    """A fake engine that scores root moves from a table (mover's centipawns, 0 for the rest)
    and reports the best `multipv` of them, as Stockfish does."""

    def __init__(self, table=None):
        self.table = {chess.Move.from_uci(uci): cp for uci, cp in (table or {}).items()}
        self.looks = []

    def analyse(self, board, limit, multipv, root_moves):
        self.looks.append([m.uci() for m in root_moves])
        ranked = sorted(root_moves, key=lambda m: -self.table.get(m, 0))[:multipv]
        return [{'pv': [m], 'score': chess.engine.PovScore(chess.engine.Cp(self.table.get(m, 0)), board.turn)} for m in ranked]


def board_after(*ucis, fen=chess.STARTING_FEN):
    board = chess.Board(fen)
    for uci in ucis:
        board.push_uci(uci)
    return board


def move(uci):
    return chess.Move.from_uci(uci)


class QuirkTests(unittest.TestCase):
    def styled(self, board, engine_move, style, table=None, elo=800, rng=None):
        engine = ScoredEngine(table)
        played, styled = bot_style.styled_move(engine, board, move(engine_move), bot_style.parse(style), elo, rng or Always())
        self.assertIn(played, board.legal_moves)
        return played.uci(), styled, engine

    def test_diego_opens_with_e4_every_game(self):
        style = {'opening': {'white': ['e4'], 'black': ['e5']}}
        self.assertEqual(self.styled(chess.Board(), 'd2d4', style)[:2], ('e2e4', True))
        self.assertEqual(self.styled(board_after('d2d4'), 'd7d5', style)[:2], ('e7e5', True))
        # The book is done once its moves are played; then the engine plays.
        self.assertEqual(self.styled(board_after('e2e4', 'e7e5'), 'g1f3', style)[:2], ('g1f3', False))

    def test_a_book_move_that_loses_too_much_is_not_played(self):
        # 1.f3?! scored far below the engine's move for a strong bot: the engine's move stays.
        style = {'opening': {'white': ['f3']}}
        played, styled, _ = self.styled(chess.Board(), 'e2e4', style, {'e2e4': 40, 'f2f3': -90}, elo=2500)
        self.assertEqual((played, styled), ('e2e4', False))
        # A beginner's tolerance is wider.
        self.assertEqual(self.styled(chess.Board(), 'e2e4', style, {'e2e4': 40, 'f2f3': -90}, elo=500)[0], 'f2f3')

    def test_pip_pushes_pawns_two_squares(self):
        played, styled, _ = self.styled(chess.Board(), 'g1f3', {'quirk': 'doublePush'}, {'g1f3': 30, 'e2e4': 35, 'd2d4': 28, 'a2a4': -40})
        self.assertTrue(styled)
        self.assertIn(played, {'e2e4', 'd2d4'})
        self.assertEqual(played, 'd2d4')  # closest in score to the engine's own choice: the quirk keeps the strength

    def test_kwame_moves_his_knights(self):
        played, styled, _ = self.styled(chess.Board(), 'e2e4', {'quirk': 'knights'}, {'e2e4': 30, 'g1f3': 25, 'b1c3': 20})
        self.assertEqual((played, styled), ('g1f3', True))

    def test_mila_mirrors_your_move_while_she_can(self):
        board = board_after('g1f3')
        self.assertEqual(self.styled(board, 'd7d5', {'quirk': 'mirror'}, {'d7d5': 20, 'g8f6': 15})[:2], ('g8f6', True))
        # Your capture on d5 has no mirror she can play: the engine's move stays.
        board = board_after('e2e4', 'd7d5', 'e4d5')
        self.assertEqual(self.styled(board, 'd8d5', {'quirk': 'mirror'})[:2], ('d8d5', False))

    def test_an_aggressive_bot_prefers_captures_and_checks(self):
        board = board_after('e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1')
        played, styled, _ = self.styled(board, 'f8e7', {'quirk': 'aggressive'}, {'f8e7': 10, 'f6e4': 0, 'f8c5': 30})
        self.assertEqual((played, styled), ('f6e4', True))

    def test_a_trader_trades_like_for_like(self):
        board = chess.Board('r3k3/8/8/3n4/8/2N5/8/4K2R w K - 0 20')
        played, styled, _ = self.styled(board, 'e1g1', {'quirk': 'trades'}, {'e1g1': 10, 'c3d5': 5})
        self.assertEqual((played, styled), ('c3d5', True))

    def test_iron_wall_ivo_keeps_his_pawns_behind_the_fourth_rank(self):
        board = chess.Board('4k3/8/8/8/4P3/8/8/4K1N1 w - - 0 30')
        played, styled, engine = self.styled(board, 'e4e5', {'quirk': 'fortress'}, {'e4e5': 50, 'g1f3': 45})
        self.assertEqual((played, styled), ('g1f3', True))
        self.assertEqual(engine.looks[0][-1], 'e4e5')  # the pawn push is scored only as the engine's own choice
        # A move that already fits needs no look at all.
        played, styled, engine = self.styled(board, 'g1f3', {'quirk': 'fortress'})
        self.assertEqual((played, styled, engine.looks), ('g1f3', False, []))

    def test_poppy_castles(self):
        board = chess.Board('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 10')
        played, styled, _ = self.styled(board, 'a1b1', {'quirk': 'castle'}, {'a1b1': 0, 'e1g1': 5, 'e1c1': -50})
        self.assertEqual((played, styled), ('e1g1', True))

    def test_a_quirk_that_does_not_show_costs_no_search(self):
        played, styled, engine = self.styled(chess.Board(), 'g1f3', {'quirk': 'doublePush'}, rng=Never())
        self.assertEqual((played, styled, engine.looks), ('g1f3', False, []))

    def test_quirks_are_deterministic_for_a_seed(self):
        def run(seed):
            rng = random.Random(seed)
            return [self.styled(chess.Board(), 'g1f3', {'quirk': 'doublePush'}, {'g1f3': 30, 'e2e4': 30}, rng=rng)[0] for _ in range(20)]
        self.assertEqual(run(7), run(7))
        self.assertIn('e2e4', run(7))
        self.assertIn('g1f3', run(7))  # 60% of the time, not always

    def test_an_engine_failure_or_an_odd_reply_leaves_the_engine_move(self):
        class Broken:
            def analyse(self, *args, **kwargs):
                raise chess.engine.EngineError('gone')

        style = bot_style.parse({'quirk': 'knights'})
        self.assertEqual(bot_style.styled_move(Broken(), chess.Board(), move('e2e4'), style, 800, Always()), (move('e2e4'), False))

        class Illegal:
            def analyse(self, board, limit, multipv, root_moves):
                return [{'pv': [move('e2e5')], 'score': chess.engine.PovScore(chess.engine.Cp(900), board.turn)}]

        self.assertEqual(bot_style.styled_move(Illegal(), chess.Board(), move('e2e4'), style, 800, Always()), (move('e2e4'), False))

    def test_tolerance_narrows_with_rating(self):
        self.assertEqual(bot_style.tolerance(400), 180)
        self.assertGreater(bot_style.tolerance(1200), bot_style.tolerance(2000))
        self.assertEqual(bot_style.tolerance(2800), 25)

    def test_a_style_is_checked(self):
        self.assertIsNone(bot_style.parse(None))
        self.assertIsNone(bot_style.parse({}))
        for bad in ('knights', {'quirk': 'teleport'}, {'quirk': 'knights', 'chance': 2}, {'opening': {'red': ['e4']}},
                    {'opening': {'white': 'e4'}}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                bot_style.parse(bad)


if __name__ == '__main__':
    unittest.main()
