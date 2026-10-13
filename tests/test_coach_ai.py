"""The coach's AI setup: providers, each player's saved keys, and the key reaching Prompture."""
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from torre.coaching import coach
from torre.coaching import coach_ai
class CoachAITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        coach_ai._models_cache.clear()
        coach_ai._featured_cache.clear()

    def tearDown(self):
        self.tmp.cleanup()

    def test_keys_are_saved_per_data_folder_and_shown_only_as_a_hint(self):
        coach_ai.save_key(self.data, 'openai', 'sk-abcdefgh1234')
        self.assertEqual(coach_ai.saved_keys(self.data), {'openai': 'sk-abcdefgh1234'})
        self.assertEqual(coach_ai.key_for(self.data, 'openai/gpt-4o-mini'), 'sk-abcdefgh1234')
        self.assertIsNone(coach_ai.key_for(self.data, 'claude/claude-3-5-haiku-latest'))
        shown = {p['id']: p for p in coach_ai.providers(self.data, [])}
        self.assertEqual((shown['openai']['has_key'], shown['openai']['key_hint']), (True, '…1234'))
        self.assertNotIn('sk-abcdefgh1234', str(shown))
        coach_ai.save_key(self.data, 'openai', '')
        self.assertEqual(coach_ai.saved_keys(self.data), {})

    def test_ollama_is_offered_on_your_computer_but_not_when_hosted(self):
        local = coach_ai.providers(self.data, ['ollama/qwen3:8b'])
        self.assertEqual(local[0]['models'], ['qwen3:8b'])
        with mock.patch.dict(os.environ, {coach_ai.HOSTED_ENV: '1'}):
            self.assertNotIn('ollama', [p['id'] for p in coach_ai.providers(self.data, [])])

    def test_listing_keeps_chat_models_and_rejects_a_bad_key(self):
        class Driver:
            @classmethod
            def list_models(cls, api_key=None, timeout=10):
                if api_key != 'good':
                    raise PermissionError('401 invalid key')
                return ['gpt-4o-mini', 'text-embedding-3-small', 'whisper-1', 'gpt-4o']
        with mock.patch.object(coach_ai, '_driver_class', return_value=Driver):
            self.assertEqual(coach_ai.list_models('openai', 'good'), ['gpt-4o', 'gpt-4o-mini'])
            with self.assertRaises(ValueError):
                coach_ai.list_models('openai', 'bad')

    def test_the_saved_key_goes_to_prompture_with_the_call(self):
        calls = []

        def extract_with_model(schema, text, model, options=None, max_retries=1, api_key=None):
            calls.append((model, api_key))
            return {'model': types.SimpleNamespace(model_dump=lambda: {'ok': True})}

        coach_ai.save_key(self.data, 'openai', 'sk-player-key-9999')
        fake = types.SimpleNamespace(extract_with_model=extract_with_model)
        with mock.patch.dict(sys.modules, {'prompture': fake}), mock.patch.object(coach, 'DATA_DIR', self.data):
            self.assertEqual(coach.ask_model(object, 'openai/gpt-4o-mini', 'hi'), {'ok': True})
            coach.ask_model(object, 'ollama/qwen3:8b', 'hi')
        self.assertEqual(calls, [('openai/gpt-4o-mini', 'sk-player-key-9999'), ('ollama/qwen3:8b', None)])

    def test_the_arena_offers_the_newest_current_chat_model_of_each_family(self):
        catalogue = {
            'opus-new': {'release_date': '2026-09-22', 'family': 'opus', 'name': 'Opus New', 'reasoning': True,
                         'reasoning_options': [{'type': 'toggle'}, {'type': 'effort', 'values': ['none', 'low', 'high', 'max']}],
                         'cost': {'input': 4, 'output': 20}},
            'opus-old': {'release_date': '2026-02-04', 'family': 'opus'},
            'opus-new-20260922': {'release_date': '2026-09-22', 'family': 'opus'},
            'haiku': {'release_date': '2026-10-07', 'family': 'haiku', 'reasoning': False},
            'sonnet-gone': {'release_date': '2026-10-08', 'family': 'sonnet', 'lifecycle': 'deprecated'},
            'painter': {'release_date': '2026-10-09', 'family': 'image', 'output': ['image']},
            'guard': {'release_date': '2026-10-09', 'family': 'guard', 'tool_call': False},
        }

        def info(provider, model_id):
            entry = catalogue[model_id]
            return {'modalities': {'output': entry.get('output', ['text'])}, 'tool_call': entry.get('tool_call', True), **entry}

        rates = types.SimpleNamespace(
            get_all_provider_models=lambda provider: list(catalogue), get_model_info=info,
            get_model_lifecycle=lambda provider, model_id: {'status': catalogue[model_id].get('lifecycle', 'current'), 'family': catalogue[model_id]['family']})
        with mock.patch.object(coach_ai.importlib, 'import_module', return_value=rates):
            picked = coach_ai.featured_models('claude')
        self.assertEqual([m['id'] for m in picked], ['claude/haiku', 'claude/opus-new'])
        self.assertEqual(picked[1], {'id': 'claude/opus-new', 'name': 'Opus New', 'released': '2026-09-22',
                                     'efforts': ['low', 'high', 'max'], 'cost': {'input': 4, 'output': 20}})
        self.assertEqual(picked[0]['efforts'], [])  # not a reasoning model: no effort to set
        with mock.patch.object(coach_ai.importlib, 'import_module', side_effect=ImportError):
            self.assertEqual(coach_ai.featured_models('claude'), picked)  # cached
            self.assertEqual(coach_ai.featured_models('openai'), [])

    def test_arena_models_mark_saved_keys_and_fall_back_to_suggestions(self):
        coach_ai.save_key(self.data, 'claude', 'sk-ant-12345678')
        featured = {'claude': [{'id': 'claude/fable', 'name': 'Fable', 'released': '', 'efforts': ['high'], 'cost': None}]}
        with mock.patch.object(coach_ai, 'featured_models', side_effect=lambda p: featured.get(p, [])),                 mock.patch.dict(os.environ, {coach_ai.HOSTED_ENV: ''}):
            shown = {p['id']: p for p in coach_ai.arena_models(self.data, ['ollama/qwen3:8b'])}
        self.assertEqual((shown['claude']['has_key'], shown['claude']['models']), (True, featured['claude']))
        self.assertFalse(shown['openai']['has_key'])
        self.assertEqual(shown['openai']['models'][0]['id'], f"openai/{coach_ai.BY_ID['openai']['suggested'][0]}")
        self.assertEqual(shown['ollama']['models'][0]['id'], 'ollama/qwen3:8b')
        self.assertNotIn('sk-ant-12345678', str(shown))


if __name__ == '__main__':
    unittest.main()
