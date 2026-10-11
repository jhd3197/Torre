"""Coach explanations (no model is ever called): .venv/Scripts/python -m unittest test_explain -v"""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import chess

from torre.analysis import analyze
from torre.coaching import coach
from torre.coaching import explain
from tests.test_training import BEFORE_NF6, PGN, record

BEST = {'moves': ['g6', 'Qf3', 'Nf6'], 'uci': ['g7g6', 'h5f3', 'g8f6'], 'cp': 40, 'mate': None}
REPLY = {'moves': ['Qxf7#'], 'uci': ['h5f7'], 'cp': None, 'mate': 1}


class ExplainTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        (self.data / 'settings.json').write_text(json.dumps({'coach_model': 'ollama/qwen3:8b'}), encoding='utf-8')

    def test_move_facts_come_from_the_engine_lines(self):
        board = chess.Board(BEFORE_NF6)
        facts = explain.move_facts(board, board.parse_san('Nf6'), BEST, REPLY)
        self.assertEqual((facts['side_to_move'], facts['move_played'], facts['engine_best_move']), ('Black', 'Nf6', 'g6'))
        self.assertEqual(facts['eval_with_best_move'], '-0.4')  # +0.4 for White is -0.4 for Black
        self.assertEqual(facts['eval_after_move_played'], 'mated in 1')
        self.assertEqual(facts['tactics_the_move_allowed'], ['mate in 1'])
        self.assertEqual(facts['opponent_best_reply_line'], ['Qxf7#'])

    def test_answers_are_cached_and_facts_built_only_on_a_miss(self):
        facts = mock.Mock(return_value={'move_played': 'Nf6', 'engine_best_move': 'g6'})
        with mock.patch.object(coach, 'prompture_installed', return_value=True), \
                mock.patch.object(explain, '_ask', return_value={'text': ' It hangs mate. '}) as ask:
            first = explain.answer(self.data, 'mistake', {'fen': 'x', 'move': 'y'}, facts, 'es')
            again = explain.answer(self.data, 'mistake', {'fen': 'x', 'move': 'y'}, facts, 'es')
        self.assertEqual((first['answer'], first['cached'], again['cached']), ({'text': 'It hangs mate.'}, False, True))
        self.assertEqual((ask.call_count, facts.call_count), (1, 1))
        self.assertIn('Spanish', ask.call_args[0][2])
        self.assertIsNone(explain.answer(self.data, 'mistake', {'fen': 'other'}, facts, 'es', cached_only=True)['answer'])

    def test_unavailable_coach_raises(self):
        with mock.patch.object(coach, 'prompture_installed', return_value=False):
            with self.assertRaises(RuntimeError):
                explain.answer(self.data, 'mistake', {'a': 1}, dict)

    def test_game_facts(self):
        moment = {'ply': 6, 'move_number': 3, 'san': 'Nf6', 'class': 'blunder', 'win_before': 48.0, 'win_after': 0.0}
        facts = explain.game_facts({'pgn': PGN, 'user_color': 'black', 'user_result': 0, 'opponent': 'Bot'},
                                   {**record(), 'key_moments': [moment], 'accuracy': 61.2, 'blunder': 1})
        self.assertEqual(facts['result'], 'the player lost')
        self.assertEqual(facts['turning_points'], [{'move_number': 3, 'played': 'Nf6', 'judgment': 'blunder', 'win_chance_before': 48.0,
                                                    'win_chance_after': 0.0, 'engine_preferred': 'g6'}])

    def test_game_review_supplies_opening_choice_and_plan_in_both_languages(self):
        facts = explain.game_facts({'pgn': '1. e4 e5 2. Nf3 Nc6 3. Bb5 *', 'user_color': 'black'}, {})
        self.assertEqual(facts['opening']['name'], 'Ruy Lopez')
        self.assertEqual(facts['opening']['played_by'], 'white')
        self.assertIn('defends e5', facts['opening']['family_idea'])
        for lang, language in [('en', 'English'), ('es', 'Spanish')]:
            with self.subTest(lang=lang):
                prompt = explain.game_prompt(facts, lang)
                self.assertIn('Ruy Lopez', prompt)
                self.assertIn(language, prompt)
                self.assertIn('never invent moves', prompt)
                self.assertIn('do not guess an opening name', prompt)
                self.assertIn('not proof of good play', prompt)

    def test_new_prompt_does_not_reuse_old_review(self):
        key = explain._key('game', {'game': 1}, 'en', 'test-model')
        with mock.patch.object(explain, 'PROMPT_VERSION', explain.PROMPT_VERSION + 1):
            self.assertNotEqual(key, explain._key('game', {'game': 1}, 'en', 'test-model'))


@unittest.skipUnless(__import__('torre.analysis.engine_service', fromlist=['ENGINE_PATH']).ENGINE_PATH.exists(), 'needs Stockfish')
class ServerTests(unittest.TestCase):
    def setUp(self):
        import threading
        from http.server import ThreadingHTTPServer
        from torre.server import studio
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        (self.data / 'games.jsonl').write_text(json.dumps({'id': '1', 'pgn': PGN, 'user_color': 'black'}) + '\n', encoding='utf-8')
        (self.data / 'analysis.jsonl').write_text(json.dumps(record()) + '\n', encoding='utf-8')
        (self.data / 'settings.json').write_text(json.dumps({'coach_model': 'ollama/qwen3:8b'}), encoding='utf-8')
        studio.use_data_dir(self.data)
        env = mock.patch.dict(os.environ, {coach.ENV_MODEL: ''})
        env.start()
        self.addCleanup(env.stop)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), studio.Handler)
        self.base = f'http://127.0.0.1:{self.server.server_address[1]}'
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def post(self, path, body):
        from urllib.error import HTTPError
        from urllib.request import Request, urlopen
        request = Request(self.base + path, json.dumps(body).encode(), {'Content-Type': 'application/json', 'X-Chess-Studio': '1'})
        try:
            with urlopen(request) as response:
                return json.loads(response.read())
        except HTTPError as exc:
            return {'status': exc.code, **json.loads(exc.read())}

    def test_explain_a_move_and_review_a_game(self):
        with mock.patch.object(coach, 'prompture_installed', return_value=True), \
                mock.patch.object(explain, '_ask', side_effect=[{'text': 'Nf6 allows Qxf7#.'},
                                                                {'headline': 'h', 'summary': 's', 'lesson': 'l'}]) as ask:
            self.assertIsNone(self.post('/api/explain', {'fen': BEFORE_NF6, 'move': 'Nf6', 'cachedOnly': True})['answer'])
            out = self.post('/api/explain', {'fen': BEFORE_NF6, 'move': 'g8f6'})  # UCI and SAN name the same move
            self.assertEqual(out['answer'], {'text': 'Nf6 allows Qxf7#.'})
            self.assertIn('Qxf7#', ask.call_args[0][2])  # the engine's refutation is in the facts
            self.assertTrue(self.post('/api/explain', {'fen': BEFORE_NF6, 'move': 'Nf6'})['cached'])
            self.assertEqual(self.post('/api/explain', {'fen': BEFORE_NF6, 'move': 'Ke2'})['status'], 400)
            review = self.post('/api/coach/game', {'id': 1})
            self.assertEqual(review['answer'], {'headline': 'h', 'summary': 's', 'lesson': 'l'})
            self.assertEqual(self.post('/api/coach/game', {'id': 99})['status'], 404)
        with mock.patch.object(coach, 'prompture_installed', return_value=False):
            self.assertEqual(self.post('/api/explain', {'fen': chess.STARTING_FEN, 'move': 'e4'})['status'], 503)
