"""The studio's server plumbing: route dispatch and errors, background jobs, cached reads,
atomic analysis compaction, and the engine pool's option handling and thread budget."""
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from torre.analysis import analyze
from torre.server import api_games
from torre.server import appdata
from torre.analysis import engines
from torre.server import jobs
from torre import jsonio
from torre.learning import lessons
from torre.learning import packs
from torre.server import routes
from torre.server import studio
class RouteTableTests(unittest.TestCase):
    def setUp(self):
        self.table = routes.Routes()
        self.table.get('/api/items')(lambda req: 'list')
        self.table.get('/api/items/(?P<id>[^/]+)/pgn')(lambda req: 'pgn')
        self.table.get('/api/items/(?P<id>[^/]+)')(lambda req: 'one')
        self.table.post('/api/items/new')(lambda req: 'new')

    def answer(self, method, path):
        found = self.table.match(method, path)
        return (found[0](None), found[1]) if found else None

    def test_exact_paths_win_and_patterns_go_in_order(self):
        self.assertEqual(self.answer('GET', '/api/items'), ('list', {}))
        self.assertEqual(self.answer('GET', '/api/items/7/pgn'), ('pgn', {'id': '7'}))
        self.assertEqual(self.answer('GET', '/api/items/7'), ('one', {'id': '7'}))
        self.assertEqual(self.answer('POST', '/api/items/new'), ('new', {}))

    def test_the_method_must_match_and_unknown_paths_are_none(self):
        self.assertIsNone(self.answer('POST', '/api/items'))
        self.assertIsNone(self.answer('GET', '/api/items/new/extra/pgn/x'))
        self.assertIsNone(self.answer('GET', '/api/other'))

    def test_a_path_cannot_be_routed_twice(self):
        with self.assertRaises(ValueError):
            self.table.get('/api/items')(lambda req: 'again')

    def test_need_checks_types(self):
        self.assertEqual(routes.need({'move': 'e2e4'}, 'move'), 'e2e4')
        for payload in ({}, {'move': 5}, {'move': None}):
            with self.assertRaises(routes.BadRequest):
                routes.need(payload, 'move')
        with self.assertRaises(routes.BadRequest):
            routes.need({'n': True}, 'n', int)


class DispatchTests(unittest.TestCase):
    """Through a real server: statuses and bodies for client mistakes and server bugs."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved_dir = appdata.DATA_DIR
        studio.use_data_dir(cls.tmp.name)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), studio.Handler)
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        studio.use_data_dir(cls.saved_dir)
        cls.tmp.cleanup()

    def call(self, path, payload=None, raw=None, lang=None):
        headers = {'Content-Type': 'application/json', 'X-Chess-Studio': '1'}
        if lang:
            headers['X-Lang'] = lang
        data = raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
        request = urllib.request.Request(self.base + path, data, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def test_unknown_routes_are_404(self):
        self.assertEqual(self.call('/api/nope'), (404, {'error': 'Not found'}))
        self.assertEqual(self.call('/api/nope', {}), (404, {'error': 'Not found'}))

    def test_a_failing_get_is_a_logged_500_not_a_dropped_connection(self):
        with mock.patch.object(appdata, 'records', side_effect=RuntimeError('disk on fire')), \
                self.assertLogs('studio', 'ERROR') as logged:
            status, body = self.call('/api/games')
        self.assertEqual(status, 500)
        self.assertEqual(body, {'error': studio.SERVER_ERROR})
        self.assertNotIn('disk on fire', body['error'])  # details go to the log, not the page
        self.assertIn('disk on fire', '\n'.join(logged.output))

    def test_a_bug_in_a_post_is_500_not_a_bad_request(self):
        with mock.patch.object(appdata, 'setup_state', side_effect=KeyError('accounts')), \
                self.assertLogs('studio', 'ERROR'):
            status, body = self.call('/api/setup', {'onboarded': True})
        self.assertEqual((status, body), (500, {'error': studio.SERVER_ERROR}))

    def test_bad_requests_are_400_with_a_readable_message(self):
        self.assertEqual(self.call('/api/move', {'moves': []}), (400, {'error': '"move" must be a string.'}))
        self.assertEqual(self.call('/api/position', {'moves': 'e2e4'}), (400, {'error': '"moves" must be a list of moves.'}))
        self.assertEqual(self.call('/api/review', {'moves': [], 'from': 'soon'}), (400, {'error': '"from" must be a number.'}))
        self.assertEqual(self.call('/api/position', raw=b'{not json'), (400, {'error': 'The request body is not valid JSON.'}))
        self.assertEqual(self.call('/api/position', raw=b'[1, 2]'), (400, {'error': 'The request body must be a JSON object.'}))
        # Domain validation (ValueError) keeps its own message, translated for the reader.
        self.assertEqual(self.call('/api/position', {'moves': ['e2e5']}, lang='es')[0], 400)
        self.assertEqual(self.call('/api/position', {'moves': ['e2e5']})[1], {'error': 'The move history contains an illegal move.'})

    def test_server_errors_are_translated(self):
        with mock.patch.object(appdata, 'records', side_effect=RuntimeError), self.assertLogs('studio', 'ERROR'):
            status, body = self.call('/api/games', lang='es')
        self.assertEqual(status, 500)
        self.assertNotEqual(body['error'], studio.SERVER_ERROR)

    def test_the_csrf_guard_still_comes_first(self):
        request = urllib.request.Request(self.base + '/api/position', b'{}', headers={'Content-Type': 'application/json'})
        with self.assertRaises(urllib.error.HTTPError) as refused:
            urllib.request.urlopen(request, timeout=30)
        self.assertEqual(refused.exception.code, 403)

    def test_starting_a_busy_job_is_a_409_with_its_message(self):
        busy = jobs.JobBusy(packs.JOB.busy_message)
        with mock.patch.object(packs.JOB, 'start', side_effect=busy), mock.patch.object(packs, 'available', return_value=[]):
            self.assertEqual(self.call('/api/packs/install', {'id': 'voice-es'}), (409, {'error': 'A voice pack is already downloading.'}))

    def test_starting_the_running_analysis_just_reports_it(self):
        busy = jobs.JobBusy(api_games.ANALYSIS_JOB.busy_message)
        with mock.patch.object(api_games.ANALYSIS_JOB, 'start', side_effect=busy):
            status, body = self.call('/api/analysis/start', {})
        self.assertEqual(status, 200)
        self.assertIn('done', body)


class Counting(jobs.BackgroundJob):
    """A job for the tests: counts to `n`, or raises `error` at `fail_at`."""
    busy_message = 'Already counting.'
    label = 'Counting'

    def __init__(self):
        super().__init__({'running': False, 'count': 0, 'error': None, 'nested': {'seen': []}})
        self.gate = threading.Event()
        self.ended = []

    def start(self, n, fail_at=None, error=None):
        self.launch({'running': True, 'count': 0, 'error': None, 'nested': {'seen': []}}, n, fail_at, error)

    def work(self, n, fail_at, error):
        self.gate.wait(5)
        for i in range(1, n + 1):
            if self.stopping:
                return
            if i == fail_at:
                raise error
            with self.lock:
                self.state['count'] = i
                self.state['nested']['seen'].append(i)

    def finished(self):
        self.ended.append(self.state['count'])


class BackgroundJobTests(unittest.TestCase):
    def test_a_second_start_while_running_is_busy(self):
        job = Counting()
        job.start(3)
        self.assertTrue(job.status()['running'])
        with self.assertRaises(jobs.JobBusy) as busy:
            job.start(3)
        self.assertEqual(busy.exception.message, 'Already counting.')
        job.gate.set()
        job.join(5)
        status = job.status()
        self.assertEqual((status['running'], status['count'], status['error']), (False, 3, None))
        job.start(2)  # free again once the thread is done
        job.join(5)
        self.assertEqual(job.ended, [3, 2])

    def test_status_is_a_copy(self):
        job = Counting()
        job.gate.set()
        job.start(2)
        job.join(5)
        job.status()['nested']['seen'].append('changed')
        self.assertEqual(job.status()['nested']['seen'], [1, 2])

    def test_a_failure_is_logged_and_reported_and_finished_still_runs(self):
        job = Counting()
        job.gate.set()
        with self.assertLogs('tests.test_server', 'ERROR') as logged:
            job.start(5, fail_at=3, error=RuntimeError('out of beans'))
            job.join(5)
        self.assertIn('Counting failed', logged.output[0])
        status = job.status()
        self.assertEqual((status['running'], status['count'], status['error']), (False, 2, 'out of beans'))
        self.assertEqual(job.ended, [2])
        with self.assertLogs('tests.test_server', 'ERROR'):
            job.execute(5, 1, KeyError())  # a message-less exception is named by its type
        self.assertEqual(job.status()['error'], 'KeyError')

    def test_stop_ends_the_work_at_its_next_check(self):
        job = Counting()
        job.start(1000)
        job.stop()
        job.gate.set()
        job.join(5)
        self.assertEqual((job.status()['count'], job.status()['error'], job.ended), (0, None, [0]))
        job.gate.clear()
        job.start(2)  # a new run starts unstopped
        self.assertFalse(job.stopping)
        job.gate.set()
        job.join(5)
        self.assertEqual(job.status()['count'], 2)


class CachedReadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'games.jsonl'

    def write(self, rows, stamp=None):
        self.path.write_text(''.join(json.dumps(r) + '\n' for r in rows), encoding='utf-8')
        if stamp is not None:
            os.utime(self.path, ns=(stamp, stamp))

    def test_parsed_once_until_the_file_changes(self):
        self.write([{'id': 1}], stamp=1_000_000_000_000_000_000)
        first = jsonio.read_jsonl(self.path)
        with mock.patch.object(jsonio.json, 'loads', side_effect=AssertionError('parsed again')):
            self.assertIs(jsonio.read_jsonl(self.path), first)
        with open(self.path, 'a', encoding='utf-8') as handle:  # an append changes the size
            handle.write(json.dumps({'id': 2}) + '\n')
        self.assertEqual([r['id'] for r in jsonio.read_jsonl(self.path)], [1, 2])

    def test_a_same_size_rewrite_is_seen_through_its_mtime(self):
        self.write([{'id': 1}], stamp=1_000_000_000_000_000_000)
        self.assertEqual(jsonio.read_jsonl(self.path), [{'id': 1}])
        self.write([{'id': 2}], stamp=1_000_000_000_000_001_000)
        self.assertEqual(jsonio.read_jsonl(self.path), [{'id': 2}])

    def test_missing_files_and_torn_lines(self):
        self.assertEqual(jsonio.read_jsonl(self.path), [])
        self.path.write_text('{"id": 1}\n{"id": 2, "pg\n', encoding='utf-8')
        self.assertEqual(jsonio.read_jsonl(self.path), [{'id': 1}])

    def test_archive_lookups_follow_the_file(self):
        saved = appdata.DATA_DIR
        self.addCleanup(appdata.use_data_dir, saved)
        appdata.use_data_dir(self.tmp.name)
        self.write([{'id': '1', 'pgn': '*'}])
        self.assertEqual(appdata.game_record('1'), {'id': '1', 'pgn': '*'})
        self.assertIsNone(appdata.game_record('2'))
        with open(self.path, 'a', encoding='utf-8') as handle:
            handle.write(json.dumps({'id': '2', 'pgn': '1. e4 *'}) + '\n')
        self.assertEqual(appdata.game_record('2')['pgn'], '1. e4 *')

    def test_lessons_reload_when_a_lesson_file_changes(self):
        folder = Path(self.tmp.name) / 'lessons'
        folder.mkdir()
        source = next(p for p in sorted(lessons.LESSONS_DIR.glob('*.json')) if p.name != lessons.UNITS_FILE)
        target = folder / source.name
        shutil.copy(source, target)
        first, _ = lessons.load_all(folder)
        self.assertIs(lessons.load_all(folder)[0], first)
        raw = json.loads(target.read_text(encoding='utf-8'))
        raw['title'] = 'A new title'
        target.write_text(json.dumps(raw), encoding='utf-8')
        self.assertEqual(lessons.load_all(folder)[0][source.stem]['title'], 'A new title')


def analysis_row(game_id, version=analyze.SCORING_VERSION, note=''):
    return {'id': game_id, 'scoring_version': version, 'note': note}


class CompactionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.analysis = self.folder / 'analysis.jsonl'
        self.games = self.folder / 'games.jsonl'
        self.games.write_text(''.join(json.dumps({'id': str(i), 'date': f'2026-01-0{i}'}) + '\n' for i in (1, 2, 3)), encoding='utf-8')
        rows = [analysis_row('1', 2, 'old'), analysis_row('1', note='new'), analysis_row('2', 2, 'only old'), analysis_row('1', 2, 'older again')]
        self.text = ''.join(json.dumps(r) + '\n' for r in rows) + '{"id": "3", "cut sho'
        self.analysis.write_text(self.text, encoding='utf-8')

    def test_pending_never_rewrites_the_file(self):
        games, done, outdated = analyze.pending(self.games, self.analysis)
        self.assertEqual(self.analysis.read_text(encoding='utf-8'), self.text)
        self.assertEqual(([g['id'] for g in games], done, outdated), (['2', '3'], 1, 1))

    def test_compact_keeps_one_record_per_game(self):
        records = analyze.compact(self.analysis)
        self.assertEqual({k: v['note'] for k, v in records.items()}, {'1': 'new', '2': 'only old'})
        rows = [json.loads(line) for line in self.analysis.read_text(encoding='utf-8').splitlines()]
        self.assertEqual([r['note'] for r in rows], ['new', 'only old'])
        self.assertEqual(list(self.folder.glob('*.tmp')), [])

    def test_a_failed_compaction_leaves_the_file_whole(self):
        with mock.patch.object(jsonio.os, 'replace', side_effect=PermissionError('locked')), \
                mock.patch.object(jsonio, 'REPLACE_TRIES', 1), self.assertLogs('torre.analysis.analyze', 'WARNING'):
            analyze.compact(self.analysis)
        self.assertEqual(self.analysis.read_text(encoding='utf-8'), self.text)
        self.assertEqual(list(self.folder.glob('*.tmp')), [])

    def test_compaction_waits_for_an_append_in_progress(self):
        order = []
        with analyze.ANALYSIS_LOCK:
            worker = threading.Thread(target=lambda: order.append(len(analyze.compact(self.analysis))))
            worker.start()
            worker.join(.2)
            self.assertTrue(worker.is_alive())  # blocked while the "append" holds the lock
            with self.analysis.open('a', encoding='utf-8') as out:
                out.write('\n' + json.dumps(analysis_row('9')) + '\n')
            order.append('appended')
        worker.join(10)
        self.assertEqual(order, ['appended', 3])
        self.assertIn('"id": "9"', self.analysis.read_text(encoding='utf-8'))


class Option:
    def __init__(self, default):
        self.default = default


class FakeEngine:
    def __init__(self):
        self.options = {'Threads': Option(1), 'Hash': Option(16), 'Skill Level': Option(20),
                        'UCI_LimitStrength': Option(False), 'UCI_Elo': Option(1320)}
        self.sent = []

    def ping(self):
        pass

    def configure(self, options):
        self.sent.append(dict(options))

    def quit(self):
        self.sent.append('quit')


class EnginePoolTests(unittest.TestCase):
    def setUp(self):
        self.pool = engines.EnginePool(engines.ThreadBudget(8))
        self.engine = FakeEngine()
        self.pool._engines['stockfish#play'] = self.engine
        profiles = mock.patch.object(engines, 'get_profile', return_value={})
        profiles.start()
        self.addCleanup(profiles.stop)

    def use(self, **options):
        with self.pool.acquire('stockfish', slot='play', options=options) as engine:
            self.assertIs(engine, self.engine)

    def test_only_changed_options_are_sent(self):
        self.use(Threads=2, Hash=64)
        self.assertEqual(self.engine.sent[-1]['Threads'], 2)
        sent = len(self.engine.sent)
        self.use(Threads=2, Hash=64)
        self.assertEqual(len(self.engine.sent), sent)  # nothing to change
        self.use(Threads=3, Hash=64)
        self.assertEqual(self.engine.sent[-1], {'Threads': 3})

    def test_a_bots_strength_does_not_stick(self):
        self.use(Threads=2, UCI_LimitStrength=True, UCI_Elo=1500)
        self.use(Threads=2, **{'Skill Level': 3})
        self.assertEqual(self.engine.sent[-1], {'Skill Level': 3, 'UCI_LimitStrength': False, 'UCI_Elo': 1320})
        self.use(Threads=2)
        self.assertEqual(self.engine.sent[-1], {'Skill Level': 20})

    def test_threads_come_out_of_one_budget(self):
        with self.pool.budget.reserve(6) as background:
            self.assertEqual(background, 6)
            self.use(Threads=4)
            self.assertEqual(self.engine.sent[-1]['Threads'], 2)  # what is left
            with self.pool.budget.reserve(4) as review, self.pool.budget.reserve(4) as squeezed:
                self.assertEqual((review, squeezed), (2, 1))  # never less than one
        self.assertEqual(self.pool.budget.used, 0)
        self.use(Threads=4)
        self.assertEqual(self.engine.sent[-1]['Threads'], 4)

    def test_keys_have_their_own_locks_and_close_takes_every_slot(self):
        analysis = FakeEngine()
        self.pool._engines['stockfish'] = analysis
        with self.pool.acquire('stockfish', slot='play', options={'Threads': 1}):
            with self.pool.acquire('stockfish', options={'Threads': 1}) as other:  # not blocked by the play slot
                self.assertIs(other, analysis)
        self.pool.close('stockfish')
        self.assertEqual((analysis.sent[-1], self.engine.sent[-1]), ('quit', 'quit'))
        self.assertEqual(self.pool._engines, {})


class AboutTests(unittest.TestCase):
    def test_release_notes_give_the_newest_title_date_and_first_paragraph(self):
        text = '# Faster review — 2026-10-07\n\nReviews open at once.\nNothing waits.\n\nMore detail.\n\n# Older — 2026-09-01\n'
        self.assertEqual(api_games.release_notes(text),
                         {'title': 'Faster review', 'date': '2026-10-07', 'summary': 'Reviews open at once. Nothing waits.'})
        self.assertEqual(api_games.release_notes('')['title'], '')

    def test_about_names_the_version_and_the_data_folder(self):
        about = api_games.about(None)
        self.assertEqual(about['name'], 'Torre')
        self.assertRegex(about['version'], r'^\d+\.\d+\.\d+$')
        self.assertEqual(about['dataDir'], str(appdata.DATA_DIR))
        self.assertTrue(about['release']['title'])


if __name__ == '__main__':
    unittest.main()
