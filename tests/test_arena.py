"""Legend books and Arena matches: .venv/Scripts/python -m unittest test_arena -v"""
import contextlib
import json
import random
import shutil
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest import mock

import chess

from torre.games import arena
from torre.analysis import engines
from torre.games import masters
PGN = '''[Event "Test Open"]
[Date "2020.01.01"]
[White "Legend,Hero"]
[Black "Rival,A"]
[Result "1-0"]
[WhiteElo "2700"]
[BlackElo "2500"]

1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 1-0

[Event "Test Open"]
[Date "2021.01.01"]
[White "Rival,B"]
[Black "Legend,H"]
[Result "1/2-1/2"]
[WhiteElo "2600"]
[BlackElo "2750"]

1.e4 {a comment} c5 2.Nf3 (2.c3 d5) d6 1/2-1/2

[Event "Test Open"]
[Date "2022.01.01"]
[White "Legend,Hero"]
[Black "Rival,C"]
[Result "0-1"]

1.d4 Nf6 0-1

[Event "Friendly"]
[Date "2022.06.01"]
[White "Other,X"]
[Black "Other,Y"]
[Result "1-0"]

1.e4 e5 1-0
'''


class MasterBookTests(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        (self.folder / 'pgns').mkdir()
        (self.folder / 'pgns' / 'Legend.pgn').write_text(PGN, encoding='utf-8')
        self.saved = masters.PGN_DIR, masters.DATA_DIR
        masters.PGN_DIR = self.folder / 'pgns'
        masters.use_data_dir(self.folder / 'data')
        masters._summaries.clear()

    def tearDown(self):
        masters.PGN_DIR = self.saved[0]
        masters.use_data_dir(self.saved[1])
        masters._summaries.clear()
        shutil.rmtree(self.folder, ignore_errors=True)

    def test_summary_finds_the_master_and_their_record(self):
        info = masters.summary('Legend')
        self.assertEqual(info['name'], 'Hero Legend')
        self.assertEqual(info['games'], 3)  # the game between two others is not theirs
        self.assertEqual((info['wins'], info['draws'], info['losses']), (1, 1, 1))
        self.assertEqual(info['peak'], 2750)
        self.assertEqual(info['years'], [2020, 2022])
        self.assertEqual([m['id'] for m in masters.available()], ['Legend'])

    def test_book_holds_only_the_masters_own_moves(self):
        data = masters.book('Legend')
        start = masters.position_key(chess.Board())
        self.assertEqual({uci: n for uci, (n, _) in data['book'][start].items()}, {'e2e4': 1, 'd2d4': 1})
        after_e4 = chess.Board()
        after_e4.push_san('e4')
        # As Black, the master answered 1.e4 with c5; the rival's moves are not in the book.
        self.assertEqual(list(data['book'][masters.position_key(after_e4)]), ['c7c5'])
        # The variation (2.c3) is skipped; the main line continues with 2...d6.
        board = chess.Board()
        for san in ('e4', 'c5', 'Nf3'):
            board.push_san(san)
        self.assertEqual(list(data['book'][masters.position_key(board)]), ['d7d6'])
        self.assertTrue((self.folder / 'data' / 'masters' / 'Legend.json').is_file())

    def test_book_move_follows_the_games_then_runs_out(self):
        data = masters.book('Legend')
        board = chess.Board()
        hit = masters.book_move(data, board, random.Random(1))
        self.assertIn(hit['move'].uci(), ('e2e4', 'd2d4'))
        self.assertEqual(hit['total'], 2)
        self.assertIn('Rival', hit['game']['opponent'])
        board.push_san('h4')
        self.assertIsNone(masters.book_move(data, board))

    def test_unknown_or_unsafe_ids_are_refused(self):
        for bad in ('Nobody', '../secrets', ''):
            with self.assertRaises(masters.MasterError):
                masters.summary(bad)

    def test_first_run_fill_fetches_every_missing_legend_and_skips_failures(self):
        saved = masters.download_masters.CHAMPIONS, masters.download_masters.fetch
        masters.download_masters.CHAMPIONS = ['Legend', 'Second', 'Broken']
        second = PGN.replace('Legend,Hero', 'Second,Hero').replace('Legend,H', 'Second,H')

        def fetch(name):
            if name == 'Broken':
                raise OSError('offline')
            return second.encode()
        masters.download_masters.fetch = fetch
        try:
            self.assertEqual([m['id'] for m in masters.missing()], ['Second', 'Broken'])
            with self.assertLogs('torre.games.masters', 'WARNING'):  # the failed legend is logged and skipped
                masters.FILL.start(pause=0)
                masters.FILL.join(5)
            status = masters.fill_status()
            self.assertEqual((status['running'], status['done'], status['total']), (False, 2, 2))
            self.assertEqual(status['failed'], ['Broken'])
            self.assertTrue((self.folder / 'data' / 'masters' / 'pgn' / 'Second.pgn').is_file())
            self.assertEqual([m['id'] for m in masters.missing()], ['Broken'])
        finally:
            masters.download_masters.CHAMPIONS, masters.download_masters.fetch = saved

    def test_every_legend_has_a_display_name(self):
        unnamed = [c for c in masters.download_masters.CHAMPIONS if c not in masters.NAMES]
        self.assertEqual(unnamed, [])

    def test_opening_pool_keeps_the_lines_the_legends_repeat(self):
        arena._pool_cache.clear()
        self.addCleanup(arena._pool_cache.clear)
        pool = arena.opening_pool(plies=2, min_games=2)  # 1.e4 e5 opens two games; every other start just one
        self.assertEqual([(p['moves'], p['san'], p['games']) for p in pool], [(['e2e4', 'e7e5'], '1.e4 e5', 2)])
        self.assertEqual(len(arena.opening_pool(plies=2, min_games=1)), 3)
        self.assertIs(arena.opening_pool(plies=2, min_games=2), pool)  # cached until a PGN changes


class SprtTests(unittest.TestCase):
    def test_llr_matches_hand_computed_values(self):
        # 10-20-5: score 4/7, per-game variance 5/49; 35 * 0.071498 * 0.071359 / (2 * 5/49) = 0.8750
        self.assertAlmostEqual(arena.sprt_llr(10, 20, 5, 0, 50), 0.8750, places=3)
        self.assertAlmostEqual(arena.sprt_llr(60, 100, 40, 0, 50), 1.6648, places=3)
        self.assertAlmostEqual(arena.sprt_llr(5, 10, 5, 0, 50), -0.4086, places=3)  # an even score leans to H0
        self.assertEqual(arena.sprt_llr(0, 0, 0), 0.0)
        # Swapping the players mirrors the hypotheses.
        self.assertAlmostEqual(arena.sprt_llr(7, 3, 12, 0, -50), arena.sprt_llr(12, 3, 7, 0, 50))
        lower, upper = arena.sprt_bounds(0.05, 0.05)
        self.assertAlmostEqual(upper, 2.9444, places=4)
        self.assertAlmostEqual(lower, -upper)

    def test_status_reaches_a_verdict_only_with_enough_evidence(self):
        config = arena.sprt_config(True)
        self.assertEqual((config['elo0'], config['elo1']), (0, 50))
        self.assertIsNone(arena.sprt_status((1, 0, 0), config)['verdict'])  # one win settles nothing
        self.assertIsNone(arena.sprt_status((6, 0, 0), config)['verdict'])
        self.assertEqual(arena.sprt_status((7, 0, 0), config)['verdict'], 'H1')
        self.assertIsNone(arena.sprt_status((0, 15, 0), config)['verdict'])
        self.assertEqual(arena.sprt_status((0, 16, 0), config)['verdict'], 'H0')
        self.assertIsNone(arena.sprt_status((0, 0, 6), config)['verdict'])
        self.assertEqual(arena.sprt_status((0, 0, 7), config)['verdict'], 'H0')

    def test_config_defaults_and_refusals(self):
        self.assertIsNone(arena.sprt_config(None))
        self.assertIsNone(arena.sprt_config(False))
        self.assertEqual(arena.sprt_config({'elo1': 100}), {'elo0': 0, 'elo1': 100, 'alpha': 0.05, 'beta': 0.05})
        for bad in ({'elo0': 50, 'elo1': 0}, {'alpha': 0.7}, {'beta': 0}, {'elo1': 'x'}, {'elo1': True}, 'yes'):
            with self.assertRaises(ValueError):
                arena.sprt_config(bad)


class FakeSide:
    @contextlib.contextmanager
    def process(self):
        yield None

    def prepare(self):
        pass


class ArenaLoopTests(unittest.TestCase):
    """The match loop with games stubbed out: SPRT stopping and the pairing of openings."""

    def run_match(self, games, results, openings='start', sprt=None, seed=None):
        job = arena.ArenaJob()
        job.data_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, job.data_dir, True)
        job.state['match'] = {'id': 'test', 'players': [], 'score': [0.0, 0.0], 'wdl': [0, 0, 0], 'games': [],
                              'current': None, 'error': None, 'stopped': False, 'early': False, 'sprt': None}
        played = []

        def play(number, sides, processes, judge_engine, movetime, line, pace, rng):
            first = results[number]
            played.append(line)
            with job.lock:
                match = job.state['match']
                match['score'][0] += first
                match['wdl'][{1.0: 0, 0.5: 1, 0.0: 2}[first]] += 1
                match['games'].append({'number': number + 1, 'opening': line[0]})
            return True
        job._play = play
        with mock.patch.object(arena.engines, 'installed', return_value=False):
            job.execute([FakeSide(), FakeSide()], games, 0.05, openings, 'fast', arena.sprt_config(sprt), seed)
        return job, played

    def test_sprt_stops_a_one_sided_match_and_records_why(self):
        job, played = self.run_match(50, [1.0] * 50, sprt=True)
        match = job.status()['match']
        self.assertEqual(len(played), 7)
        self.assertTrue(match['early'])
        self.assertFalse(match['stopped'])
        self.assertEqual(match['sprt']['verdict'], 'H1')
        self.assertGreaterEqual(match['sprt']['llr'], match['sprt']['upper'])
        saved = job.saved('test')
        self.assertEqual((saved['games_played'], saved['early'], saved['sprt']['verdict']), (7, True, 'H1'))

    def test_without_sprt_every_game_is_played(self):
        job, played = self.run_match(10, [1.0] * 10)
        match = job.status()['match']
        self.assertEqual((len(played), match['early'], match['sprt']), (10, False, None))

    def test_book_openings_pair_up_and_vary(self):
        pool = [{'id': str(i), 'moves': ['e2e4'], 'san': f'line {i}', 'eco': 'B00', 'name': 'Opening'} for i in range(10)]
        with mock.patch.object(arena, 'opening_pool', return_value=pool):
            _, played = self.run_match(10, [0.5] * 10, openings='book', seed=7)
            _, again = self.run_match(10, [0.5] * 10, openings='book', seed=7)
        names = [line[0] for line in played]
        self.assertEqual(names[0::2], names[1::2])  # both games of a pair share the line
        self.assertEqual(len(set(names)), 5)        # and no line repeats while the pool lasts
        self.assertEqual(played, again)             # a seed makes the draw repeatable
        self.assertEqual(played[0][2], {'eco': 'B00', 'openingName': 'Opening'})

    def test_pick_openings_cycles_once_the_pool_runs_out(self):
        picks = arena.pick_openings(['a', 'b', 'c'], 5, random.Random(1))
        self.assertEqual(len(picks), 5)
        self.assertEqual(sorted(picks[:3]), ['a', 'b', 'c'])
        self.assertEqual(arena.pick_openings([], 3, random.Random(1)), [])


class ArenaTests(unittest.TestCase):
    def test_elo_difference(self):
        self.assertEqual(arena.elo_difference(5, 10), 0)
        self.assertGreater(arena.elo_difference(7.5, 10), 150)
        self.assertLess(arena.elo_difference(2, 10), -200)
        self.assertIsNone(arena.elo_difference(10, 10))
        self.assertIsNone(arena.elo_difference(0, 0))

    def test_openings_are_legal(self):
        for opening_id, line in arena.OPENINGS:
            board = chess.Board()
            for uci in line.split():
                self.assertIn(chess.Move.from_uci(uci), board.legal_moves, opening_id)
                board.push_uci(uci)

    def test_bad_matches_are_refused(self):
        job = arena.ArenaJob()
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder, True)
        sf = {'engineId': 'stockfish'}
        for payload in ({'players': [sf]}, {'players': [sf, sf], 'games': 3}, {'players': [sf, sf], 'movetime': 9},
                        {'players': [sf, {'engineId': 'nope'}]}, {'players': [sf, {'engineId': 'stockfish', 'elo': 5}]},
                        {'players': [sf, sf], 'openings': 'random'}, {'players': [sf, sf], 'sprt': {'elo0': 10, 'elo1': 5}},
                        {'players': [sf, sf], 'seed': 'x'}):
            with self.assertRaises(ValueError):
                job.start(payload, folder)

    def test_moves_are_graded_like_game_analysis_from_the_judges_verdicts(self):
        start = chess.Board()
        best = arena.grade_move(start, chess.Move.from_uci('e2e4'), {'cp': 30, 'mate': None, 'best': 'e2e4'}, {'cp': 25, 'mate': None})
        self.assertTrue(best['best'])
        self.assertTrue(best['book'])
        self.assertIsNone(best['class'])
        self.assertEqual(arena.grade_name(best), 'book')
        blunder = arena.grade_move(start, chess.Move.from_uci('f2f3'), {'cp': 0, 'mate': None, 'best': 'e2e4'}, {'cp': -900, 'mate': None})
        self.assertEqual(arena.grade_name(blunder), 'blunder')
        # Checkmate ends the game (no verdict after it) and counts as the best move.
        fools = chess.Board('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2')
        mate = arena.grade_move(fools, chess.Move.from_uci('d8h4'), {'cp': None, 'mate': -1, 'best': 'd8h4'}, None)
        self.assertEqual(arena.grade_name(mate), 'best')
        self.assertIsNone(arena.grade_move(start, chess.Move.from_uci('e2e4'), None, {'cp': 25, 'mate': None}))
        self.assertEqual(arena.grade_name(arena.grade_move(start, chess.Move.from_uci('d2d4'), {'cp': 30, 'mate': None, 'best': 'e2e4'}, {'cp': 28, 'mate': None})), 'book')

    @unittest.skipUnless(engines.installed('stockfish'), 'Stockfish is not installed')
    def test_the_judge_scores_for_white_and_stops_at_the_end(self):
        with engines.POOL.session('stockfish', options={'Threads': 1}) as engine:
            up_a_queen = chess.Board('4k3/8/8/8/8/8/8/3QK3 w - - 0 1')
            self.assertGreater(arena.judge(engine, up_a_queen)['cp'] or 10000, 500)
            mated = chess.Board('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')
            self.assertIsNone(arena.judge(engine, mated))
        self.assertIsNone(arena.judge(None, chess.Board()))

    @unittest.skipUnless(engines.installed('stockfish'), 'Stockfish is not installed')
    def test_a_short_match_plays_out_and_is_saved(self):
        job = arena.ArenaJob()
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder, True)
        saved_max = arena.MAX_PLIES
        arena.MAX_PLIES = 30  # keep the test quick: games end as draws at move 15
        self.addCleanup(setattr, arena, 'MAX_PLIES', saved_max)
        job.start({'players': [{'engineId': 'stockfish', 'elo': 1500}, {'engineId': 'stockfish', 'elo': 2000}],
                   'games': 2, 'movetime': 0.05, 'openings': 'varied', 'pace': 'fast'}, folder)
        deadline = time.time() + 60
        while job.status()['running'] and time.time() < deadline:
            time.sleep(.1)
        match = job.status()['match']
        self.assertIsNone(match['error'])
        self.assertEqual(len(match['games']), 2)
        self.assertEqual(sum(match['score']), 2)
        self.assertEqual([g['white'] for g in match['games']], [0, 1])  # colors alternate
        # Every move is graded; each game and the match keep the tally per player.
        totals = [{k: sum(g['grades'][p][k] for g in match['games']) for k in arena.GRADES} for p in (0, 1)]
        self.assertEqual(match['grades'], totals)
        self.assertGreater(sum(totals[0].values()) + sum(totals[1].values()), 0)
        self.assertEqual([g['opening'] for g in match['games']], ['italian', 'italian'])  # a pair shares its line
        self.assertEqual(match['players'][0]['name'], 'Stockfish 1500')
        self.assertIsNone(match['current'])  # cleared once the match is over
        rows = (Path(folder) / 'arena.jsonl').read_text(encoding='utf-8').splitlines()
        self.assertEqual(json.loads(rows[0])['games_played'], 2)
        self.assertEqual(job.recent()[0]['id'], match['id'])
        self.assertEqual(len(job.saved(match['id'])['games'][0]['moves']), match['games'][0]['plies'])


class FakeHarness:
    """Prompture's ChessHarness without a model: the first legal move (in SAN order), a reason and a cost."""

    def __init__(self, cost=0.25):
        self.cost = cost

    def choose(self, board):
        move = sorted(board.legal_moves, key=board.san)[0]
        return types.SimpleNamespace(move=move, reason=f'{board.san(move)} looks fine', rescued=False,
                                     attempts=[types.SimpleNamespace(error='not a legal move'), types.SimpleNamespace(error=None)],
                                     usage={'cost': self.cost, 'total_tokens': 1200})


class AiPlayerTests(unittest.TestCase):
    """AI players through Prompture's harness, with the model replaced by FakeHarness."""

    def setUp(self):
        # The installed Prompture may predate prompture.games: the import check only needs the module.
        harness_module = types.ModuleType('prompture.games.chess')
        harness_module.ChessHarness = object
        patcher = mock.patch.dict(sys.modules, {'prompture.games': types.ModuleType('prompture.games'),
                                                'prompture.games.chess': harness_module})
        patcher.start()
        self.addCleanup(patcher.stop)

    def ai(self, model='claude/claude-fable-5-1', **spec):
        return {'ai': {'model': model, **spec}}

    def test_a_player_is_an_ai_when_the_request_says_so(self):
        player = arena.make_player(self.ai(effort='high', name='Fable'))
        self.assertIsInstance(player, arena.AiPlayer)
        self.assertEqual(player.describe()['ai'], {'model': 'claude/claude-fable-5-1', 'level': 0, 'effort': 'high'})
        self.assertEqual(player.name, 'Fable')
        self.assertEqual(arena.make_player(self.ai('openai/gpt-6-astra')).name, 'gpt-6-astra')

    def test_bad_ai_players_are_refused(self):
        for spec in ({'model': 'gpt-6-astra'}, {'model': 'openai/gpt-6-astra', 'level': 6},
                     {'model': 'openai/gpt-6-astra', 'level': True}, {'model': 'openai/gpt-6-astra', 'effort': 'huge'}):
            with self.assertRaises(ValueError):
                arena.make_player({'ai': spec})

    def test_effort_goes_by_each_providers_name_for_it(self):
        base = {'max_tokens': arena.AI_MAX_TOKENS, 'timeout': arena.AI_TIMEOUT_S}
        self.assertEqual(arena.make_player(self.ai(effort='xhigh')).options(), {**base, 'effort': 'xhigh'})
        self.assertEqual(arena.make_player(self.ai('openai/gpt-6-astra', effort='high')).options(), {**base, 'reasoning_effort': 'high'})
        self.assertNotIn('effort', arena.make_player(self.ai()).options())

    def play(self, cost_cap=None, cost=0.25, harness=None, **payload):
        job = arena.ArenaJob()
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder, True)
        saved_max = arena.MAX_PLIES
        arena.MAX_PLIES = 20
        self.addCleanup(setattr, arena, 'MAX_PLIES', saved_max)

        @contextlib.contextmanager
        def process(player):
            yield harness or FakeHarness(cost)
        with mock.patch.object(arena.AiPlayer, 'process', process):
            job.start({'players': [self.ai(name='A'), self.ai('openai/gpt-6-astra', name='B')], 'games': 1,
                       'movetime': 0.05, 'openings': 'start', 'pace': 'fast', 'costCap': cost_cap, **payload}, folder)
            deadline = time.time() + 60
            while job.status()['running'] and time.time() < deadline:
                time.sleep(.05)
        return job, job.status()['match']

    def test_an_ai_game_keeps_what_each_model_said_and_spent(self):
        job, match = self.play()
        self.assertIsNone(match['error'])
        game = match['games'][0]
        self.assertEqual(game['result'], '1/2-1/2')  # the fake model repeats itself into a draw
        plies = game['plies']
        self.assertEqual(len(game['ai']), plies)
        first = game['ai'][0]
        self.assertEqual((first['tries'], first['errors'], first['tokens']), (2, ['not a legal move'], 1200))
        self.assertTrue(first['reason'].endswith('looks fine'))
        self.assertEqual(match['cost'], [0.25 * ((plies + 1) // 2), 0.25 * (plies // 2)])
        saved = job.saved(match['id'])
        self.assertEqual((saved['cost'], saved['capped'], len(saved['games'][0]['ai'])), (match['cost'], False, plies))

    def test_the_cost_cap_ends_the_match_and_keeps_the_unfinished_game(self):
        job, match = self.play(cost_cap=1.0)
        self.assertTrue(match['capped'])
        self.assertTrue(match['stopped'])
        game = match['games'][0]
        self.assertEqual((game['result'], game['termination'], game['plies']), ('*', 'cost cap', 4))
        self.assertEqual(match['score'], [0.0, 0.0])  # an unfinished game is not scored
        self.assertIsNone(match['elo_diff'])
        self.assertEqual(job.saved(match['id'])['games'][0]['result'], '*')

    def test_a_model_the_provider_refuses_stops_the_match_instead_of_playing_random_moves(self):
        broken = types.SimpleNamespace(choose=lambda board: types.SimpleNamespace(
            move=next(iter(board.legal_moves)), reason='', rescued=True, usage={},
            attempts=[types.SimpleNamespace(error='the model call failed (Error code: 400 - credit balance is too low)')] * 3))
        player = arena.make_player(self.ai())
        with self.assertRaisesRegex(RuntimeError, 'credit balance'):
            player.choose(broken, chess.Board(), 0.1, random.Random(1))
        # A reply cut off before it said anything is no answer either.
        silent = types.SimpleNamespace(choose=lambda board: types.SimpleNamespace(
            move=next(iter(board.legal_moves)), reason='', rescued=True, usage={}, attempts=[types.SimpleNamespace(
                reply=None, error='the reply was not valid JSON (the reply hit max_tokens before any answer was written)')] * 3))
        with self.assertRaisesRegex(RuntimeError, 'max_tokens'):
            player.choose(silent, chess.Board(), 0.1, random.Random(1))
        # A model that answers badly three times is still rescued: that is the harness doing its job.
        sloppy = types.SimpleNamespace(choose=lambda board: types.SimpleNamespace(
            move=next(iter(board.legal_moves)), reason='', rescued=True, usage={},
            attempts=[types.SimpleNamespace(reply='Qh9', error='"Qh9" is not one of the moves offered')] * 3))
        move, note = player.choose(sloppy, chess.Board(), 0.1, random.Random(1))
        self.assertTrue(note['ai']['rescued'])

    def test_a_game_continues_from_the_moves_it_was_cut_short_at(self):
        line = ['e2e4', 'c7c5', 'g1f3']
        job, match = self.play(startMoves=line)
        game = match['games'][0]
        self.assertEqual(game['moves'][:3], line)
        self.assertEqual((game['continued'], match['settings']['startMoves']), (3, line))
        self.assertIsNone(game['ai'][0])  # the moves it started from were played before this match
        self.assertIsNotNone(game['ai'][3])

    def test_continuing_needs_legal_moves_and_one_game(self):
        for payload in ({'startMoves': ['e2e5']}, {'startMoves': 'e2e4'}, {'startMoves': ['e2e4'], 'games': 2}):
            with self.assertRaises(ValueError):
                arena.ArenaJob().start({'players': [self.ai(), self.ai()], 'games': 1, 'openings': 'start', **payload}, tempfile.gettempdir())

    def test_a_failed_model_call_keeps_the_game_played_so_far(self):
        class Dies(FakeHarness):
            def choose(self, board):
                if len(board.move_stack) == 4:
                    raise RuntimeError('B: the model call failed (timed out)')
                return super().choose(board)
        job, match = self.play(harness=Dies())
        self.assertIn('timed out', match['error'])
        game = match['games'][0]
        self.assertEqual((game['result'], game['termination'], game['plies']), ('*', 'model error', 4))
        self.assertEqual(job.saved(match['id'])['games'][0]['moves'], game['moves'])

    def test_the_cap_refuses_nonsense(self):
        for cap in (0, -1, 'ten', True):
            with self.assertRaises(ValueError):
                arena.ArenaJob().start({'players': [self.ai(), self.ai()], 'games': 1, 'costCap': cap}, tempfile.gettempdir())


if __name__ == '__main__':
    unittest.main()
