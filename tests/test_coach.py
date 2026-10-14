"""AI coach checks (no model is ever called): .venv/Scripts/python -m unittest test_coach -v"""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from torre.ai import catalogue, config, runtime
from torre.coaching import coach
from torre.analysis import game_stats
from torre.learning import puzzles
ADVICE = {
    'headline': 'Your openings leak points.',
    'strengths': ['You convert endgames.', '  '],
    'focus': [
        {'title': 'Opening blunders', 'why': 'Errors peak at moves 6-10.', 'drill': {'kind': 'puzzles', 'target': 'Fork'}},
        {'title': 'Back rank', 'why': 'x', 'drill': {'kind': 'lessons', 'target': 'back-rank-mate'}},
        {'title': 'Tilt', 'why': 'y', 'drill': {'kind': 'meditate', 'target': 'zen'}},
        {'title': 'A fourth one', 'why': 'z', 'drill': {'kind': 'play', 'target': 'rapid'}},
    ],
    'weekly_plan': ['Mon: 20 fork puzzles'],
}


def stats():
    return game_stats.build_stats([
        {'id': 1, 'user_color': 'white', 'user_result': 1, 'user_rating': 1500, 'opp_rating': 1800, 'time_control': '600'},
        {'id': 2, 'user_color': 'black', 'user_result': 0},
    ], {})


def no_ollama(test):
    """No model server on this computer, and no model from the environment, for a test."""
    for patch in (mock.patch.object(catalogue, 'local_servers', return_value=[]),
                  mock.patch.dict(os.environ, {config.ENV_MODEL: '', config.LEGACY_ENV_MODEL: ''})):
        patch.start()
        test.addCleanup(patch.stop)


class FakeJob:
    def __init__(self):
        self.started = []
        self.state = {'running': False, 'error': None, 'key': None}

    def status(self):
        return dict(self.state)

    def start(self, *args, force=False):
        self.started.append((args, force))


class CoachTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        no_ollama(self)
        self.addCleanup(self.tmp.cleanup)

    def settings(self, **values):
        (self.data / 'settings.json').write_text(json.dumps(values), encoding='utf-8')

    def test_brief_without_games(self):
        data = coach.brief(self.data, stats=game_stats.build_stats([], {}))
        self.assertIsNone(data['games'])
        self.assertEqual(data['puzzles']['rating'], puzzles.START_RATING)
        self.assertGreater(data['lessons']['total'], 0)
        self.assertEqual(data['drills'], {'cards_learned': 0, 'lesson_cards': 0})

    def test_brief_with_games_and_puzzles(self):
        pack = puzzles.load_packs()['themes']['mate-in-1'][:6]
        state = {'rating': 1600, 'rated': 6, 'history': [
            {'id': p['id'], 'rated': True, 'rating': 1500 + 20 * i} for i, p in enumerate(pack)],
            'puzzles': {p['id']: {'attempts': 1, 'first': 'solved' if i % 2 else 'missed', 'last': 'solved'} for i, p in enumerate(pack)}}
        (self.data / 'puzzles.json').write_text(json.dumps(state), encoding='utf-8')
        (self.data / 'lessons.json').write_text(json.dumps({'lessons': {'castling': {'step': 9, 'completed': '2026-01-01'}}}), encoding='utf-8')
        data = coach.brief(self.data, stats=stats())
        self.assertEqual(data['games']['games'], 2)
        self.assertIn('Score 100.0% as White (1 games) vs 0.0% as Black (1 games).', data['games']['weaknesses'])
        self.assertEqual(data['games']['by_rating'], {'much_higher': {'games': 1, 'score_pct': 100.0}})
        self.assertIsNone(data['games']['time'])
        self.assertEqual(data['puzzles']['weakest_themes'], [{'theme': 'mate-in-1', 'tried': 6, 'first_try_pct': 50}])
        self.assertEqual(data['puzzles']['rating_change_recent'], 100)
        self.assertNotIn('mate-in-1', data['puzzles']['untried_themes'])
        self.assertEqual(data['lessons']['completed'], 1)
        self.assertNotIn('castling', data['lessons']['not_done_by_category']['basics'])
        json.dumps(data)  # JSON-ready

    def test_unavailable_without_prompture_or_model(self):
        with mock.patch.object(runtime, 'prompture_installed', return_value=False):
            self.settings(coach_model='ollama/qwen3:8b')
            self.assertEqual(config.availability(self.data, 'coach'), {'available': False, 'model': 'ollama/qwen3:8b', 'source': 'default',
                                                                       'reason': 'prompture_missing', 'setup_seen': False, 'hosted': False})
            with self.assertRaises(RuntimeError):
                coach.generate(self.data, data={})
        with mock.patch.object(runtime, 'prompture_installed', return_value=True):
            self.settings()
            out = coach.view(self.data, stats=stats(), job=FakeJob())
            self.assertFalse(out['available'])
            self.assertEqual(out['reason'], 'no_model')
            self.assertIn('Settings', out['error'])
            self.assertIsNone(out['advice'])
            self.assertIsNotNone(out['brief']['games'])

    def test_clean_advice_checks_drills(self):
        out = coach.clean_advice(ADVICE)
        self.assertEqual(out['strengths'], ['You convert endgames.'])
        self.assertEqual(len(out['focus']), coach.FOCUS_AREAS)
        self.assertEqual(out['focus'][0]['drill'], {'kind': 'puzzles', 'target': 'fork'})
        self.assertEqual(out['focus'][1]['drill'], {'kind': 'lessons', 'target': 'back-rank-mate'})
        self.assertEqual(out['focus'][2]['drill'], {'kind': 'play', 'target': ''})
        bad = coach.clean_advice({'headline': 'h', 'focus': [{'title': 't', 'drill': {'kind': 'puzzles', 'target': 'nope'}}, 'junk']})
        self.assertEqual(bad['focus'], [{'title': 't', 'why': '', 'drill': {'kind': 'puzzles', 'target': ''}}])

    def test_prompt_follows_the_language(self):
        self.assertIn('Write every text in Spanish', coach.prompt({'games': None}, 'es'))
        self.assertIn('Write every text in English', coach.prompt({'games': None}, 'en'))

    def test_generate_caches_by_brief(self):
        self.settings(coach_model='ollama/qwen3:8b')
        with mock.patch.object(runtime, 'prompture_installed', return_value=True), \
                mock.patch.object(coach, '_extract', return_value=ADVICE) as ask:
            first = coach.generate(self.data, 'en', data={'a': 1})
            self.assertEqual(first['advice']['headline'], 'Your openings leak points.')
            self.assertEqual(first['model'], 'ollama/qwen3:8b')
            coach.generate(self.data, 'en', data={'a': 1})
            self.assertEqual(ask.call_count, 1)
            coach.generate(self.data, 'en', data={'a': 2})
            coach.generate(self.data, 'es', data={'a': 2})
            coach.generate(self.data, 'es', data={'a': 2}, force=True)
            self.assertEqual(ask.call_count, 4)
            self.assertIn('Spanish', ask.call_args[0][1])
        self.assertEqual(json.loads((self.data / coach.CACHE_FILE).read_text(encoding='utf-8'))['lang'], 'es')

    def test_view_asks_in_the_background_when_stale(self):
        self.settings(coach_model='ollama/qwen3:8b')
        job = FakeJob()
        with mock.patch.object(runtime, 'prompture_installed', return_value=True):
            out = coach.view(self.data, 'en', stats=stats(), job=job, auto=True)
            self.assertTrue(out['available'])
            self.assertFalse(out['fresh'])
            self.assertEqual(len(job.started), 1)
            # A failed try at this same brief is not retried on every visit.
            job.state = {'running': False, 'error': 'boom', 'key': coach.brief_key(out['brief'], 'en', 'ollama/qwen3:8b')}
            self.assertEqual(coach.view(self.data, 'en', stats=stats(), job=job)['job']['error'], 'boom')
            self.assertEqual(len(job.started), 1)
            with mock.patch.object(coach, '_extract', return_value=ADVICE):
                coach.generate(self.data, 'en', data=out['brief'])
            fresh = coach.view(self.data, 'en', stats=stats(), job=FakeJob())
            self.assertTrue(fresh['fresh'])
            self.assertEqual(fresh['advice']['focus'][0]['title'], 'Opening blunders')
            self.assertFalse(coach.view(self.data, 'es', stats=stats(), job=FakeJob(), auto=False)['fresh'])
            coach.regenerate(self.data, 'en', stats=stats(), job=job)
            self.assertEqual(len(job.started), 1)  # fresh advice never invokes the model again

    def test_job_reports_failures(self):
        self.settings(coach_model='openai/gpt-4o-mini')
        job = coach.CoachJob()
        with mock.patch.object(runtime, 'prompture_installed', return_value=True), \
                mock.patch.object(coach, '_extract', side_effect=ValueError('model said no')), \
                self.assertLogs('torre.coaching.coach', 'ERROR'):
            job.start(self.data, 'en', 'openai/gpt-4o-mini', {'a': 1})
            job.thread.join(5)
        self.assertEqual(job.status()['error'], 'model said no')
        self.assertFalse(job.status()['running'])
        with mock.patch.object(runtime, 'prompture_installed', return_value=True), \
                mock.patch.object(coach, '_extract', return_value=ADVICE):
            job.start(self.data, 'en', 'openai/gpt-4o-mini', {'a': 1})
            job.thread.join(5)
        self.assertIsNone(job.status()['error'])
        self.assertEqual(coach.load_cache(self.data)['advice']['headline'], 'Your openings leak points.')


class ServerTests(unittest.TestCase):
    """GET and POST /api/coach through the real request handler."""
    def setUp(self):
        import threading
        from http.server import ThreadingHTTPServer
        from torre.server import studio
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        studio.use_data_dir(self.data)
        no_ollama(self)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), studio.Handler)
        self.base = f'http://127.0.0.1:{self.server.server_address[1]}'
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(self, body=None, lang='en', path='/api/coach'):
        from urllib.error import HTTPError
        from urllib.request import Request, urlopen
        headers = {'X-Lang': lang}
        if body is not None:
            headers.update({'Content-Type': 'application/json', 'X-Chess-Studio': '1'})
        request = Request(self.base + path, None if body is None else json.dumps(body).encode(), headers)
        try:
            with urlopen(request) as response:
                return json.loads(response.read())
        except HTTPError as exc:
            return {'status': exc.code, **json.loads(exc.read())}

    def test_coach_endpoints(self):
        with mock.patch.object(runtime, 'prompture_installed', return_value=True):
            out = self.call()
            self.assertFalse(out['available'])
            self.assertEqual(out['reason'], 'no_model')
            self.assertIn('puzzles', out['brief'])
            (self.data / 'settings.json').write_text(json.dumps({'coach_model': 'ollama/qwen3:8b'}), encoding='utf-8')
            with mock.patch.object(coach, '_extract', return_value=ADVICE) as ask:
                started = self.call({}, lang='es')
                self.assertTrue(started['available'])
                coach.JOB.thread.join(5)
                out = self.call(lang='es')
                self.assertEqual(ask.call_count, 1)
            self.assertTrue(out['fresh'])
            self.assertEqual(out['advice']['headline'], 'Your openings leak points.')
            self.assertIn('Spanish', ask.call_args[0][1])


if __name__ == '__main__':
    unittest.main()
