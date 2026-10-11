"""Core regression checks: .venv/Scripts/python -m unittest test_studio -v"""
import unittest

import chess
import chess.engine

from torre.server import studio
from torre.server import api_games
from torre.server import appdata
from torre.analysis import engine_service
from torre.analysis import engines
from torre.analysis import insights
from torre.analysis.board_view import parse_pgn, position, state, with_clocks
from torre.analysis.engine_service import bot_move


def bot_style(elo):
    return engines.strength_options(engines.get('stockfish'), elo)


class ChessStudioTests(unittest.TestCase):
    def test_starting_position_and_illegal_moves(self):
        self.assertEqual(len(state(position({}))['legal']), 20)
        for move in ('e2e5', '0000', 'a1a8'):
            with self.assertRaises(ValueError):
                position({'moves': [move]})

    def test_castling(self):
        board = position({'moves': ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1']})
        self.assertEqual(board.piece_at(chess.G1).symbol(), 'K')
        self.assertEqual(board.piece_at(chess.F1).symbol(), 'R')

    def test_castling_restrictions(self):
        fixtures = [
            ('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', True),
            ('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1', False),
            ('r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1', False),
            ('r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1', False),
            ('r3k2r/8/8/8/8/4r3/8/R3K2R w KQkq - 0 1', False),
        ]
        for fen, allowed in fixtures:
            with self.subTest(fen=fen):
                self.assertEqual('e1g1' in state(position({'initialFen': fen}))['legal'], allowed)

    def test_en_passant(self):
        board = position({'moves': ['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']})
        self.assertIsNone(board.piece_at(chess.D5))
        self.assertEqual(board.piece_at(chess.D6).symbol(), 'P')

    def test_underpromotion(self):
        fen = '7k/P7/8/8/8/8/8/7K w - - 0 1'
        board = position({'initialFen': fen, 'moves': ['a7a8n']})
        self.assertEqual(board.piece_at(chess.A8).symbol(), 'N')

    def test_checkmate(self):
        board = position({'moves': ['f2f3', 'e7e5', 'g2g4', 'd8h4']})
        self.assertEqual(state(board)['result'], '0-1')
        self.assertEqual(state(board)['termination'], 'checkmate')

    def test_repetition_history_preserved(self):
        board = position({'moves': ['g1f3', 'g8f6', 'f3g1', 'f6g8'] * 2})
        self.assertEqual(state(board)['termination'], 'threefold repetition')

    def test_stalemate(self):
        board = position({'initialFen': '7k/5K2/6Q1/8/8/8/8/8 b - - 0 1'})
        self.assertEqual(state(board)['termination'], 'stalemate')

    def test_pgn_import_and_custom_start(self):
        game = parse_pgn('1. e4 e5 2. Nf3 Nc6 *')
        self.assertEqual([m['uci'] for m in game['moves']], ['e2e4','e7e5','g1f3','b8c6'])
        game = parse_pgn('[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 12"]\n\n12. a8=Q+ *')
        self.assertEqual(game['moves'][0]['san'], 'a8=Q+')
        self.assertTrue(game['initialFen'].endswith('12'))

    def test_pgn_import_keeps_clocks(self):
        game = parse_pgn('1. e4 { [%clk 0:02:58] } e5 { [%clk 0:02:50.5] } 2. Nf3 *')
        self.assertEqual([m.get('clock') for m in game['moves']], [178, 170.5, None])

    def test_saved_chesscom_timestamps_become_clocks(self):
        game = parse_pgn('1. e4 e5 *')
        self.assertEqual([m['clock'] for m in with_clocks(game, {'move_timestamps': [1800, 1795]})['moves']], [180, 179.5])
        self.assertNotIn('clock', with_clocks(game, {'move_timestamps': [1800]})['moves'][0])  # not this game's
        self.assertNotIn('clock', with_clocks(game, {})['moves'][0])
        self.assertEqual([m['clock'] for m in with_clocks(game, {'move_timestamps': '5991,5987,5950'})['moves']], [599.1, 598.7])

    def test_invalid_position(self):
        with self.assertRaises(ValueError):
            position({'initialFen': '8/8/8/8/8/8/8/8 w - - 0 1'})

    def test_invalid_pgn(self):
        for pgn in ('', 'this is not a game'):
            with self.assertRaises(ValueError):
                parse_pgn(pgn)

    def test_control_counts_pawn_diagonals_not_forward_moves(self):
        data = state(chess.Board())
        self.assertIn('e2', data['control']['d3']['white'])
        self.assertIn('e2', data['control']['f3']['white'])
        self.assertNotIn('e2', data['control']['e3']['white'])
        self.assertIn('f6', data['plans']['g8'])  # Black's possible next turn.

    def test_pinned_piece_controls_squares_but_cannot_plan_illegal_move(self):
        board = chess.Board('k3r3/8/8/8/8/8/4R3/4K3 w - - 0 1')
        data = state(board)
        self.assertIn('e2', data['control']['a2']['white'])
        self.assertNotIn('a2', data['plans']['e2'])
        self.assertIn('e8', data['plans']['e2'])

    def test_planning_rejects_illegal_queen_geometry_and_blockers(self):
        data = state(chess.Board('7k/Q7/8/8/8/8/8/7K w - - 0 1'))
        self.assertNotIn('g5', data['plans']['a7'])
        self.assertIn('g7', data['plans']['a7'])
        data = state(chess.Board('7k/8/8/8/8/4P3/4Q3/7K w - - 0 1'))
        self.assertNotIn('e5', data['plans']['e2'])


    def test_bot_style_uses_stockfish_elo_from_its_floor(self):
        self.assertEqual(bot_style(1500), ({'UCI_LimitStrength': True, 'UCI_Elo': 1500}, 0.0))
        self.assertEqual(bot_style(4000)[0]['UCI_Elo'], 3190)

    def test_weaker_bots_slip_more_often(self):
        slips = [bot_style(elo)[1] for elo in (300, 600, 900, 1200)]
        self.assertEqual(slips, sorted(slips, reverse=True))
        self.assertGreater(slips[0], 0.3)
        self.assertEqual(bot_style(1200)[0], {'Skill Level': 5})

    def test_a_slip_is_a_plausible_weaker_move_not_a_random_one(self):
        board = position({})
        best, natural, awful = (chess.Move.from_uci(u) for u in ('e2e4', 'd2d4', 'g2g4'))

        class Engine:
            def play(self, board, limit): raise AssertionError('a slip does not ask for the best move')
            def analyse(self, board, limit, multipv, game):
                score = lambda cp: {'score': chess.engine.PovScore(chess.engine.Cp(cp), chess.WHITE)}
                return [{'pv': [best], **score(30)}, {'pv': [natural], **score(20)}, {'pv': [awful], **score(-400)}]

        class Low:
            def random(self): return 0.0
            def choice(self, moves): return moves[-1]

        move, slipped = engine_service.bot_choice(Engine(), board, bot_style(400)[1], rng=Low())
        self.assertTrue(slipped)
        self.assertEqual(move, natural)  # never the engine's first choice; the smallest mistake is likeliest

    def test_a_slip_falls_back_to_a_legal_move_without_candidates(self):
        class Engine:
            def play(self, board, limit): raise AssertionError('engine should not be asked to play')

        class Always:
            def random(self): return 0.0
            def choice(self, moves): return moves[-1]

        board = position({})
        self.assertIn(bot_move(Engine(), board, bot_style(400)[1], rng=Always()), board.legal_moves)


class OpeningNameTests(unittest.TestCase):
    def test_every_code_gets_a_name_from_its_family(self):
        self.assertEqual(insights.eco_name('D02'), 'London System')
        self.assertEqual(insights.eco_name('A48'), 'East Indian Defense')
        self.assertEqual(insights.eco_name('B33'), 'Sicilian Defense')
        self.assertEqual(insights.eco_name('C88'), 'Ruy Lopez')
        self.assertEqual(insights.eco_name('?'), '?')


if __name__ == '__main__':
    unittest.main()


class IllegalReasonTests(unittest.TestCase):
    """The rule behind a refused move, for learners who think the board is broken."""

    def reason(self, fen, move):
        from torre.analysis import board_view
        found = board_view.illegal_reason(chess.Board(fen), chess.parse_square(move[:2]), chess.parse_square(move[2:]))
        return found and found[0]

    def test_rules_a_beginner_runs_into(self):
        cases = {
            # The knight on c6 shields the king on e8 from the bishop on b5.
            'pinned': ('r1bqkbnr/ppp2ppp/2np4/1B2p3/4P3/3P1N2/PPP2PPP/RNBQK2R b KQkq - 0 4', 'c6d4'),
            # Bxf7+: the king must deal with the check before anything else.
            'inCheck': ('r1bqkbnr/pppp1Bpp/2n5/4p3/4P3/8/PPPP1PPP/RNBQK1NR b KQkq - 0 3', 'g8f6'),
            'kingAttacked': ('4k3/8/8/8/8/8/3r4/4K3 w - - 0 1', 'e1e2'),
            'castleThroughCheck': ('4k3/8/8/8/8/8/5r2/4K2R w K - 0 1', 'e1g1'),
            'castleInCheck': ('4k3/8/8/8/8/8/4r3/4K2R w K - 0 1', 'e1g1'),
            'castleRights': ('4k3/8/8/8/8/8/8/4K2R w - - 0 1', 'e1g1'),
            'castleBlocked': ('4k3/8/8/8/8/8/8/4KB1R w K - 0 1', 'e1g1'),
            'pathBlocked': (chess.STARTING_FEN, 'f1c4'),
            'pawnForward': ('4k3/8/8/4p3/4P3/8/8/4K3 w - - 0 1', 'e4e5'),
            'pawnDiagonal': (chess.STARTING_FEN, 'e2d3'),
            'pawnDouble': ('4k3/8/8/8/8/4P3/8/4K3 w - - 0 1', 'e3e5'),
            'movement': (chess.STARTING_FEN, 'g1g3'),
        }
        for expected, (fen, move) in cases.items():
            with self.subTest(expected):
                self.assertEqual(self.reason(fen, move), expected)

    def test_nothing_to_explain(self):
        self.assertIsNone(self.reason(chess.STARTING_FEN, 'e2e4'))  # legal
        self.assertIsNone(self.reason(chess.STARTING_FEN, 'e7e5'))  # not your piece
        self.assertIsNone(self.reason(chess.STARTING_FEN, 'd1e1'))  # onto your own piece: that selects it

    def test_the_route_names_the_attacker(self):
        from torre.server.routes import BadRequest
        from torre.server import api_board
        req = type('Req', (), {'payload': {'initialFen': 'r1bqkbnr/ppp2ppp/2np4/1B2p3/4P3/3P1N2/PPP2PPP/RNBQK2R b KQkq - 0 4',
                                           'from': 'c6', 'to': 'd4'}})()
        self.assertEqual(api_board.illegal(req), {'reason': 'pinned', 'piece': 'knight', 'attacker': 'b5'})
        req.payload = {'from': 'z9', 'to': 'e4'}
        with self.assertRaises(BadRequest):
            api_board.illegal(req)


@unittest.skipUnless(engine_service.ENGINE_PATH.exists(), 'Stockfish is not installed')
class JudgeMoveTests(unittest.TestCase):
    # Scholar's Mate, "Punish the wandering queen": the lesson wants Nd4.
    FEN = 'r1bqkb1r/pppp1p1p/2n2np1/4p3/2B1P3/1Q6/PPPP1PPP/RNB1K1NR b KQkq - 3 5'

    def judge(self, move):
        board = chess.Board(self.FEN)
        with chess.engine.SimpleEngine.popen_uci(str(engine_service.ENGINE_PATH)) as engine:
            return engine_service.judge_move(engine, board, chess.Move.from_uci(move), chess.Move.from_uci('c6d4'))

    def test_a_tempting_fork_that_loses_is_worse_and_shows_its_refutation(self):
        verdict = self.judge('c6a5')  # Na5 hits queen and bishop, but Bxf7+ comes first
        self.assertEqual(verdict['verdict'], 'worse')
        self.assertEqual(verdict['line'][:2], ['Na5', 'Bxf7+'])
        self.assertLessEqual(verdict['material'], 0)
        self.assertIsInstance(verdict['motifs'], list)

    def test_the_coach_sees_the_threat_and_the_better_move(self):
        # Scholar's Mate threat: Black to move, White threatens Qxf7#.
        board = chess.Board('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 3 3')
        with chess.engine.SimpleEngine.popen_uci(str(engine_service.ENGINE_PATH)) as engine:
            hint = engine_service.coach_hint(engine, board)
            check = engine_service.coach_check(engine, board, chess.Move.from_uci('a7a6'))
        self.assertEqual(hint['threat']['san'], 'Qxf7#')
        self.assertIn('mateIn1', hint['threat']['motifs'])
        self.assertIsNotNone(hint['best'])
        self.assertEqual(check['verdict'], 'worse')
        self.assertGreater(check['loss'], 1000)
        self.assertIn('mateIn1', check['motifs'])

    def test_the_listed_move_is_good(self):
        verdict = self.judge('c6d4')
        self.assertEqual(verdict['verdict'], 'good')
        self.assertEqual(verdict['motifs'], [])


class BackgroundAnalysisTests(unittest.TestCase):
    """The analysis job runs newest games first, mines in batches, and starts on its own."""
    def setUp(self):
        import json
        import tempfile
        from pathlib import Path
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        studio.use_data_dir(self.data)
        games = [{'id': i, 'date': f'2026-01-{i:02d}', 'pgn': '1. e4 e5 *', 'user_color': 'white'} for i in range(1, 26)]
        (self.data / 'games.jsonl').write_text(''.join(json.dumps(g) + '\n' for g in games), encoding='utf-8')
        self.job = api_games.AnalysisJob()

    def test_pending_is_newest_first(self):
        from torre.analysis import analyze
        games, _, _ = analyze.pending(self.data / 'games.jsonl', self.data / 'analysis.jsonl')
        self.assertEqual([g['id'] for g in games[:3]], [25, 24, 23])

    def test_mines_after_every_batch_and_after_a_stop(self):
        from unittest import mock
        batches = []
        with mock.patch.object(api_games.analyze, 'run', side_effect=lambda games, *a, **k: batches.append(len(games))), \
                mock.patch('torre.learning.my_puzzles.run', return_value=({'puzzles': [1, 2]}, 1)) as mine:
            self.job.execute(list(range(25)))
            self.assertEqual(batches, [10, 10, 5])
            self.assertEqual(mine.call_count, 3)
            self.assertEqual((self.job.state['puzzles_mined'], self.job.state['my_puzzles']), (3, 2))
            self.job.stop()
            batches.clear()
            self.job.execute(list(range(25)))
            self.assertEqual((batches, mine.call_count), ([10], 4))  # the stopped batch is still mined

    def test_auto_analyze_rules(self):
        from unittest import mock
        with mock.patch.object(api_games, 'ANALYSIS_JOB', self.job), mock.patch.object(self.job, 'start') as start, \
                mock.patch.object(engine_service, 'ENGINE_PATH', mock.Mock(exists=lambda: True)):
            self.assertTrue(api_games.auto_analyze())
            appdata.update_settings(lambda s: s.__setitem__('auto_analyze', False))
            self.assertFalse(api_games.auto_analyze())
            appdata.update_settings(lambda s: s.__setitem__('auto_analyze', True))
            self.job.stopped_by_user = True
            self.assertFalse(api_games.auto_analyze())
            self.assertEqual(start.call_count, 1)

    def test_host_can_turn_automatic_analysis_off(self):
        import os
        from unittest import mock
        with mock.patch.object(api_games, 'ANALYSIS_JOB', self.job), mock.patch.object(self.job, 'start') as start,                 mock.patch.object(engine_service, 'ENGINE_PATH', mock.Mock(exists=lambda: True)),                 mock.patch.dict(os.environ, {'TORRE_BACKGROUND_ANALYSIS': '0'}):
            self.assertFalse(api_games.auto_analyze())
            self.assertFalse(api_games.auto_enabled())
            self.assertEqual(start.call_count, 0)
            api_games.analysis_start(None)  # "Analyze all" still runs
            self.assertEqual(start.call_count, 1)
