"""The coaching loop (skills, ledger, focus, generated lessons): .venv/Scripts/python -m unittest test_coach_core -v"""
import json
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from torre.learning import achievements
from torre.coaching import coach_focus
from torre.coaching import coach_home
from torre.coaching import coach_ledger
from torre.coaching import coach_lessons
from torre.learning import lessons
from torre.analysis import motifs
from torre.voice import narrate
from torre.learning import puzzles
from torre.coaching import skills
from tests.test_training import PGN, record

NOW = datetime(2026, 9, 10, 12, tzinfo=timezone.utc)
# 3...Nf6?? lets White mate on f7: the game's one slip, a mate in one allowed.
GAME = {'id': '1', 'pgn': PGN, 'user_color': 'black', 'date': '2026.09.08', 'opponent': 'Bot',
        'end_time_unix': int(datetime(2026, 9, 8, tzinfo=timezone.utc).timestamp())}


def write_game(folder):
    (folder / 'games.jsonl').write_text(json.dumps(GAME) + '\n', encoding='utf-8')
    (folder / 'analysis.jsonl').write_text(json.dumps(record()) + '\n', encoding='utf-8')


def row(skill, mastery=50, confidence=0.5, trend='steady', missed=0):
    return {'skill': skill, 'family': skills.SKILLS[skill]['family'], 'mastery': mastery, 'confidence': confidence,
            'trend': trend, 'events': 10, 'week': {'ok': 0, 'missed': missed, 'games_missed': missed},
            'evidence': [], 'last': None}


def event(skill, ok, day, weight=1.0):
    return {'skill': skill, 'ok': ok, 'w': weight, 'at': datetime.combine(day, datetime.min.time(), timezone.utc),
            'src': 'puzzle', 'ref': {}}


class SkillTests(unittest.TestCase):
    def test_every_skill_points_at_real_tags_themes_and_endgames(self):
        from torre.learning import endgames
        groups = {e['group'] for e in endgames.BY_ID.values()}
        for skill, spec in skills.SKILLS.items():
            with self.subTest(skill=skill):
                self.assertIn(spec['family'], skills.FAMILIES)
                self.assertTrue(set(spec['puzzle_themes']) <= set(puzzles.THEMES))
                self.assertTrue(set(spec['motif_tags']) <= set(motifs.MOTIFS))
                self.assertTrue(set(spec['endgames']) <= groups)

    def test_every_tactic_a_mistake_can_show_belongs_to_a_skill(self):
        self.assertEqual([t for t in motifs.MOTIFS if not skills.skill_for_tag(t)], [])

    def test_every_skill_can_be_practised(self):
        counts = {slug: len(pack) for slug, pack in puzzles.load_packs()['themes'].items()}
        self.assertEqual([s for s in skills.SKILLS if not skills.practiceable(s, counts)], [])

    def test_lessons_teach_the_skill_of_their_practice_theme(self):
        self.assertEqual(skills.lesson_skills()['knight-fork'], 'fork')
        self.assertEqual(skills.teaching_lessons('hanging-piece')[0], 'hanging-pieces')
        self.assertEqual(skills.skills_for_puzzle_tags(['myGames', 'hangingPiece', 'fork']), ['hanging-piece', 'fork'])

    def test_scan_facts_are_ones_achievements_counts(self):
        board = achievements.chess.Board()
        facts = set(achievements.scan(board, [], achievements.chess.WHITE)) | {'fork', 'pin', 'skewer', 'discovery',
                                                                                'checkmate', 'back_rank', 'promotion'}
        for spec in skills.SKILLS.values():
            self.assertTrue(set(spec['scan_facts']) <= facts)


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)

    def test_no_evidence_sits_at_the_prior(self):
        ledger = coach_ledger.build(self.data, NOW)
        self.assertEqual(set(ledger), set(skills.SKILLS))
        self.assertTrue(all(r['mastery'] == 50 and r['trend'] == 'new' for r in ledger.values()))

    def test_a_game_slip_counts_against_its_skill_and_clean_games_for_the_rest(self):
        write_game(self.data)
        events = coach_ledger.all_events(self.data)
        slips = [e for e in events if not e['ok']]
        self.assertEqual([(e['skill'], e['ref']['ply'], e['ref']['kind']) for e in slips], [('mate-in-one', 6, 'allowed')])
        clean = {e['skill'] for e in events if e['ok']}
        self.assertEqual(clean, {s for s, spec in skills.SKILLS.items() if spec['motif_tags']} - {'mate-in-one'})
        ledger = coach_ledger.build(self.data, NOW, events)
        self.assertLess(ledger['mate-in-one']['mastery'], 50)
        self.assertEqual(ledger['mate-in-one']['evidence'][0]['ref']['game'], '1')
        self.assertEqual(ledger['mate-in-one']['week']['games_missed'], 1)
        self.assertEqual(next(iter(ledger)), 'mate-in-one')  # weakest first

    def test_games_are_scanned_once(self):
        write_game(self.data)
        with mock.patch.object(motifs, 'game_motifs', wraps=motifs.game_motifs) as scan:
            coach_ledger.scan_games(self.data)
            coach_ledger.scan_games(self.data)
        self.assertEqual(scan.call_count, 1)
        self.assertTrue((self.data / coach_ledger.SCAN_FILE).exists())

    def test_puzzles_lessons_and_old_evidence(self):
        packs = puzzles.load_packs()
        fork = packs['themes']['fork'][0]['id']
        (self.data / 'puzzles.json').write_text(json.dumps({'puzzles': {fork: {'first': 'missed', 'last_at': NOW.isoformat()}},
                                                            'history': [{'id': fork, 'at': NOW.isoformat(), 'result': 'missed',
                                                                         'misses': ['a1a2'], 'rated': True}]}), encoding='utf-8')
        (self.data / 'story.json').write_text(json.dumps({'steps': {'knight-fork/fork-it': {
            'firstTry': True, 'completedAt': NOW.isoformat()}}}), encoding='utf-8')
        events = coach_ledger.all_events(self.data)
        self.assertEqual(sorted((e['src'], e['ok']) for e in events if e['skill'] == 'fork'), [('lesson', True), ('puzzle', False)])
        fresh = coach_ledger.entry('fork', [event('fork', False, NOW.date())], NOW)['mastery']
        old = coach_ledger.entry('fork', [event('fork', False, (NOW - timedelta(days=120)).date())], NOW)['mastery']
        self.assertLess(fresh, old)  # older evidence counts less
        self.assertLess(old, 50)

    def test_trend_compares_two_weeks(self):
        day = NOW.date()
        worse = [event('fork', True, day - timedelta(days=20))] * 4 + [event('fork', False, day - timedelta(days=2))] * 4
        self.assertEqual(coach_ledger.entry('fork', worse, NOW)['trend'], 'worse')
        better = [event('fork', False, day - timedelta(days=20))] * 4 + [event('fork', True, day - timedelta(days=2))] * 4
        self.assertEqual(coach_ledger.entry('fork', better, NOW)['trend'], 'better')


class FocusTests(unittest.TestCase):
    COUNTS = {theme: 10 for theme in puzzles.THEMES}

    def ledger(self):
        return {r['skill']: r for r in [row('fork', 20, 1.0), row('pin', 30, 1.0), row('skewer', 35, 1.0),
                                       row('hanging-piece', 45, 0.9), row('back-rank', 90, 1.0)]}

    def test_picks_the_weakest_with_at_most_two_tactics(self):
        state, changes = coach_focus.update(coach_focus.load('nowhere'), self.ledger(), NOW.date(), self.COUNTS)
        self.assertEqual([f['skill'] for f in state['active']], ['fork', 'pin', 'hanging-piece'])
        self.assertEqual([c['kind'] for c in changes], ['added'] * 3)

    def test_a_focus_stays_until_it_graduates_on_fresh_evidence(self):
        today = NOW.date()
        state, _ = coach_focus.update(coach_focus.load('nowhere'), self.ledger(), today, self.COUNTS)
        ledger = {**self.ledger(), 'skewer': row('skewer', 5, 1.0)}  # a weaker skill turns up
        state, changes = coach_focus.update(state, ledger, today + timedelta(days=1), self.COUNTS)
        self.assertEqual(changes, [])
        self.assertNotIn('skewer', [f['skill'] for f in state['active']])
        events = [event('fork', True, today + timedelta(days=1))] * 6
        state, changes = coach_focus.update(state, ledger, today + timedelta(days=2), self.COUNTS, events)
        self.assertEqual(changes[0]['kind'], 'graduated')
        self.assertEqual(changes[0]['skill'], 'fork')
        self.assertIn('skewer', [f['skill'] for f in state['active']])  # the free slot is refilled
        self.assertEqual(state['graduated'][0]['skill'], 'fork')

    def test_too_little_or_too_shaky_evidence_does_not_graduate(self):
        since = NOW.date().isoformat()
        self.assertFalse(coach_focus.ready('fork', since, [event('fork', True, NOW.date())] * 5))
        mixed = [event('fork', True, NOW.date())] * 4 + [event('fork', False, NOW.date())] * 4
        self.assertFalse(coach_focus.ready('fork', since, mixed))

    def test_pin_and_skip(self):
        today = NOW.date()
        state, _ = coach_focus.update(coach_focus.load('nowhere'), self.ledger(), today, self.COUNTS)
        coach_focus.act(state, 'skip', 'fork', today)
        coach_focus.act(state, 'pin', 'back-rank', today)
        state, _ = coach_focus.update(state, self.ledger(), today, self.COUNTS)
        active = [f['skill'] for f in state['active']]
        self.assertEqual(active[0], 'back-rank')
        self.assertNotIn('fork', active)
        state, _ = coach_focus.update(state, self.ledger(), today + timedelta(days=coach_focus.SKIP_DAYS + 1), self.COUNTS)
        self.assertNotIn('fork', state['skipped'])
        with self.assertRaises(ValueError):
            coach_focus.act(state, 'skip', 'nope', today)


def spoken_parts(lesson):
    """Every recorded line a generated lesson's narration and coach text asks for."""
    for step in lesson['steps']:
        for beat in (step.get('narration') or '').split(lessons.MOVE_CUE):
            for part in beat.split(coach_lessons.PART):
                if part.strip():
                    yield part.strip()


class GeneratedLessonTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        write_game(self.data)

    def test_a_game_lesson_replays_the_slip_then_asks_for_the_better_move(self):
        slug = coach_home.game(self.data, '1')['lesson']
        self.assertEqual(slug, 'game-1')
        lesson = coach_lessons.render(self.data, slug, 'en')
        kinds = [(s['id'], s['kind']) for s in lesson['steps']]
        self.assertEqual(kinds, [('intro', 'explain'), ('moment-1', 'explain'), ('find-1', 'play'), ('why-1', 'choose'),
                                 ('outro', 'explain')])
        moment = lesson['steps'][1]
        self.assertEqual([m['san'] for m in moment['demo']], ['Nf6', 'Qxf7#'])
        self.assertEqual(moment['narration'].count(lessons.MOVE_CUE), 2)
        self.assertEqual(lesson['steps'][2]['moves'][0]['uci'], 'g7g6')
        self.assertEqual(lesson['steps'][2]['skill'], 'mate-in-one')
        choose = lesson['steps'][3]
        self.assertEqual([o['text'] for o in choose['options'] if o['correct']], ['Checkmate in one move'])
        self.assertEqual(lesson['orientation'], 'black')
        self.assertEqual(lesson['coach']['kind'], 'game')

    def test_every_word_the_coach_says_is_recorded(self):
        slug = coach_lessons.ensure_game(self.data, '1', coach_ledger.scan_games(self.data)['1'])
        for lang in ('en', 'es'):
            with self.subTest(lang=lang):
                recorded = set(narrate.all_lines(lang))
                lesson = coach_lessons.render(self.data, slug, lang)
                self.assertEqual([p for p in spoken_parts(lesson) if p not in recorded], [])
                home = coach_home.home(self.data, lang, NOW)
                self.assertEqual([p for p in home['briefing'] if p not in recorded], [])
                self.assertEqual([p for p in coach_home.game(self.data, '1', lang)['lines'] if p not in recorded], [])

    def test_a_clean_game_has_no_lesson(self):
        clean = {**record(), 'worst_moves': [w for w in record()['worst_moves'] if w['class'] != 'blunder']}
        (self.data / 'analysis.jsonl').write_text(json.dumps(clean) + '\n', encoding='utf-8')
        result = coach_home.game(self.data, '1', 'en')
        self.assertIsNone(result['lesson'])
        self.assertEqual(result['lines'], [coach_lessons.Lines('en').t('recap.clean')])

    def test_a_session_mixes_your_slip_a_teaching_step_and_puzzles(self):
        ledger = coach_ledger.build(self.data, NOW)
        slug = coach_lessons.ensure_session(self.data, 'mate-in-one', NOW.date(), ledger['mate-in-one'])
        plan = coach_lessons.load(self.data)['lessons'][slug]
        types = [s['type'] for s in plan['steps']]
        self.assertEqual(types[:3], ['session-intro', 'moment-show', 'moment-play'])
        self.assertIn('teach', types)
        self.assertEqual(types.count('puzzle'), coach_lessons.PRACTICE)
        self.assertEqual(coach_lessons.plan_session(self.data, 'mate-in-one', NOW.date(), ledger['mate-in-one'])['steps'],
                         plan['steps'])  # the same day plans the same session
        lesson = coach_lessons.render(self.data, slug, 'es')
        self.assertEqual({s['skill'] for s in lesson['steps']}, {'mate-in-one'})
        self.assertEqual(lesson['title'], 'Mate en uno')
        # A session answer counts for the skill it trained.
        (self.data / 'story.json').write_text(json.dumps({'steps': {f'{slug}/puzzle-1': {
            'firstTry': True, 'completedAt': NOW.isoformat()}}}), encoding='utf-8')
        found = [e for e in coach_ledger.lesson_events(self.data) if e['ref']['lesson'] == slug]
        self.assertEqual([(e['skill'], e['ok'], e['w']) for e in found], [('mate-in-one', True, coach_ledger.W_COACH_LESSON)])


    def test_a_skill_with_a_warm_up_gets_a_drill_recipe(self):
        plan = coach_lessons.plan_session(self.data, 'hanging-piece', NOW.date())
        drill = next(s for s in plan['steps'] if s['type'] == 'drill')
        self.assertEqual(drill['drill']['kind'], 'capture')
        self.assertIn(drill['drill']['piece'], coach_lessons.DRILL_PIECES)
        lesson = coach_lessons.render(self.data, 'session-x', 'en', plan)
        step = next(s for s in lesson['steps'] if s['id'] == 'warm-up')
        self.assertEqual((step['kind'], step['piece'], step['enemies'], step['skill']),
                         ('capture', drill['drill']['piece'], 3, 'hanging-piece'))


class HomeTests(unittest.TestCase):
    def test_the_briefing_names_the_focus_and_the_session(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            write_game(data)
            home = coach_home.home(data, 'en', NOW)
            lines = coach_lessons.Lines('en')
            self.assertEqual(home['focus'][0]['skill'], 'mate-in-one')
            self.assertIn(lines.t('briefing.focus', skill=lines.skill('mate-in-one')), home['briefing'])
            self.assertEqual(home['session']['skill'], 'mate-in-one')
            self.assertEqual(home['games'][0]['slug'], 'game-1')
            coach_home.act(data, {'action': 'skip', 'skill': 'mate-in-one'}, NOW)
            self.assertNotIn('mate-in-one', [f['skill'] for f in coach_home.home(data, 'en', NOW)['focus']])

    def test_without_games_rooky_asks_for_some(self):
        with tempfile.TemporaryDirectory() as folder:
            home = coach_home.home(Path(folder), 'en', NOW)
            self.assertFalse(home['hasGames'])
            self.assertEqual(home['briefing'][-1], coach_lessons.Lines('en').t('briefing.noGames'))


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import threading
        from http.server import ThreadingHTTPServer
        from torre.server import studio
        cls.tmp = tempfile.TemporaryDirectory()
        studio.use_data_dir(cls.tmp.name)
        write_game(Path(cls.tmp.name))
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), studio.Handler)
        cls.base = f'http://127.0.0.1:{cls.server.server_address[1]}'
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def get(self, path):
        from urllib.request import urlopen
        with urlopen(self.base + path) as response:
            return json.loads(response.read())

    def post(self, path, body):
        from urllib.request import Request, urlopen
        request = Request(self.base + path, json.dumps(body).encode(), {'Content-Type': 'application/json', 'X-Chess-Studio': '1'})
        with urlopen(request) as response:
            return json.loads(response.read())

    def test_a_game_lesson_plays_through_the_lesson_api(self):
        coach = self.get('/api/games/1/coach')
        self.assertEqual(coach['lesson'], 'game-1')
        lesson = self.get('/api/lessons/game-1')
        self.assertEqual(lesson['coach']['game'], '1')
        find = next(s for s in lesson['steps'] if s['kind'] == 'play')
        result = self.post(f"/api/lessons/game-1/steps/{find['id']}", {'firstTry': True})
        self.assertEqual(result['xpGained'], 10)
        self.post('/api/lessons/progress', {'slug': 'game-1', 'step': len(lesson['steps'])})
        self.assertTrue(self.get('/api/lessons/game-1')['completed'])
        self.assertNotIn('game-1', [l['slug'] for l in self.get('/api/lessons')['lessons']])

    def test_home_focus_and_sessions(self):
        from urllib.error import HTTPError
        home = self.get('/api/coach/home')
        skill = home['focus'][0]['skill']
        slug = self.post('/api/coach/session', {'skill': skill})['slug']
        self.assertTrue(slug.startswith('session-'))
        self.assertEqual(self.get(f'/api/lessons/{slug}')['coach']['skill'], skill)
        after = self.post('/api/coach/focus', {'action': 'skip', 'skill': skill})
        self.assertNotIn(skill, [f['skill'] for f in after['focus']])
        with self.assertRaises(HTTPError) as bad:
            self.post('/api/coach/focus', {'action': 'shout', 'skill': skill})
        self.assertEqual(bad.exception.code, 400)


if __name__ == '__main__':
    unittest.main()
