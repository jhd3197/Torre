import io
import json
import unittest
from unittest.mock import patch

import chess
import chess.pgn

from torre.analysis import analyze
from torre.analysis import game_export
from torre.server import appdata
from torre.server import studio
class GameExportTests(unittest.TestCase):
    def test_unknown_data_is_not_zero_and_pgn_is_portable(self):
        pgn = '[White "You"]\n[Black "Bot"]\n\n1. e4 e5 *'
        report = game_export.game_report(pgn)
        self.assertEqual(report['game']['pgn'], pgn)
        self.assertEqual(report['timing']['unknown_count'], 2)
        self.assertEqual(report['timing']['summary'], [])
        self.assertIsNone(report['quality']['moves'][0]['accuracy'])
        self.assertIsNone(report['quality']['summary'][0]['blunders'])
        self.assertFalse(report['quality']['available'])
        self.assertEqual(report['game']['moves'][0]['legal_move_count'], 20)
        json.dumps(report, allow_nan=False)

    def test_clocks_account_for_increment_and_separate_players(self):
        report = game_export.game_report('[TimeControl "60+2"]\n\n'
                                        '1. e4 {[%clk 0:00:59]} e5 {[%clk 0:01:01]} '
                                        '2. Nf3 {[%clk 0:00:55]} Nc6 {[%clk 0:01:00]} *')
        self.assertEqual([m['elapsed_ms'] for m in report['timing']['moves']], [3000, 1000, 6000, 3000])
        self.assertEqual([s['mean_ms'] for s in report['timing']['summary']], [4500, 2000])

    def test_missing_clock_breaks_chain_and_negative_delta_is_unknown(self):
        report = game_export.game_report('[TimeControl "60"]\n\n'
                                        '1. e4 {[%clk 0:00:59]} e5 2. Nf3 Nc6 '
                                        '3. Bb5 {[%clk 0:00:50]} a6 {[%clk 0:00:30]} '
                                        '4. Ba4 {[%clk 0:00:55]} *')
        self.assertEqual([m['elapsed_ms'] for m in report['timing']['moves']], [1000, None, None, None, None, None, None])

    def test_emt_is_preferred_and_complex_controls_are_not_guessed(self):
        for control in ('40/7200:3600', '60d2', '-', '?'):
            report = game_export.game_report(f'[TimeControl "{control}"]\n\n'
                                            '1. e4 {[%emt 0:00:00] [%clk 0:00:59]} e5 {[%clk 0:00:58]} *')
            self.assertEqual(report['timing']['moves'][0]['elapsed_ms'], 0)
            self.assertEqual(report['timing']['moves'][0]['source'], 'pgn_emt')
            self.assertIsNone(report['timing']['moves'][1]['elapsed_ms'])

    def test_custom_black_start_uses_actual_side_and_move_number(self):
        pgn = '[SetUp "1"]\n[FEN "7k/8/8/8/8/8/8/KR6 b - - 0 32"]\n[TimeControl "60"]\n\n32... Kg7 {[%clk 0:00:58]} *'
        report = game_export.game_report(pgn, {'scoring_version': analyze.SCORING_VERSION, 'evals': [[300, None], [600, None]], 'best_moves': ['h8g7']})
        self.assertEqual(report['game']['moves'][0]['color'], 'black')
        self.assertEqual(report['game']['moves'][0]['phase'], 'endgame')
        self.assertEqual(report['quality']['moves'][0]['centipawn_loss'], 300)
        self.assertTrue(report['quality']['moves'][0]['played_best'])
        self.assertIsNone(report['timing']['moves'][0]['elapsed_ms'])

    def test_analysis_covers_both_sides_and_fast_blunders_have_denominators(self):
        analysis = {'scoring_version': analyze.SCORING_VERSION, 'evals': [[0, None], [-300, None], [0, None]],
                    'best_moves': ['d2d4', 'c7c5']}
        report = game_export.game_report('1. e4 {[%emt 0:00:01]} e5 {[%emt 0:00:08]} *', analysis)
        self.assertEqual([d['judgment'] for d in report['quality']['moves']], ['blunder', 'blunder'])
        self.assertEqual(report['timing']['summary'][0]['fast_blunders'], 1)
        self.assertEqual(report['timing']['summary'][0]['fast_analyzed_count'], 1)
        self.assertIsNone(report['timing']['summary'][1]['fast_blunders'])
        for invalid in ({**analysis, 'scoring_version': 1}, {**analysis, 'evals': [[0, None]]}):
            self.assertFalse(game_export.game_report('1. e4 e5 *', invalid)['quality']['available'])

    def test_mate_evaluation_remains_distinct_from_centipawns(self):
        report = game_export.game_report('1. e4 *', {'scoring_version': analyze.SCORING_VERSION, 'evals': [[0, None], [None, -3]]})
        self.assertEqual(report['quality']['moves'][0]['eval_after'], {'cp': None, 'mate': -3})
        self.assertEqual(report['quality']['moves'][0]['judgment'], 'blunder')

    def test_live_measurements_are_checked_and_partial_times_excluded(self):
        timing = {'ply': 1, 'uci': 'e2e4', 'source': 'ui_active', 'elapsed_ms': 4200, 'partial': True}
        report = game_export.game_report('1. e4 e5 *', timings=[timing])
        self.assertEqual(report['timing']['partial_count'], 1)
        self.assertEqual(report['timing']['known_count'], 1)
        self.assertEqual(report['timing']['summary'], [])
        for change in ({'elapsed_ms': -1}, {'elapsed_ms': float('nan')}, {'elapsed_ms': True},
                       {'uci': 'd2d4'}, {'ply': 3}, {'partial': 'false'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                game_export.game_report('1. e4 *', timings=[{**timing, **change}])
        with self.assertRaises(ValueError):
            game_export.game_report('1. e4 *', timings=[timing, timing])

    def test_illegal_pgn_is_rejected(self):
        with self.assertRaises(ValueError):
            game_export.game_report('1. e4 e5 2. Ke2 Ke7 3. Ke4 *')


class ExportRouteTests(unittest.TestCase):
    def request(self, path, payload=None):
        handler = object.__new__(studio.Handler)
        handler.path = path
        body = json.dumps(payload).encode() if payload is not None else b''
        handler.headers = {'Host': '127.0.0.1:1886', 'Content-Type': 'application/json', 'X-Chess-Studio': '1',
                           'Content-Length': str(len(body))}
        handler.rfile, handler.wfile = io.BytesIO(body), io.BytesIO()
        headers, status = {}, []
        handler.send_response = status.append
        handler.send_header = lambda key, value: headers.update({key: value})
        handler.end_headers = lambda: None
        (handler.do_POST if payload is not None else handler.do_GET)()
        return status[0], headers, json.loads(handler.wfile.getvalue())

    def test_archive_download_and_missing_game(self):
        with patch.object(appdata, 'game_record', side_effect=lambda gid: {'id': 42, 'pgn': '1. e4 *'} if gid == '42' else None), \
                patch.object(appdata, 'analysis_record', return_value=None):
            status, headers, report = self.request('/api/games/42/export')
            self.assertEqual(status, 200)
            self.assertIn('.torre.json', headers['Content-Disposition'])
            self.assertEqual(report['game']['id'], 42)
            self.assertEqual(self.request('/api/games/404/export')[0], 404)

    def test_live_export_round_trips_position_and_timing(self):
        status, _, response = self.request('/api/export', {
            'initialFen': chess.STARTING_FEN, 'moves': ['e2e4'], 'playerColor': 'white',
            'headers': {'White': 'You', 'Black': 'Bot', 'Result': '*', 'TimeControl': '-'},
            'timings': [{'ply': 1, 'uci': 'e2e4', 'elapsed_ms': 500, 'source': 'ui_active', 'partial': False}],
        })
        self.assertEqual(status, 200)
        report = response['report']
        restored = chess.pgn.read_game(io.StringIO(report['game']['pgn']))
        self.assertEqual(restored.end().board().fen(), report['game']['final_fen'])
        self.assertEqual(report['timing']['moves'][0]['elapsed_ms'], 500)
        self.assertFalse(report['quality']['available'])
        self.assertEqual(self.request('/api/export', {'moves': ['e2e5']})[0], 400)


if __name__ == '__main__':
    unittest.main()
