"""Node-limited strength and per-engine config profiles (engines.py, arena.py, studio.py)."""
import json
import random
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import chess
import chess.engine

from torre.server import appdata
from torre.games import arena
from torre.analysis import engine_service
from torre.analysis import engines
REPORTED = [
    {'name': 'Hash', 'type': 'spin', 'default': 16, 'min': 1, 'max': 33554432, 'var': []},
    {'name': 'Threads', 'type': 'spin', 'default': 1, 'min': 1, 'max': 1024, 'var': []},
    {'name': 'MultiPV', 'type': 'spin', 'default': 1, 'min': 1, 'max': 256, 'var': []},
    {'name': 'Skill Level', 'type': 'spin', 'default': 20, 'min': 0, 'max': 20, 'var': []},
    {'name': 'Ponder', 'type': 'check', 'default': False, 'min': None, 'max': None, 'var': []},
    {'name': 'Show WDL', 'type': 'check', 'default': False, 'min': None, 'max': None, 'var': []},
    {'name': 'Style', 'type': 'combo', 'default': 'Normal', 'min': None, 'max': None, 'var': ['Solid', 'Normal', 'Risky']},
    {'name': 'Clear Hash', 'type': 'button', 'default': None, 'min': None, 'max': None, 'var': []},
    {'name': 'EvalFile', 'type': 'string', 'default': 'nn.nnue', 'min': None, 'max': None, 'var': []},
]


class TempDataDir(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved_dir = engines.DATA_DIR
        engines.use_data_dir(self.tmp.name)
        self.addCleanup(self.restore)

    def restore(self):
        engines.use_data_dir(self.saved_dir)
        self.tmp.cleanup()


class NodeStrengthTests(unittest.TestCase):
    def test_the_table_maps_both_ways_and_rises_smoothly(self):
        ratings = list(range(1200, 3151, 50))
        nodes = [engines.nodes_for_elo(elo) for elo in ratings]
        self.assertEqual(nodes, sorted(nodes))
        self.assertEqual(len(set(nodes)), len(nodes))  # every step buys some nodes
        for elo, budget in zip(ratings, nodes):
            self.assertLessEqual(abs(engines.elo_for_nodes(budget) - elo), 2)
        for budget, elo in engines.NODE_ELO_TABLE:
            self.assertEqual((engines.nodes_for_elo(elo), engines.elo_for_nodes(budget)), (budget, elo))

    def test_out_of_range_clamps_to_the_table(self):
        low, high = engines.NODE_ELO_TABLE[0], engines.NODE_ELO_TABLE[-1]
        self.assertEqual(engines.nodes_for_elo(400), low[0])
        self.assertEqual(engines.nodes_for_elo(3500), high[0])
        self.assertEqual(engines.elo_for_nodes(1), low[1])
        self.assertEqual(engines.elo_for_nodes(10 ** 8), high[1])

    def test_node_limits_validate(self):
        self.assertEqual(engines.node_limits({}), (None, None))
        self.assertEqual(engines.node_limits({'nodes': 800, 'depth': 6}), (800, 6))
        for bad in ({'nodes': 0}, {'nodes': '800'}, {'nodes': True}, {'nodes': 10 ** 9}, {'depth': 100}, {'depth': 2.5}):
            with self.assertRaises(ValueError):
                engines.node_limits(bad)

    def test_search_limit_prefers_the_caps(self):
        self.assertEqual(engines.search_limit(None, None, .35), chess.engine.Limit(time=.35))
        self.assertEqual(engines.search_limit(800, None, .35), chess.engine.Limit(nodes=800))
        self.assertEqual(engines.search_limit(None, 5, .35), chess.engine.Limit(depth=5))


class FakeEngine:
    def __init__(self, move):
        self.move = move
        self.limits = []

    def play(self, board, limit, info=None):
        self.limits.append(limit)
        return chess.engine.PlayResult(self.move, None, {})


class ArenaNodeTests(unittest.TestCase):
    def player(self, spec):
        with mock.patch.object(arena.engines, 'installed', return_value=True):
            return arena.Player(spec)

    def test_a_node_capped_seat_plays_by_nodes_and_shows_an_approximate_rating(self):
        player = self.player({'engineId': 'stockfish', 'nodes': 800})
        self.assertEqual((player.nodes, player.depth, player.options), (800, None, {}))
        self.assertEqual(player.name, 'Stockfish (800 nodes)')
        info = player.describe()
        self.assertEqual((info['nodes'], info['rating']), (800, 1800))
        engine = FakeEngine(chess.Move.from_uci('e2e4'))
        move, _ = player.choose(engine, chess.Board(), 0.1, random.Random(1))
        self.assertEqual((move.uci(), engine.limits), ('e2e4', [chess.engine.Limit(nodes=800)]))

    def test_without_caps_the_movetime_still_rules(self):
        player = self.player({'engineId': 'stockfish'})
        engine = FakeEngine(chess.Move.from_uci('d2d4'))
        player.choose(engine, chess.Board(), 0.3, random.Random(1))
        self.assertEqual(engine.limits, [chess.engine.Limit(time=0.3)])
        self.assertIsNone(player.describe()['nodes'])

    def test_a_rating_and_a_depth_cap_combine(self):
        player = self.player({'engineId': 'stockfish', 'elo': 2000, 'depth': 8})
        self.assertEqual(player.options['UCI_Elo'], 2000)
        self.assertEqual(player.describe()['rating'], 2000)
        engine = FakeEngine(chess.Move.from_uci('d2d4'))
        player.choose(engine, chess.Board(), 0.3, random.Random(1))
        self.assertEqual(engine.limits, [chess.engine.Limit(depth=8)])

    def test_bad_caps_are_refused(self):
        with self.assertRaises(ValueError):
            self.player({'engineId': 'stockfish', 'nodes': -5})


class ProfileTests(TempDataDir):
    def test_values_are_checked_against_the_reported_options(self):
        cleaned = engines.validate_profile('stockfish', {'hash': '256', 'THREADS': 2, 'style': 'risky', 'show wdl': 'true',
                                                         'MultiPV': 3, 'EvalFile': 'big.nnue'}, REPORTED)
        self.assertEqual(cleaned, {'Hash': 256, 'Threads': 2, 'Style': 'Risky', 'Show WDL': True, 'MultiPV': 3, 'EvalFile': 'big.nnue'})
        for bad in ({'Contempt': 20}, {'Hash': 0}, {'Threads': 'many'}, {'Skill Level': 21}, {'Style': 'Wild'},
                    {'Show WDL': 3}, {'Clear Hash': True}, {'Ponder': True}, {'EvalFile': 'a\nb'}, []):
            with self.assertRaises(ValueError, msg=bad):
                engines.validate_profile('stockfish', bad, REPORTED)

    def test_without_a_report_only_the_shape_is_checked(self):
        self.assertEqual(engines.validate_profile('stockfish', {'Contempt': 20, 'Book': 'x.bin'}), {'Contempt': 20, 'Book': 'x.bin'})
        for bad in ({'Hash': 1.5}, {'Hash': [1]}, {'': 1}, {'UCI_Chess960': True}):
            with self.assertRaises(ValueError):
                engines.validate_profile('stockfish', bad)
        with self.assertRaises(ValueError):
            engines.validate_profile('no-such-engine', {})

    def test_save_load_delete(self):
        with mock.patch.object(engines, 'reported_options', return_value=REPORTED), mock.patch.object(engines.POOL, 'close') as close:
            self.assertEqual(engines.save_profile('stockfish', {'Hash': 512, 'MultiPV': 5}), {'Hash': 512, 'MultiPV': 5})
            close.assert_called_with('stockfish')  # running processes restart with the profile
        stored = json.loads((Path(self.tmp.name) / 'engine_profiles.json').read_text(encoding='utf-8'))
        self.assertEqual(stored['profiles']['stockfish']['options'], {'Hash': 512, 'MultiPV': 5})
        self.assertEqual(engines.get_profile('stockfish'), {'Hash': 512, 'MultiPV': 5})
        self.assertEqual(engines.profile_multipv('stockfish'), 5)
        self.assertEqual(engines.profile_multipv('reckless'), 3)
        with mock.patch.object(engines.POOL, 'close'):
            self.assertTrue(engines.delete_profile('stockfish'))
            self.assertFalse(engines.delete_profile('stockfish'))
        self.assertEqual(engines.get_profile('stockfish'), {})

    def test_an_empty_profile_is_removed(self):
        with mock.patch.object(engines, 'reported_options', return_value=REPORTED), mock.patch.object(engines.POOL, 'close'):
            engines.save_profile('stockfish', {'Hash': 64})
            engines.save_profile('stockfish', {})
        self.assertEqual(engines.load_profiles(), {})

    def test_the_profile_sits_between_the_defaults_and_a_bots_strength(self):
        with mock.patch.object(engines, 'reported_options', return_value=REPORTED), mock.patch.object(engines.POOL, 'close'):
            engines.save_profile('stockfish', {'Hash': 256, 'Skill Level': 5})
        merged = engines.session_options('stockfish', None, {'Threads': 2, 'Hash': 64, 'UCI_LimitStrength': True, 'UCI_Elo': 1500, 'Skill Level': 20})
        self.assertEqual(merged, {'Threads': 2, 'Hash': 256, 'UCI_LimitStrength': True, 'UCI_Elo': 1500, 'Skill Level': 20})
        self.assertEqual(engines.session_options('stockfish', None, {'Hash': 64}), {'Hash': 256, 'Skill Level': 5})
        self.assertEqual(engines.session_options('stockfish', None, {'Hash': 64}, profile=False), {'Hash': 64})

    def test_a_models_weights_win_over_the_profile(self):
        with mock.patch.object(engines, 'reported_options', return_value=None), mock.patch.object(engines.POOL, 'close'):
            engines.save_profile('lc0', {'WeightsFile': 'other.pb.gz', 'Threads': 3})
        model = next(m for m in engines.get('lc0')['models'] if m['id'] == 'maia-1100')
        with mock.patch.dict(model, installed=True):
            merged = engines.session_options('lc0', 'maia-1100', {'Threads': 2})
        self.assertEqual(merged['Threads'], 3)
        self.assertTrue(merged['WeightsFile'].endswith('maia-1100.pb.gz'))

    def test_managed_options_are_not_sent_to_configure(self):
        class Configurable:
            options = {'Hash': object(), 'MultiPV': object()}
            configured = None

            def configure(self, options):
                self.configured = options
        engine = Configurable()
        engines._configure_supported(engine, {'Hash': 128, 'MultiPV': 4, 'Unknown': 1})
        self.assertEqual(engine.configured, {'Hash': 128})

    @unittest.skipUnless(engines.installed('stockfish'), 'Stockfish is not installed')
    def test_stockfish_reports_its_options(self):
        reported = engines.reported_options('stockfish')
        names = {o['name'] for o in reported}
        self.assertTrue({'Hash', 'Threads', 'MultiPV', 'Skill Level'} <= names)
        self.assertEqual(reported, engines.reported_options('stockfish'))  # cached
        self.assertIsNone(engines.reported_options('reckless') if not engines.installed('reckless') else None)


class ProfileServerTests(unittest.TestCase):
    """The profile endpoints and node-capped bot moves through the real request handler."""
    @classmethod
    def setUpClass(cls):
        from http.server import ThreadingHTTPServer
        from torre.server import studio
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved_dir = appdata.DATA_DIR
        studio.use_data_dir(Path(cls.tmp.name))
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), studio.Handler)
        cls.base = f'http://127.0.0.1:{cls.server.server_address[1]}'
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        from torre.server import studio
        cls.server.shutdown()
        cls.server.server_close()
        studio.use_data_dir(cls.saved_dir)
        cls.tmp.cleanup()

    def get(self, path):
        from urllib.request import urlopen
        with urlopen(self.base + path) as response:
            return json.loads(response.read())

    def post(self, path, body):
        from urllib.error import HTTPError
        from urllib.request import Request, urlopen
        request = Request(self.base + path, json.dumps(body).encode(), {'Content-Type': 'application/json', 'X-Chess-Studio': '1'})
        try:
            with urlopen(request) as response:
                return response.status, json.loads(response.read())
        except HTTPError as exc:
            return exc.code, json.loads(exc.read())

    def test_profile_crud(self):
        with mock.patch.object(engines, 'reported_options', return_value=REPORTED), mock.patch.object(engines.POOL, 'close'):
            status, body = self.post('/api/engines/profile', {'engineId': 'stockfish', 'options': {'hash': 128, 'MultiPV': 4}})
            self.assertEqual((status, body['options']), (200, {'Hash': 128, 'MultiPV': 4}))
            status, body = self.post('/api/engines/profile', {'engineId': 'stockfish', 'options': {'Contempt': 10}})
            self.assertEqual(status, 400)
            self.assertIn('Contempt', body['error'])
            shown = self.get('/api/engines/profile?engineId=stockfish')
            self.assertEqual((shown['options'], shown['reported']), ({'Hash': 128, 'MultiPV': 4}, REPORTED))
            self.assertIn('stockfish', self.get('/api/engines/profiles')['profiles'])
            status, body = self.post('/api/engines/profile/delete', {'engineId': 'stockfish'})
            self.assertEqual((status, body['profiles']), (200, {}))
        status, _ = self.post('/api/engines/profile', {'engineId': 'nope', 'options': {}})
        self.assertEqual(status, 400)

    @unittest.skipUnless(engines.installed('stockfish'), 'Stockfish is not installed')
    def test_a_bot_can_play_by_nodes(self):
        status, body = self.post('/api/engine', {'moves': ['e2e4'], 'play': True, 'level': 4, 'nodes': 50})
        self.assertEqual(status, 200)
        board = chess.Board()
        board.push_uci('e2e4')
        self.assertIn(chess.Move.from_uci(body['best']), board.legal_moves)
        status, _ = self.post('/api/engine', {'moves': [], 'play': True, 'nodes': 0})
        self.assertEqual(status, 400)

    @unittest.skipUnless(engines.installed('stockfish'), 'Stockfish is not installed')
    def test_analysis_depth_sets_the_thinking_time(self):
        seen = []
        def lines(engine, board, seconds, multipv=3):
            seen.append(seconds)
            return {'lines': [], 'best': None}
        with mock.patch.object(engine_service, 'engine_lines', side_effect=lines):
            for depth in (None, 'quick', 'deep'):
                status, _ = self.post('/api/engine', {'moves': ['e2e4'], **({'depth': depth} if depth else {})})
                self.assertEqual(status, 200)
        self.assertEqual(seen, [.55, .25, 1.5])
        status, body = self.post('/api/engine', {'moves': [], 'depth': 'forever'})
        self.assertEqual(status, 400)
        self.assertIn('depth', body['error'])


if __name__ == '__main__':
    unittest.main()
