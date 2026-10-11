"""Lichess import checks (no network): .venv/Scripts/python -m unittest test_lichess_import -v"""
import io
import json
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

import chess.pgn

from torre.games import importer
from scripts import lichess_import

PGN = '''[Event "Rated Blitz game"]
[Site "https://lichess.org/{id}"]
[Date "2026.09.20"]
[White "{white}"]
[Black "{black}"]
[Result "0-1"]
[WhiteElo "1500"]
[BlackElo "1520"]
[TimeControl "180+2"]
[ECO "C00"]
[Opening "Barnes Opening"]
[Termination "Normal"]

1. f3 {{ [%eval -0.5] [%clk 0:03:00] }} 1... e5 {{ [%eval -0.4] [%clk 0:03:00] }} 2. g4? {{ (-0.6 → #-1) Mistake. [%eval #-1] [%clk 0:02:58] }} (2. e4 Nc6) 2... Qh4# {{ [%clk 0:02:55] }} 0-1
'''


def game(gid, created, white='JuanLi', black='Rival', **extra):
    return {'id': gid, 'rated': True, 'variant': 'standard', 'speed': 'blitz', 'createdAt': created, 'lastMoveAt': created + 60000,
            'status': 'mate', 'winner': 'black', 'players': {
                'white': {'user': {'name': white, 'id': white.lower()}, 'rating': 1500, 'analysis': {'accuracy': 41}},
                'black': {'user': {'name': black, 'id': black.lower()}, 'rating': 1520, 'analysis': {'accuracy': 97}}},
            'clocks': [18000, 18000, 17800, 17500], 'pgn': PGN.format(id=gid, white=white, black=black), **extra}


class FakeLichess:
    """Stands in for the NDJSON stream: serves the games created at or after ?since=, newest first."""

    def __init__(self, games):
        self.games, self.urls = games, []

    def __call__(self, url):
        self.urls.append(url)
        query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        since = int(query.get('since', ['0'])[0])
        return iter([json.dumps(g) + '\n' for g in sorted(self.games, key=lambda g: -g['createdAt']) if g['createdAt'] >= since] + ['\n'])


class LichessImportTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.games_file, self.state_file = Path(folder.name) / 'games.jsonl', Path(folder.name) / 'lichess_sync.json'

    def sync(self, lichess, **kwargs):
        return lichess_import.sync('JuanLi', self.games_file, self.state_file, stream=lichess, **kwargs)

    def library(self):
        return [json.loads(line) for line in self.games_file.read_text(encoding='utf-8').splitlines()]

    def test_url_asks_for_pgn_clocks_evals_and_openings(self):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(importer.lichess_url(' JuanLi ', 1790000000001)).query)
        self.assertTrue(importer.lichess_url('JuanLi').startswith('https://lichess.org/api/games/user/juanli?'))
        for key in ('pgnInJson', 'clocks', 'evals', 'opening'):
            self.assertEqual(query[key], ['true'])
        self.assertEqual(query['since'], ['1790000000001'])

    def test_record_matches_the_library_shape_and_keeps_only_clocks(self):
        record = importer.lichess_record(game('abcdEFGH', 1790000000000), 'juanli')
        plain = importer.to_record(PGN.format(id='x', white='JuanLi', black='Rival'), {'juanli'}, id='1', type='live')
        self.assertEqual(set(record), set(plain))
        self.assertEqual((record['id'], record['type'], record['url']), ('li-abcdEFGH', 'live', 'https://lichess.org/abcdEFGH'))
        self.assertEqual((record['user_color'], record['opponent'], record['user_result'], record['plies']), ('white', 'Rival', 0, 4))
        self.assertEqual((record['user_rating'], record['opp_rating'], record['time_control']), (1500, 1520, '180+2'))
        self.assertEqual((record['user_accuracy'], record['end_time_unix']), (41, 1790000060))
        self.assertNotIn('%eval', record['pgn'])
        self.assertNotIn('Mistake', record['pgn'])
        self.assertNotIn('Nc6', record['pgn'])  # the suggested variation is dropped
        clocks = [n.clock() for n in chess.pgn.read_game(io.StringIO(record['pgn'])).mainline()]
        self.assertEqual(clocks, [180, 180, 178, 175])
        self.assertNotIn('%clk', plain['pgn'])  # the chess.com path is unchanged

    def test_ai_correspondence_and_variants(self):
        ai = game('aiaiaiai', 3, black='lichess AI level 3')
        ai['players']['black'] = {'aiLevel': 3}
        lichess = FakeLichess([ai, game('corrcorr', 2, speed='correspondence'), game('atomicaa', 1, variant='atomic'),
                               game('notmeeee', 0, white='Someone')])
        records, failed, newest, complete = importer.fetch_lichess('juanli', stream=lichess)
        self.assertEqual([(r['id'], r['type']) for r in records], [('li-aiaiaiai', 'computer'), ('li-corrcorr', 'daily')])
        self.assertEqual(records[0]['user_accuracy'], 41)
        self.assertEqual(len(failed), 1)
        self.assertEqual((failed[0]['where'], failed[0]['error']), ('https://lichess.org/notmeeee', 'Neither player is you.'))
        self.assertEqual((newest, complete), (3, True))

    def test_incremental_sync_only_asks_for_newer_games(self):
        lichess = FakeLichess([game('gameAAAA', 1000), game('gameBBBB', 2000)])
        first = self.sync(lichess)
        self.assertEqual((first['since_ms'], first['added'], first['newest_ms']), (None, 2, 2000))
        self.assertEqual([r['id'] for r in self.library()], ['li-gameBBBB', 'li-gameAAAA'])
        self.assertEqual(lichess_import.last_synced('juanli', self.state_file)['newest_ms'], 2000)

        lichess.games.append(game('gameCCCC', 3000))
        second = self.sync(lichess)
        self.assertIn('since=2001', lichess.urls[-1])
        self.assertEqual((second['fetched'], second['added'], second['duplicates']), (1, 1, 0))

        empty = self.sync(lichess)
        self.assertEqual((empty['since_ms'], empty['fetched'], empty['added']), (3001, 0, 0))
        self.assertEqual(lichess_import.last_synced('JuanLi', self.state_file)['newest_ms'], 3000)

        full = self.sync(lichess, full=True)
        self.assertNotIn('since=', lichess.urls[-1])
        self.assertEqual((full['fetched'], full['added'], full['duplicates']), (3, 0, 3))
        self.assertEqual(len(self.library()), 3)

    def test_dedupes_by_url_and_keeps_cursor_on_cancel(self):
        self.games_file.write_text(json.dumps({'id': 'other', 'url': 'https://lichess.org/gameAAAA'}) + '\n', encoding='utf-8')
        lichess = FakeLichess([game('gameAAAA', 1000), game('gameBBBB', 2000)])
        stopped = self.sync(lichess, should_stop=lambda: True)
        self.assertEqual((stopped['complete'], stopped['added']), (False, 0))
        self.assertIsNone(lichess_import.last_synced('juanli', self.state_file))
        done = self.sync(lichess, since='1970-01-01')
        self.assertEqual((done['since_ms'], done['added'], done['duplicates']), (0, 1, 1))
        self.assertEqual([r['id'] for r in self.library()], ['other', 'li-gameBBBB'])

    def test_unknown_player(self):
        def missing(url):
            raise LookupError(url)
        with self.assertRaisesRegex(importer.ImportProblem, 'no Lichess player'):
            lichess_import.sync('nobody', self.games_file, self.state_file, stream=missing)

    def test_preview_fetcher_fits_the_import_job(self):
        lichess = FakeLichess([game('gameAAAA', importer.day_ms('2026-09-01')), game('gameBBBB', 1000)])
        job = importer.ImportJob({'lichess': lambda u, s, **kw: importer.lichess_games(u, s, stream=lichess, **kw)})
        job.fetch('lichess', 'JuanLi', '2026-09-01', self.games_file)
        job.thread.join(5)
        self.assertEqual([g['id'] for g in job.status()['games']], ['li-gameAAAA'])
        self.assertEqual(job.commit(['li-gameAAAA'], self.games_file)['added'], 1)
        self.assertIn('%clk', self.library()[0]['pgn'])
        self.assertFalse(self.state_file.exists())  # previews do not move the cursor

    def test_cli(self):
        lichess = FakeLichess([game('gameAAAA', 1000)])
        with mock.patch.object(importer, 'ndjson_lines', lichess), mock.patch('builtins.print') as out:
            lichess_import.main(['JuanLi', '--games-file', str(self.games_file), '--state-file', str(self.state_file)])
        self.assertIn('added=1', out.call_args[0][0])
        self.assertEqual(self.library()[0]['id'], 'li-gameAAAA')


if __name__ == '__main__':
    unittest.main()
