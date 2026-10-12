"""Hosted resource limits: TORRE_ENGINE_THREADS, TORRE_ENGINE_HASH_MB, TORRE_BACKGROUND_ANALYSIS."""
import os
import unittest
from unittest import mock

from torre.analysis import engines
from torre.analysis import limits


def env(**values):
    return mock.patch.dict(os.environ, values)


class LimitsTests(unittest.TestCase):
    def setUp(self):
        cleared = mock.patch.dict(os.environ)
        cleared.start()
        self.addCleanup(cleared.stop)
        for name in ('TORRE_ENGINE_THREADS', 'TORRE_ENGINE_HASH_MB', 'TORRE_BACKGROUND_ANALYSIS'):
            os.environ.pop(name, None)

    def test_unset_means_no_cap(self):
        self.assertIsNone(limits.engine_threads())
        self.assertIsNone(limits.engine_hash_mb())
        self.assertTrue(limits.background_analysis())
        self.assertEqual(limits.total_threads(), os.cpu_count() or 2)
        self.assertEqual(limits.cap({'Threads': 64, 'Hash': 4096}), {'Threads': 64, 'Hash': 4096})

    def test_bad_values_are_ignored(self):
        for value in ('', 'many', '0', '-3'):
            with env(TORRE_ENGINE_THREADS=value, TORRE_ENGINE_HASH_MB=value):
                self.assertIsNone(limits.engine_threads())
                self.assertIsNone(limits.engine_hash_mb())

    def test_caps_threads_and_hash_only(self):
        with env(TORRE_ENGINE_THREADS='2', TORRE_ENGINE_HASH_MB='64'):
            self.assertEqual(limits.total_threads(), 2)
            self.assertEqual(limits.cap({'Threads': 8, 'Hash': 512, 'MultiPV': 3}),
                             {'Threads': 2, 'Hash': 64, 'MultiPV': 3})
            self.assertEqual(limits.cap({'Threads': 1, 'Hash': 16}), {'Threads': 1, 'Hash': 16})
            self.assertEqual(limits.cap({'MultiPV': 3}), {'MultiPV': 3})  # no Hash added

    def test_background_analysis_switch(self):
        for value, expected in (('0', False), ('off', False), ('false', False), ('1', True), ('', True)):
            with env(TORRE_BACKGROUND_ANALYSIS=value):
                self.assertIs(limits.background_analysis(), expected)

    def test_thread_budget_follows_the_cap(self):
        with env(TORRE_ENGINE_THREADS='3'):
            budget = engines.ThreadBudget()
            self.assertEqual(budget.total, 3)
            with budget.reserve(16) as granted:
                self.assertEqual(granted, 3)
        self.assertEqual(engines.ThreadBudget(5).total, 5)  # an explicit total still wins

    def test_engines_are_configured_within_the_caps(self):
        engine = mock.Mock(options={'Threads': None, 'Hash': None})
        with env(TORRE_ENGINE_THREADS='2', TORRE_ENGINE_HASH_MB='32'):
            engines._configure_supported(engine, {'Threads': 12, 'Hash': 256, 'Unknown': 1})
        engine.configure.assert_called_once_with({'Threads': 2, 'Hash': 32})


if __name__ == '__main__':
    unittest.main()
