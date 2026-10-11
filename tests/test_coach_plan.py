import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from torre.coaching import coach
from torre.coaching import coach_plan
from tests.test_coach import ADVICE, FakeJob, stats


class CoachPlanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.packs = {'themes': {'fork': [{'id': 'a'}], 'pin': [{'id': 'b'}]}}
        self.mock = patch.object(coach_plan.puzzles, 'load_packs', return_value=self.packs)
        self.mock.start()
        self.addCleanup(self.mock.stop)

    def write(self, name, value):
        (self.root / name).write_text(json.dumps(value), encoding='utf-8')

    def test_tasks_track_activity_and_keep_baselines_across_visits_and_languages(self):
        advice = {'focus': [{'title': 'Forks', 'drill': {'kind': 'puzzles', 'target': 'fork'}}]}
        self.write('puzzles.json', {'puzzles': {'a': {'solved': 9}, 'b': {'solved': 20}}})
        task = coach_plan.view(self.root, advice, {})[0]
        self.assertEqual(task['progress'], 0)
        self.write('puzzles.json', {'puzzles': {'a': {'solved': 12}, 'b': {'solved': 100}}})
        task = coach_plan.view(self.root, advice, {}, 'es')[0]
        self.assertEqual(task['progress'], 3)
        self.assertFalse(task['done'])
        self.write('puzzles.json', {'puzzles': {'a': {'solved': 15}}})
        self.assertTrue(coach_plan.view(self.root, advice, {})[0]['done'])
        self.assertFalse((self.root / 'profile.json').exists(), 'tasks must not award XP twice')

    def test_play_tracks_completed_local_games_not_imports_or_duplicate_records(self):
        advice = {'focus': [{'drill': {'kind': 'play', 'target': 'go to an invented website'}}]}
        coach_plan.view(self.root, advice, {})
        (self.root / 'games.jsonl').write_text('{"id": 1}\n', encoding='utf-8')
        self.assertEqual(coach_plan.view(self.root, advice, {})[0]['progress'], 0)
        (self.root / 'played.jsonl').write_text('{"id": 2}\n{"id": 2}\n', encoding='utf-8')
        task = coach_plan.view(self.root, advice, {})[0]
        self.assertEqual((task['progress'], task['target']), (1, ''))

    def test_invalid_targets_resolve_to_real_catalogs_and_duplicates_collapse(self):
        advice = {'focus': [{'drill': {'kind': 'puzzles', 'target': 'https://fake'}},
                            {'drill': {'kind': 'puzzles', 'target': 'missing'}}]}
        tasks = coach_plan.view(self.root, advice, {})
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]['target'], '')


class CoachCacheTests(unittest.TestCase):
    def test_language_switch_and_old_brief_reuse_saved_results(self):
        with tempfile.TemporaryDirectory() as folder, \
                patch.object(coach, 'prompture_installed', return_value=True), \
                patch.object(coach, '_extract', return_value=ADVICE) as ask:
            for lang, data in [('en', {'a': 1}), ('es', {'a': 1}), ('en', {'a': 2}), ('en', {'a': 1})]:
                coach.generate(folder, lang, model='test/model', data=data)
            self.assertEqual(ask.call_count, 3)
            self.assertEqual(len(coach.load_cache(folder)['entries']), 3)

    def test_get_never_starts_a_model_request_and_post_deduplicates_a_fresh_result(self):
        with tempfile.TemporaryDirectory() as folder, \
                patch.object(coach, 'availability', return_value={'available': True, 'model': 'test/model', 'reason': None}), \
                patch.object(coach, 'brief', return_value={'a': 1}), \
                patch.object(coach_plan, 'view', return_value=[]):
            job = FakeJob()
            coach.view(folder, stats=stats(), job=job)
            self.assertEqual(job.started, [])
            coach.save_cache(folder, {'key': coach.brief_key({'a': 1}, 'en', 'test/model'), 'lang': 'en',
                                     'model': 'test/model', 'advice': ADVICE, 'generated_at': '2026-10-07'})
            coach.regenerate(folder, job=job)
            self.assertEqual(job.started, [])
            with patch.object(coach, 'brief', return_value={'a': 2}):
                result = coach.view(folder, job=job)
                self.assertFalse(result['fresh'])
                self.assertEqual(result['advice'], ADVICE)
                self.assertEqual(job.started, [])
                coach.regenerate(folder, job=job)
            self.assertEqual(len(job.started), 1)


if __name__ == '__main__':
    unittest.main()
