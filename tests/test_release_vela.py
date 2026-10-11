"""The Vela release ships the torre package and nothing from tests/."""
import tempfile
import unittest
from pathlib import Path

from torre.tools.release_vela import runtime_modules


class ReleaseTests(unittest.TestCase):
    def test_ships_the_whole_package_and_nothing_else(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ('torre/__init__.py', 'torre/server/studio.py', 'torre/coaching/coach.py', 'tests/test_x.py'):
                (root / name).parent.mkdir(parents=True, exist_ok=True)
                (root / name).write_text('', encoding='utf-8')
            self.assertEqual(set(runtime_modules(root)), {'torre/__init__.py', 'torre/server/studio.py', 'torre/coaching/coach.py'})

    def test_current_app_dependencies_are_packaged(self):
        files = runtime_modules()
        self.assertTrue({'torre/server/studio.py', 'torre/coaching/coach.py', 'torre/coaching/coach_plan.py',
                         'torre/analysis/game_stats.py', 'torre/learning/story.py', 'torre/translations.py',
                         'torre/analysis/opening_book.py', 'torre/analysis/engines.py', 'torre/paths.py'} <= files.keys())
        self.assertFalse(any(name.startswith('tests/') for name in files))
