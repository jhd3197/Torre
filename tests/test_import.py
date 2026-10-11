"""Import page checks: .venv/Scripts/python -m unittest test_import -v"""
import json
import logging
import tempfile
import unittest
from pathlib import Path

from torre.games import importer
logging.getLogger('chess.pgn').setLevel(logging.CRITICAL)  # the broken-game test is meant to be broken

PGN = '''[Event "Casual"]
[Site "https://www.chess.com/game/live/123456"]
[Date "2026.08.02"]
[White "jhd3197"]
[Black "Rival"]
[Result "0-1"]
[WhiteElo "750"]
[BlackElo "780"]
[Termination "Rival won by checkmate"]

1. f3 e5 2. g4 Qh4# 0-1
'''

MONTH = {'games': [
    {'url': 'https://www.chess.com/game/daily/777', 'pgn': PGN.replace('live/123456', 'daily/777'), 'time_class': 'daily',
     'rules': 'chess', 'end_time': 1790000000, 'accuracies': {'white': 12.5, 'black': 99.0},
     'white': {'username': 'JHD3197'}, 'black': {'username': 'Rival'}},
    {'url': 'https://www.chess.com/game/live/888', 'pgn': '', 'rules': 'chess960', 'time_class': 'blitz',
     'white': {'username': 'jhd3197'}, 'black': {'username': 'x'}},
]}

LICHESS = {'id': 'abcdEFGH', 'variant': 'standard', 'speed': 'blitz', 'lastMoveAt': 1790000000000,
           'players': {'white': {'user': {'name': 'Rival', 'id': 'rival'}}, 'black': {'aiLevel': 3}},
           'pgn': PGN.replace('jhd3197', 'Rival2').replace('"Rival"', '"lichess AI level 3"').replace('White "Rival2"', 'White "Me"')}


class ImporterTests(unittest.TestCase):
    def test_pgn_record_knows_your_side_and_result(self):
        record = importer.to_record(PGN, {'jhd3197'}, id='1', type='live')
        self.assertEqual((record['user_color'], record['opponent'], record['user_result']), ('white', 'Rival', 0))
        self.assertEqual((record['user_rating'], record['opp_rating'], record['plies']), (750, 780, 4))
        self.assertEqual(record['end_reason'], 'Rival won by checkmate')
        with self.assertRaisesRegex(ValueError, 'Neither player'):
            importer.to_record(PGN, {'someone'}, id='1', type='live')

    def test_chesscom_month_skips_variants_and_keeps_accuracy(self):
        archives = {'archives': ['https://api.chess.com/pub/player/jhd3197/games/2026/07',
                                 'https://api.chess.com/pub/player/jhd3197/games/2026/08']}
        seen = []
        def get(url):
            seen.append(url)
            return archives if url.endswith('/archives') else MONTH
        records, failed = importer.chesscom_games('JHD3197', '2026-08-01', get=get)
        self.assertEqual(seen[1:], [archives['archives'][1]])  # July is before the range
        self.assertEqual(failed, [])
        [record] = records
        self.assertEqual((record['id'], record['type'], record['user_accuracy']), ('777', 'daily', 12.5))
        self.assertEqual(record['url'], 'https://www.chess.com/game/daily/777')

    def test_chesscom_games_keep_their_clocks(self):
        clocked = PGN.replace('1. f3 e5 2. g4 Qh4# 0-1', '1. f3 {[%clk 0:02:59.9]} e5 {[%clk 0:02:58]} 2. g4 {[%clk 0:02:50]} Qh4# {[%clk 0:02:57]} 0-1')
        month = {'games': [{**MONTH['games'][0], 'pgn': clocked}]}
        records, _ = importer.chesscom_games('JHD3197', '2026-08-01', get=lambda url: {'archives': ['https://api.chess.com/pub/player/jhd3197/games/2026/08']} if url.endswith('/archives') else month)
        self.assertIn('[%clk 0:02:50]', records[0]['pgn'])
        records, _ = importer.pgn_games(clocked, {'jhd3197'})
        self.assertIn('[%clk 0:02:57]', records[0]['pgn'])

    def test_unknown_chesscom_player(self):
        def get(url):
            raise LookupError(url)
        with self.assertRaisesRegex(importer.ImportProblem, 'no chess.com player'):
            importer.chesscom_games('nobody', None, get=get)

    def test_lichess_game_against_the_computer(self):
        lines = [json.dumps(LICHESS), '', json.dumps({**LICHESS, 'id': 'zzzzzzzz', 'variant': 'atomic'})]
        records, failed = importer.lichess_games('me', None, stream=lambda url: iter(lines))
        self.assertEqual(failed, [])
        [record] = records
        self.assertEqual((record['id'], record['type'], record['user_color']), ('li-abcdEFGH', 'computer', 'white'))
        self.assertEqual(record['end_time_unix'], 1790000000)

    def test_pgn_collection_reports_broken_games_and_keeps_the_rest(self):
        broken = PGN.replace('2. g4 Qh4#', '2. Ke5 Qh4#').replace('live/123456', 'live/2')
        anonymous = PGN.replace('[Site "https://www.chess.com/game/live/123456"]\n', '')
        records, failed = importer.pgn_games(PGN + '\n' + broken + '\n' + anonymous, {'jhd3197'})
        self.assertEqual([r['id'] for r in records][0], '123456')
        self.assertTrue(records[1]['id'].startswith('pgn-'))
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]['where'], '#2')

    def test_players_are_counted_for_the_who_are_you_question(self):
        self.assertEqual(importer.pgn_players(PGN + PGN.replace('Rival', 'Other'))[0], ('jhd3197', 2))

    def test_extension_export_is_read_as_json(self):
        export = {'games': [{'id': 5, 'type': 'computer', 'data': {'game': {
            'pgnHeaders': {'White': 'jhd3197', 'Black': 'Duke-BOT', 'Result': '1-0', 'Date': '2026.09.05'},
            'moveList': 'mC0Kgv5Q', 'isFinished': True}}}]}
        records, failed = importer.read_file('export.json', json.dumps(export), {'jhd3197'})
        self.assertEqual(failed, [])
        self.assertEqual((records[0]['id'], records[0]['type'], records[0]['user_color']), ('5', 'computer', 'white'))
        with self.assertRaises(importer.ImportProblem):
            importer.read_file('x.json', '{"nope": 1}', {'jhd3197'})

    def test_append_skips_games_already_in_the_library(self):
        with tempfile.TemporaryDirectory() as folder:
            games = Path(folder) / 'games.jsonl'
            games.write_text(json.dumps({'id': '123456'}) + '\n', encoding='utf-8')
            record = importer.to_record(PGN, {'jhd3197'}, id='123456', type='live')
            other = {**record, 'id': 'pgn-1'}
            self.assertEqual(importer.append([record, other, other], games), (1, 2))
            self.assertEqual(importer.existing_ids(games), {'123456', 'pgn-1'})


class ImportJobTests(unittest.TestCase):
    def test_fetch_preview_commit(self):
        record = importer.to_record(PGN, {'jhd3197'}, id='123456', type='live')
        def fake(username, since, progress, should_stop):
            progress(1, 2, '2026-08')
            return [record, {**record, 'id': '9', 'date': '2026.09.01'}], [{'error': 'bad'}]
        job = importer.ImportJob({'chesscom': fake})
        remembered = []
        with tempfile.TemporaryDirectory() as folder:
            games = Path(folder) / 'games.jsonl'
            games.write_text(json.dumps({'id': '9'}) + '\n', encoding='utf-8')
            with self.assertRaises(importer.ImportProblem):
                job.fetch('chesscom', 'bad name!', None, games)
            job.fetch('chesscom', 'jhd3197', '2026-08-01', games, on_success=lambda *a: remembered.append(a))
            job.thread.join(5)
            status = job.status()
            self.assertEqual(status['phase'], 'ready')
            self.assertEqual([(g['id'], g['exists']) for g in status['games']], [('9', True), ('123456', False)])
            self.assertEqual(remembered, [('chesscom', 'jhd3197')])
            done = job.commit(['123456', '9'], games)
            self.assertEqual((done['phase'], done['added'], done['duplicates']), ('done', 1, 1))
            with self.assertRaises(importer.ImportProblem):
                job.commit(['123456'], games)

    def test_errors_reach_the_page(self):
        def fake(*args, **kwargs):
            raise importer.ImportProblem('There is no chess.com player with that username.')
        job = importer.ImportJob({'chesscom': fake})
        job.fetch('chesscom', 'xx', None, Path('missing.jsonl'))
        job.thread.join(5)
        self.assertEqual(job.status()['error'], 'There is no chess.com player with that username.')
        job.cancel()
        self.assertEqual(job.status()['phase'], 'idle')


if __name__ == '__main__':
    unittest.main()
