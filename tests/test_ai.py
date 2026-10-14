"""Torre's AI (torre/ai): keys, the catalogue, which model each feature uses, calls, and the
/api/ai routes. No model is ever called: python -m unittest tests.test_ai -v"""
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from torre.ai import calls, catalogue, config, keys, runtime

KEY_NAMES = set(keys.KNOWN_VARS.values()) | {a for names in keys.ALIASES.values() for a in names}
# The catalogue's real lookups, before isolate() replaces them for a test.
REAL = {name: getattr(catalogue, name) for name in ('local_servers', 'featured_models', 'login_installed')}


def isolate(test):
    """A temporary data folder and shared key store, no provider keys or model from the
    environment, no model servers or logins, and fresh caches; returns the data folder."""
    try:
        import prompture  # noqa: F401 (its import loads a .env into the environment: let it happen before the clean one)
    except ImportError:
        pass
    tmp = tempfile.TemporaryDirectory()
    test.addCleanup(tmp.cleanup)
    data = Path(tmp.name) / 'data'
    data.mkdir()
    env = {k: v for k, v in os.environ.items() if k not in KEY_NAMES and not k.endswith('_API_KEY')}
    env.update({config.ENV_MODEL: '', config.LEGACY_ENV_MODEL: '', keys.HOSTED_ENV: ''})
    for patch in (mock.patch.dict(os.environ, env, clear=True),
                  mock.patch.object(keys, 'STORE_PATH', Path(tmp.name) / 'credentials.yaml'),
                  mock.patch.object(catalogue, 'local_servers', return_value=[]),
                  mock.patch.object(catalogue, 'login_installed', return_value=None),
                  mock.patch.object(catalogue, 'featured_models', return_value=[])):
        patch.start()
        test.addCleanup(patch.stop)
    catalogue.clear()
    test.addCleanup(catalogue.clear)
    return data


def hosted(test):
    patch = mock.patch.dict(os.environ, {keys.HOSTED_ENV: '1'})
    patch.start()
    test.addCleanup(patch.stop)


def write_settings(data, **values):
    (data / 'settings.json').write_text(json.dumps(values), encoding='utf-8')


class KeyTests(unittest.TestCase):
    def setUp(self):
        self.data = isolate(self)

    def test_keys_go_to_prompture_s_shared_store_and_show_only_as_a_hint(self):
        keys.save_key(self.data, 'openai', 'sk-abcdefgh1234')
        self.assertEqual(keys.STORE_PATH.read_text(encoding='utf-8').count('OPENAI_API_KEY'), 1)
        self.assertFalse((self.data / keys.SECRETS_FILE).exists())
        self.assertEqual(keys.keys(self.data), {'openai': {'key': 'sk-abcdefgh1234', 'source': 'saved'}})
        self.assertEqual(keys.key_for(self.data, 'openai/gpt-6-luna'), 'sk-abcdefgh1234')
        self.assertIsNone(keys.key_for(self.data, 'claude/claude-fable-5-1'))
        self.assertEqual(keys.hint('sk-abcdefgh1234'), '…1234')
        keys.save_key(self.data, 'openai', '')
        self.assertEqual(keys.keys(self.data), {})

    def test_a_key_in_the_environment_counts_by_the_vendor_s_name_too(self):
        with mock.patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'sk-ant-env-9999'}):
            found = keys.keys(self.data)
        # Compared without printing: a failure here must not show a real key.
        self.assertEqual(sorted(found), ['claude'])
        self.assertTrue(found['claude']['key'] == 'sk-ant-env-9999' and found['claude']['source'] == 'environment')

    def test_hosted_keys_stay_in_each_player_s_data_folder(self):
        hosted(self)
        keys.save_key(self.data, 'claude', 'sk-ant-player-1234')
        self.assertFalse(keys.STORE_PATH.exists())
        self.assertEqual(json.loads((self.data / keys.SECRETS_FILE).read_text(encoding='utf-8')), {'keys': {'claude': 'sk-ant-player-1234'}})
        self.assertEqual(keys.key_for(self.data, 'claude/x'), 'sk-ant-player-1234')
        self.assertEqual(keys.migrate(self.data), [])  # hosted keys never move to the shared store

    def test_old_keys_move_to_the_shared_store_once(self):
        (self.data / keys.SECRETS_FILE).write_text(json.dumps({'keys': {'openai': 'sk-old-111111', 'claude': 'sk-ant-old-2222'}}), encoding='utf-8')
        keys.save_key(self.data, 'claude', 'sk-ant-newer-3333')  # already in the store: the store wins
        (self.data / keys.SECRETS_FILE).write_text(json.dumps({'keys': {'openai': 'sk-old-111111', 'claude': 'sk-ant-old-2222'}}), encoding='utf-8')
        self.assertEqual(keys.migrate(self.data), ['openai'])
        self.assertFalse((self.data / keys.SECRETS_FILE).exists())
        found = {p: v['key'] for p, v in keys.keys(self.data).items()}
        self.assertEqual(found, {'openai': 'sk-old-111111', 'claude': 'sk-ant-newer-3333'})


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.data = isolate(self)

    def test_a_feature_s_own_model_then_the_default_then_the_environment_then_a_local_one(self):
        self.assertEqual(config.choose_model(self.data, 'coach'), (None, None))
        with mock.patch.object(catalogue, 'local_models', return_value=['ollama/qwen3:8b']):
            self.assertEqual(config.choose_model(self.data, 'coach'), ('ollama/qwen3:8b', 'auto'))
            with mock.patch.dict(os.environ, {keys.HOSTED_ENV: '1'}):
                self.assertEqual(config.choose_model(self.data), (None, None))  # hosted: no local servers
        with mock.patch.dict(os.environ, {config.LEGACY_ENV_MODEL: 'openai/gpt-6-luna'}):
            self.assertEqual(config.choose_model(self.data), ('openai/gpt-6-luna', 'default'))
        write_settings(self.data, ai={'model': 'claude/claude-sonnet-5-5', 'features': {'explain': 'claude-code/haiku', 'chess': 'x/y'}})
        self.assertEqual(config.choose_model(self.data, 'coach'), ('claude/claude-sonnet-5-5', 'default'))
        self.assertEqual(config.choose_model(self.data, 'explain'), ('claude-code/haiku', 'feature'))
        self.assertEqual(config.read(self.data)['features'], {'explain': 'claude-code/haiku'})  # unknown features dropped

    def test_the_coach_s_old_settings_read_as_the_default_until_the_first_save(self):
        write_settings(self.data, coach_model='ollama/qwen3:8b', coach_setup_seen=True, theme='wood')
        self.assertEqual(config.read(self.data), {'model': 'ollama/qwen3:8b', 'features': {}, 'setup_seen': True})
        settings = json.loads((self.data / 'settings.json').read_text(encoding='utf-8'))
        config.apply(settings, features={'coach': 'openai/gpt-6-sol'})
        self.assertEqual(settings, {'theme': 'wood', 'ai': {'model': 'ollama/qwen3:8b', 'features': {'coach': 'openai/gpt-6-sol'}, 'setup_seen': True}})
        config.apply(settings, model=None, features={'coach': None})
        self.assertEqual(settings, {'theme': 'wood', 'ai': {'setup_seen': True}})

    def test_forgetting_a_provider_clears_every_choice_that_used_it(self):
        settings = {'ai': {'model': 'openai/gpt-6-sol', 'features': {'coach': 'openai/gpt-6-luna', 'explain': 'claude/claude-fable-5-1'}}}
        config.forget_provider(settings, 'openai')
        self.assertEqual(settings, {'ai': {'features': {'explain': 'claude/claude-fable-5-1'}}})

    def test_valid_model(self):
        for good in ('ollama/qwen3:8b', 'openai/gpt-6-luna', 'ollama/hhao/qwen2.5:14b', 'claude-code/opus'):
            self.assertTrue(config.valid_model(good), good)
        for bad in ('', 'qwen3', '/x', 'ollama/ qwen', None, 'a/' + 'b' * 300):
            self.assertFalse(config.valid_model(bad), bad)


class CatalogueTests(unittest.TestCase):
    def setUp(self):
        self.data = isolate(self)

    def test_local_models_put_general_chat_models_first(self):
        servers = [{'id': 'ollama', 'name': 'Ollama', 'running': True, 'url': '', 'models': ['qwen3-coder:30b', 'mistral:latest', 'qwen3:8b', 'weird']},
                   {'id': 'lmstudio', 'name': 'LM Studio', 'running': True, 'url': '', 'models': ['qwen3-14b']},
                   {'id': 'other', 'name': 'Off', 'running': False, 'url': '', 'models': ['x']}]
        with mock.patch.object(catalogue, 'local_servers', return_value=servers):
            self.assertEqual(catalogue.local_models(), ['ollama/qwen3:8b', 'ollama/mistral:latest', 'ollama/weird',
                                                        'lmstudio/qwen3-14b', 'ollama/qwen3-coder:30b'])

    def test_an_older_prompture_asks_ollama_itself(self):
        with mock.patch.dict(sys.modules, {'prompture.infra.local_servers': None}),                 mock.patch.object(catalogue, '_ollama_tags', return_value=['qwen3:8b']):
            servers = REAL['local_servers']()
        self.assertEqual([(s['id'], s['running'], s['models']) for s in servers], [('ollama', True, ['qwen3:8b'])])

    def test_providers_list_logins_servers_and_cloud_with_what_is_ready(self):
        servers = [{'id': 'ollama', 'name': 'Ollama', 'running': True, 'url': '', 'models': ['qwen3:8b']},
                   {'id': 'lmstudio', 'name': 'LM Studio', 'running': False, 'url': '', 'models': []}]
        keys.save_key(self.data, 'claude', 'sk-ant-abcdef5678')
        with mock.patch.object(catalogue, 'local_servers', return_value=servers), \
                mock.patch.object(catalogue, 'login_installed', side_effect=lambda p: p == 'claude-code'):
            found = {p['id']: p for p in catalogue.providers(self.data)}
        self.assertEqual([found[p]['kind'] for p in ('claude-code', 'ollama', 'claude')], ['login', 'local', 'cloud'])
        self.assertEqual((found['claude-code']['ready'], found['codex']['ready'], found['codex']['detail']), (True, False, 'not_installed'))
        self.assertEqual([m['id'] for m in found['claude-code']['models']][:2], ['claude-code/default', 'claude-code/opus'])
        self.assertEqual((found['ollama']['ready'], found['lmstudio']['detail']), (True, 'not_running'))
        self.assertEqual(found['claude']['key'], {'hint': '…5678', 'source': 'saved'})
        self.assertEqual((found['openai']['ready'], found['openai']['detail']), (False, 'needs_key'))
        self.assertNotIn('sk-ant-abcdef5678', json.dumps(list(found.values())))

    def test_hosted_offers_only_cloud_providers(self):
        hosted(self)
        with mock.patch.object(catalogue, 'login_installed', return_value=True):
            self.assertEqual({p['kind'] for p in catalogue.providers(self.data)}, {'cloud'})

    def test_featured_models_are_the_newest_current_chat_model_of_each_family(self):
        rows = {
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
            row = rows[model_id]
            return {'modalities': {'output': row.get('output', ['text'])}, 'tool_call': row.get('tool_call', True), **row}

        rates = types.SimpleNamespace(
            get_all_provider_models=lambda provider: list(rows), get_model_info=info,
            get_model_lifecycle=lambda provider, model_id: {'status': rows[model_id].get('lifecycle', 'current'), 'family': rows[model_id]['family']})
        with mock.patch.object(catalogue, '_rates', return_value=rates):
            picked = REAL['featured_models']('claude')
        self.assertEqual([m['id'] for m in picked], ['claude/haiku', 'claude/opus-new'])
        self.assertEqual(picked[1], {'id': 'claude/opus-new', 'name': 'Opus New', 'provider': 'claude', 'released': '2026-09-22',
                                     'efforts': ['low', 'high', 'max'], 'cost': {'input': 4, 'output': 20}})
        self.assertEqual(picked[0]['efforts'], [])  # not a reasoning model: no effort to set

    def test_logins_describe_their_models(self):
        self.assertEqual(catalogue.describe('claude-code/opus')['name'], 'Claude Code · Opus')
        self.assertEqual(catalogue.describe('codex/default')['efforts'], ['low', 'medium', 'high', 'xhigh'])


class CallTests(unittest.TestCase):
    def setUp(self):
        self.data = isolate(self)

    def test_options_are_the_same_for_every_feature(self):
        self.assertEqual(calls.options('claude/claude-fable-5-1', effort='high'),
                         {'max_tokens': 2000, 'timeout': calls.TIMEOUT_S, 'effort': 'high', 'reasoning_effort': 'high'})
        self.assertEqual(calls.options('ollama/qwen3:8b', max_tokens=700), {'max_tokens': 700, 'timeout': calls.TIMEOUT_S, 'think': False})
        self.assertNotIn('think', calls.options('ollama/qwen3:8b', think=True))

    def fake_prompture(self, extract):
        fake = types.SimpleNamespace(extract_with_model=extract)
        patch = mock.patch.dict(sys.modules, {'prompture': fake})
        patch.start()
        self.addCleanup(patch.stop)
        installed = mock.patch.object(runtime, 'prompture_installed', return_value=True)
        installed.start()
        self.addCleanup(installed.stop)

    def test_the_saved_key_goes_with_the_call(self):
        seen = []

        def extract(schema, text, model, options=None, max_retries=1, api_key=None):
            seen.append((model, api_key, options))
            return {'model': types.SimpleNamespace(model_dump=lambda: {'ok': True})}

        self.fake_prompture(extract)
        keys.save_key(self.data, 'openai', 'sk-player-key-9999')
        self.assertEqual(calls.ask(object, 'openai/gpt-6-luna', 'hi', data_dir=self.data), {'ok': True})
        calls.ask(object, 'ollama/qwen3:8b', 'hi', data_dir=self.data)
        self.assertEqual([(m, k) for m, k, _ in seen], [('openai/gpt-6-luna', 'sk-player-key-9999'), ('ollama/qwen3:8b', None)])

    def test_a_provider_s_error_is_one_line_without_the_key(self):
        def extract(*args, **kwargs):
            raise RuntimeError('401 invalid x-api-key sk-ant-api03-abcdefghijklmnopqrstuvwxyz\ntraceback...')

        self.fake_prompture(extract)
        with self.assertRaises(calls.AiError) as caught:
            calls.ask(object, 'claude/x', 'hi', data_dir=self.data)
        self.assertNotIn('abcdefghijklmnop', str(caught.exception))
        self.assertNotIn('traceback', str(caught.exception))

    def test_without_prompture_or_a_model_the_call_says_where_to_fix_it(self):
        with mock.patch.object(runtime, 'prompture_installed', return_value=False):
            with self.assertRaisesRegex(calls.AiError, 'Settings > AI'):
                calls.ask(object, 'claude/x', 'hi')
        with mock.patch.object(runtime, 'prompture_installed', return_value=True):
            with self.assertRaisesRegex(calls.AiError, 'Settings > AI'):
                calls.ask(object, None, 'hi')

    def test_test_reports_the_reply_or_the_error(self):
        class Driver:
            def __init__(self, reply):
                self.reply = reply

            def generate_messages(self, messages, options):
                if isinstance(self.reply, Exception):
                    raise self.reply
                return {'text': self.reply}

        for reply, expected in ((' ready ', {'ok': True, 'reply': 'ready'}), ('', {'ok': False, 'error': 'The model answered with nothing.'}),
                                (RuntimeError('model not found\ndetails'), {'ok': False, 'error': 'model not found'})):
            drivers = types.SimpleNamespace(get_driver_for_model=lambda model, reply=reply, **kw: Driver(reply))
            with mock.patch.dict(sys.modules, {'prompture.drivers': drivers}),                     mock.patch.object(runtime, 'prompture_installed', return_value=True):
                out = calls.test('ollama/qwen3:8b', self.data)
            self.assertEqual({k: out[k] for k in expected}, expected)



class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.data = isolate(self)

    def test_install_job(self):
        job = runtime.InstallJob()
        with mock.patch.object(runtime, 'in_virtualenv', return_value=False):
            self.assertEqual(job.command(self.data)[-2:], ['--target', str(self.data / runtime.PYLIB)])
        with mock.patch.object(runtime, 'in_virtualenv', return_value=True):
            self.assertEqual(job.command(self.data)[-1], runtime.PACKAGE)
        with mock.patch.object(job, '_run', return_value=(1, 'No matching distribution')), \
                self.assertLogs('torre.ai.runtime', 'ERROR'):
            job.start(self.data)
            job.thread.join(5)
        self.assertEqual(job.status()['error'], 'No matching distribution')
        with mock.patch.object(job, '_run', return_value=(0, '')) as run, \
                mock.patch.object(runtime, 'prompture_installed', return_value=True):
            job.start(self.data)
            job.thread.join(5)
        self.assertEqual(job.status(), {'running': False, 'error': None, 'done': True})
        self.assertIn(runtime.PACKAGE, run.call_args[0][0])

    def test_pylib_joins_the_import_path(self):
        pylib = self.data / runtime.PYLIB
        runtime.use_data_dir(self.data)
        self.assertNotIn(str(pylib), sys.path)
        pylib.mkdir()
        self.addCleanup(lambda: str(pylib) in sys.path and sys.path.remove(str(pylib)))
        runtime.use_data_dir(self.data)
        self.assertEqual(sys.path[0], str(pylib))

    def test_usage_adds_up_each_model_s_keys(self):
        rows = [{'model_name': 'claude/x', 'use_count': 2, 'total_tokens': 100, 'total_cost': 0.5, 'last_used': '2026-10-01'},
                {'model_name': 'claude/x', 'use_count': 1, 'total_tokens': 50, 'total_cost': 0.25, 'last_used': '2026-10-02'},
                {'model_name': 'ollama/q', 'use_count': 9, 'total_tokens': 900, 'total_cost': 0.0, 'last_used': '2026-09-01'}]
        ledger = types.SimpleNamespace(_get_ledger=lambda: types.SimpleNamespace(get_all_stats=lambda: rows))
        with mock.patch.dict(sys.modules, {'prompture.infra.ledger': ledger}):
            self.assertEqual(runtime.usage(), [
                {'model': 'claude/x', 'calls': 3, 'tokens': 150, 'cost': 0.75, 'last_used': '2026-10-02'},
                {'model': 'ollama/q', 'calls': 9, 'tokens': 900, 'cost': 0.0, 'last_used': '2026-09-01'}])


class RouteTests(unittest.TestCase):
    """/api/ai through the real request handler."""
    def setUp(self):
        import threading
        from http.server import ThreadingHTTPServer
        from torre.server import studio
        self.data = isolate(self)
        studio.use_data_dir(self.data)
        for patch in (mock.patch.object(runtime, 'desk', return_value={'running': True, 'version': '1.13.11'}),
                      mock.patch.object(runtime, 'prompture_installed', return_value=True)):
            patch.start()
            self.addCleanup(patch.stop)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), studio.Handler)
        self.base = f'http://127.0.0.1:{self.server.server_address[1]}'
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(self, path, body=None):
        from urllib.error import HTTPError
        from urllib.request import Request, urlopen
        headers = {'Content-Type': 'application/json', 'X-Chess-Studio': '1'} if body is not None else {}
        request = Request(self.base + path, None if body is None else json.dumps(body).encode(), headers)
        try:
            with urlopen(request) as response:
                return json.loads(response.read())
        except HTTPError as exc:
            return {'status': exc.code, **json.loads(exc.read())}

    def settings(self):
        return json.loads((self.data / 'settings.json').read_text(encoding='utf-8'))

    def test_the_view_and_choosing_models(self):
        view = self.call('/api/ai')
        self.assertEqual((view['prompture']['installed'], view['desk']['running'], view['model']), (True, True, None))
        self.assertIn('claude', [p['id'] for p in view['providers']])
        view = self.call('/api/ai/settings', {'model': 'claude-code/sonnet', 'features': {'explain': 'openai/gpt-6-sol'}})
        self.assertEqual((view['model'], view['source']), ('claude-code/sonnet', 'default'))
        self.assertEqual(view['features']['explain'], {'model': 'openai/gpt-6-sol', 'source': 'feature'})
        self.assertEqual(view['features']['coach'], {'model': 'claude-code/sonnet', 'source': 'default'})
        self.assertEqual(view['models']['claude-code/sonnet']['name'], 'Claude Code · Sonnet')
        self.assertEqual(self.settings()['ai'], {'model': 'claude-code/sonnet', 'features': {'explain': 'openai/gpt-6-sol'}})
        self.assertEqual(self.call('/api/ai/settings', {'model': 'not a model'})['status'], 400)
        self.assertEqual(self.call('/api/ai/settings', {'features': {'chess': 'a/b'}})['status'], 400)
        status = self.call('/api/ai/status?feature=explain')
        self.assertEqual((status['available'], status['model']), (True, 'openai/gpt-6-sol'))
        self.assertEqual(self.call('/api/ai/status?feature=nope')['status'], 400)
        self.assertTrue(self.call('/api/ai/seen', {})['setup_seen'])

    def test_keys_are_checked_saved_and_forgotten_with_the_choices_that_used_them(self):
        validate = mock.Mock(side_effect=lambda provider, key: types.SimpleNamespace(status='invalid' if key == 'bad-key-0000' else 'valid'))
        with mock.patch.dict(sys.modules, {'prompture.infra.provider_keys': types.SimpleNamespace(validate_key=validate)}):
            self.assertEqual(self.call('/api/ai/key', {'provider': 'openai', 'key': 'bad-key-0000'})['status'], 400)
            out = self.call('/api/ai/key', {'provider': 'openai', 'key': 'sk-good-key-4321'})
        self.assertEqual(out['check'], 'valid')
        self.assertEqual(next(p for p in out['providers'] if p['id'] == 'openai')['key'], {'hint': '…4321', 'source': 'saved'})
        self.assertNotIn('sk-good-key-4321', json.dumps(out))
        self.call('/api/ai/settings', {'model': 'openai/gpt-6-luna'})
        out = self.call('/api/ai/key', {'provider': 'openai', 'key': ''})
        self.assertIsNone(out['settings']['model'])
        self.assertEqual(self.call('/api/ai/key', {'provider': 'nope', 'key': 'x'})['status'], 400)
        self.assertEqual(self.call('/api/ai/key', {'provider': 'openai', 'key': 'two words'})['status'], 400)

    def test_install_and_test(self):
        with mock.patch.object(runtime.INSTALL, 'start') as install:
            self.assertIn('prompture', self.call('/api/ai/install', {}))
        install.assert_called_once()
        with mock.patch.object(calls, 'test', return_value={'ok': True, 'seconds': 0.4, 'reply': 'ready'}) as test:
            self.assertEqual(self.call('/api/ai/test', {'model': 'ollama/qwen3:8b'})['reply'], 'ready')
        test.assert_called_once()
        self.assertEqual(self.call('/api/ai/test', {'model': 'nope'})['status'], 400)


if __name__ == '__main__':
    unittest.main()
