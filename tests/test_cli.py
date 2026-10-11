"""CLI integration checks using isolated archives, never the player's data."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from torre import cli as torre
PGN = '''[Event "CLI test"]
[Site "?"]
[Date "2026.10.07"]
[White "Alice"]
[Black "Bob"]
[Result "0-1"]

1. f3 e5 2. g4 Qh4# 0-1
'''


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / 'archive with spaces'
        self.pgn = self.root / 'test game.pgn'
        self.pgn.write_text(PGN, encoding='utf-8-sig')

    def invoke(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = torre.main(['--data-dir', str(self.data), *map(str, argv)])
        return code, out.getvalue(), err.getvalue()

    def import_game(self):
        result = self.invoke('import', self.pgn, '--username', 'Alice')
        self.assertEqual(result[0], 0, result)

    def test_import_and_reimport_keep_one_record_with_correct_player(self):
        self.import_game()
        code, output, _ = self.invoke('import', self.pgn, '--username', 'ALICE')
        self.assertEqual(code, 0)
        self.assertIn('1 duplicates', output)
        rows = (self.data / 'games.jsonl').read_text().splitlines()
        self.assertEqual(len(rows), 1)
        record = json.loads(rows[0])
        self.assertEqual((record['user_color'], record['opponent']), ('white', 'Bob'))

    def test_dry_run_does_not_create_data(self):
        code, output, _ = self.invoke('import', self.pgn, '--username', 'Alice', '--dry-run')
        self.assertEqual(code, 0)
        self.assertIn('Would import 1', output)
        self.assertFalse(self.data.exists())

    def test_saved_accounts_and_aliases_select_black(self):
        self.data.mkdir()
        (self.data / 'settings.json').write_text(json.dumps({'accounts': {'lichess': 'Other'}, 'aliases': ['Bob']}))
        self.assertEqual(self.invoke('import', self.pgn)[0], 0)
        record = json.loads((self.data / 'games.jsonl').read_text())
        self.assertEqual(record['user_color'], 'black')

    def test_missing_identity_and_file_have_actionable_errors(self):
        self.assertIn('--username', self.invoke('import', self.pgn)[2])
        code, _, error = self.invoke('import', self.root / 'missing.pgn', '--username', 'Alice')
        self.assertEqual(code, 1)
        self.assertIn('missing.pgn', error)
        self.assertFalse(self.data.exists())

    def test_partial_import_saves_valid_game_and_returns_failure(self):
        self.pgn.write_text(PGN + '\n' + PGN.replace('Alice', 'Carol'), encoding='utf-8')
        code, output, error = self.invoke('import', self.pgn, '--username', 'Alice')
        self.assertEqual(code, 1)
        self.assertIn('Imported 1 games', output)
        self.assertIn('Neither player', error)
        self.assertEqual(len((self.data / 'games.jsonl').read_text().splitlines()), 1)

    def test_empty_archive_needs_no_engine_and_writes_nothing(self):
        with patch.dict(os.environ, {'STOCKFISH_PATH': str(self.root / 'missing')}):
            self.assertEqual(self.invoke('analyze')[0], 0)
            self.assertEqual(self.invoke('report')[0], 0)
        self.assertFalse(self.data.exists())

    def test_missing_engine_fails_before_writing_analysis(self):
        self.import_game()
        with patch.dict(os.environ, {'STOCKFISH_PATH': str(self.root / 'missing')}):
            code, _, error = self.invoke('analyze')
        self.assertEqual(code, 1)
        self.assertIn('STOCKFISH_PATH', error)
        self.assertFalse((self.data / 'analysis.jsonl').exists())

    def test_analysis_limit_and_partial_failure_exit_code(self):
        from torre.analysis import analyze
        self.import_game()
        games = [{'id': 1}, {'id': 2}]

        def run(records, engine_path, analysis_file, **kwargs):
            self.assertEqual(records, games[:1])
            self.assertEqual(analysis_file, self.data / 'analysis.jsonl')
            self.assertEqual((kwargs['depth'], kwargs['threads']), (3, 1))
            kwargs['progress'](1, records[0], None, ValueError('bad game'))

        with patch.object(analyze, 'pending', return_value=(games, 0, 0)), \
                patch.object(analyze, 'run', side_effect=run), \
                patch('torre.analysis.engines.resolve_engine', return_value=self.pgn):
            code, _, error = self.invoke('analyze', '--limit', '1', '--depth', '3', '--threads', '1', '--no-mine')
        self.assertEqual(code, 1)
        self.assertIn('bad game', error)

    def test_coach_brief_is_json_without_model_call(self):
        from torre.coaching import coach
        with patch.object(coach, 'generate', side_effect=AssertionError('must not ask a model')):
            code, output, _ = self.invoke('coach')
        self.assertEqual(code, 0)
        self.assertIsNone(json.loads(output)['games'])
        self.assertEqual(self.invoke('coach', '--model', 'test')[0], 1)

    def test_mining_can_resume_when_analysis_is_already_complete(self):
        self.import_game()
        (self.data / 'analysis.jsonl').write_text('')
        with patch('torre.analysis.analyze.pending', return_value=([], 1, 0)), patch('torre.analysis.analyze.run') as analyze_run, \
                patch('torre.learning.my_puzzles.run', return_value=({'puzzles': []}, 1)) as mine:
            code, _, error = self.invoke('analyze')
        self.assertEqual(code, 0, error)
        analyze_run.assert_not_called()
        self.assertEqual(mine.call_args.args, (self.data / 'games.jsonl', self.data / 'analysis.jsonl'))
        self.assertEqual(mine.call_args.kwargs['pack_file'], self.data / 'my-puzzles.json')

    def test_coach_ask_uses_shared_cache_options(self):
        with patch('torre.coaching.coach.generate', return_value={'advice': 'test'}) as generate:
            code, output, _ = self.invoke('coach', '--ask', '--lang', 'es', '--model', 'example/model', '--force')
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output)['advice'], 'test')
        generate.assert_called_once_with(self.data, 'es', 'example/model', force=True)

    def test_doctor_works_without_optional_or_required_dependencies(self):
        with patch('importlib.util.find_spec', return_value=None):
            code, output, _ = self.invoke('doctor', '--json')
        self.assertEqual(code, 1)
        result = json.loads(output)
        self.assertFalse(result['ok'])
        self.assertTrue(any(c['name'] == 'chess' and c['status'] == 'fail' for c in result['checks']))
        self.assertFalse(self.data.exists())

    def test_data_option_can_follow_command_and_overrides_environment(self):
        other = self.root / 'other'
        with patch.dict(os.environ, {'CHESS_STUDIO_DATA': str(other)}):
            code, output, _ = self.invoke('doctor', '--json', '--data-dir', str(self.data))
        self.assertEqual(code, 0)
        detail = next(c['detail'] for c in json.loads(output)['checks'] if c['name'] == 'Data folder')
        self.assertIn(str(self.data), detail)

    def test_module_entrypoint_from_another_directory_uses_environment(self):
        env = {**os.environ, 'CHESS_STUDIO_DATA': str(self.data), 'PYTHONPATH': str(torre.ROOT)}
        result = subprocess.run([sys.executable, '-m', 'torre', 'doctor', '--json'], cwd=self.root,
                                env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        detail = next(c['detail'] for c in json.loads(result.stdout)['checks'] if c['name'] == 'Data folder')
        self.assertIn(str(self.data), detail)

    def test_invalid_numeric_options_exit_two(self):
        for args in [('analyze', '--depth', '0'), ('analyze', '--limit', '-1'),
                     ('analyze', '--threads', '0'), ('serve', '--port', '65536')]:
            with self.subTest(args=args), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    torre.main(args)
                self.assertEqual(error.exception.code, 2)

    def test_serve_reuses_server_entrypoint(self):
        from torre.server import studio
        with patch.object(torre, 'ROOT', self.root), patch.object(studio, 'main') as start:
            self.assertEqual(self.invoke('serve')[0], 1)
            start.assert_not_called()
            ui = self.root / 'studio/ui'
            ui.mkdir(parents=True)
            (ui / 'index.html').write_text('test')
            self.assertEqual(self.invoke('serve', '--port', '1887', '--open-browser', '--proxied')[0], 0)
            start.assert_called_once_with(['--data-dir', str(self.data), '--port', '1887', '--open-browser', '--proxied'])

    def test_stockfish_import_analysis_report_pipeline(self):
        from torre.analysis import engines
        if not engines.resolve_engine('stockfish').is_file():
            self.skipTest('Stockfish not installed')
        self.import_game()
        code, _, error = self.invoke('analyze', '--depth', '2', '--threads', '1', '--no-mine')
        self.assertEqual(code, 0, error)
        rows = (self.data / 'analysis.jsonl').read_text().splitlines()
        self.assertEqual(len(rows), 1)
        code, output, _ = self.invoke('analyze', '--no-mine')
        self.assertEqual(code, 0)
        self.assertIn('0 to analyze', output)
        report = self.root / 'reports/mistakes.md'
        self.assertEqual(self.invoke('report', '--output', report)[0], 0)
        content = report.read_text(encoding='utf-8')
        self.assertIn('Analyzed **1** games', content)
        self.assertIn('Bob', content)
        self.assertNotIn('jhd3197', content)
        self.assertNotIn('[replay](pgn-', content)
        self.assertEqual(self.invoke('report')[0], 0)
        self.assertTrue((self.data / 'report.md').exists())


if __name__ == '__main__':
    unittest.main()
