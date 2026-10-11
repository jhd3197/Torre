"""Step ledger, XP and stars checks: .venv/Scripts/python -m unittest test_story -v"""
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from torre.learning import lessons
from torre.learning import story
NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)
LATER = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
FORK = "2q3k1/5ppp/8/3N4/8/8/5PPP/6K1 w - - 0 1"


def lesson(**extra):
    return {"version": 1, "title": "Fork", "summary": "Forks.", "category": "tactics", "level": "beginner", "minutes": 3,
            "steps": [{"id": "idea", "kind": "explain", "fen": FORK, "text": "A fork."},
                      {"id": "fork", "kind": "play", "fen": FORK, "prompt": "Fork.", "line": ["d5e7", "g8f8", "e7c8"]},
                      {"id": "spot", "kind": "choose", "question": "?", "options": [{"text": "a", "correct": True}, {"text": "b"}]}],
            **extra}


def fixture():
    return lessons.parse(lesson(), "fork")


class LevelTests(unittest.TestCase):
    def test_level_curve_costs_100_more_each_level(self):
        for xp, expected in ((0, 1), (99, 1), (100, 2), (299, 2), (300, 3), (599, 3), (600, 4), (1000, 5)):
            with self.subTest(xp=xp):
                self.assertEqual(story.level(xp), expected)

    def test_profile_view_splits_xp_into_level_progress(self):
        empty = story.profile_view({"xp": 0}, NOW)
        self.assertEqual(empty, {"xp": 0, "level": 1, "xpIntoLevel": 0, "xpForLevel": 100,
                                 "streak": {"count": 0, "doneToday": False, "goal": 30, "xpToday": 0, "freezes": 0}})
        view = story.profile_view({"xp": 130, "streak": {"count": 3, "lastActiveDate": "2026-10-03"},
                                   "history": {"2026-10-03": {"xp": 45}}}, NOW)
        self.assertEqual((view["xp"], view["level"], view["xpIntoLevel"], view["xpForLevel"]), (130, 2, 30, 200))
        self.assertEqual(view["streak"], {"count": 3, "doneToday": True, "goal": 30, "xpToday": 45, "freezes": 0})


class AwardXpTests(unittest.TestCase):
    """Streak math and the per-day history behind the daily goal (30 XP)."""
    def setUp(self):
        self.profile = {"xp": 0}

    def test_history_accumulates_per_day(self):
        story.award_xp(self.profile, 10, NOW)
        story.award_xp(self.profile, 5, NOW)
        story.award_xp(self.profile, 5, LATER)
        self.assertEqual(self.profile["xp"], 20)
        self.assertEqual(self.profile["history"], {"2026-10-03": {"xp": 15}, "2026-10-04": {"xp": 5}})

    def test_below_the_goal_no_streak(self):
        story.award_xp(self.profile, 10, NOW)
        story.award_xp(self.profile, 19, NOW)
        self.assertEqual(self.profile["streak"], {"count": 0, "lastActiveDate": None})

    def test_reaching_the_goal_starts_the_streak_once_per_day(self):
        story.award_xp(self.profile, 20, NOW)
        story.award_xp(self.profile, 20, NOW)  # crosses the goal on the same day
        self.assertEqual(self.profile["streak"], {"count": 1, "lastActiveDate": "2026-10-03"})
        story.award_xp(self.profile, 50, NOW)  # more XP the same day changes nothing
        self.assertEqual(self.profile["streak"], {"count": 1, "lastActiveDate": "2026-10-03"})

    def test_consecutive_days_extend_the_streak(self):
        story.award_xp(self.profile, 30, NOW)
        story.award_xp(self.profile, 30, LATER)
        self.assertEqual(self.profile["streak"], {"count": 2, "lastActiveDate": "2026-10-04"})

    def test_a_gap_resets_the_streak(self):
        story.award_xp(self.profile, 30, NOW)
        story.award_xp(self.profile, 30, NOW + timedelta(days=3))
        self.assertEqual(self.profile["streak"], {"count": 1, "lastActiveDate": "2026-10-06"})

    def test_a_week_earns_a_freeze_that_covers_a_missed_day(self):
        for day in range(7):
            story.award_xp(self.profile, 30, NOW + timedelta(days=day))
        self.assertEqual(self.profile["streak"], {"count": 7, "lastActiveDate": "2026-10-09", "freezes": 1})
        # One day missed: still alive, and the next goal spends the freeze to carry it on.
        self.assertEqual(story.live_streak(self.profile["streak"], (NOW + timedelta(days=8)).date()), 7)
        story.award_xp(self.profile, 30, NOW + timedelta(days=8))
        self.assertEqual(self.profile["streak"], {"count": 8, "lastActiveDate": "2026-10-11"})

    def test_freezes_are_capped_and_a_longer_gap_still_ends_the_streak(self):
        for day in range(21):
            story.award_xp(self.profile, 30, NOW + timedelta(days=day))
        self.assertEqual(self.profile["streak"]["freezes"], story.MAX_FREEZES)
        last = NOW + timedelta(days=20)
        self.assertEqual(story.live_streak(self.profile["streak"], (last + timedelta(days=3)).date()), 21)
        self.assertEqual(story.live_streak(self.profile["streak"], (last + timedelta(days=4)).date()), 0)

    def test_the_view_shows_a_broken_streak_as_zero_before_the_next_award(self):
        story.award_xp(self.profile, 30, NOW)
        self.assertEqual(story.profile_view(self.profile, NOW + timedelta(days=1))["streak"]["count"], 1)
        self.assertEqual(story.profile_view(self.profile, NOW + timedelta(days=2))["streak"]["count"], 0)

    def test_a_day_below_the_goal_does_not_extend(self):
        story.award_xp(self.profile, 30, NOW)
        story.award_xp(self.profile, 29, LATER)
        self.assertEqual(self.profile["streak"], {"count": 1, "lastActiveDate": "2026-10-03"})
        story.award_xp(self.profile, 1, LATER)  # reaching the goal later that day still counts
        self.assertEqual(self.profile["streak"], {"count": 2, "lastActiveDate": "2026-10-04"})

    def test_bad_amounts_are_refused(self):
        for amount in (0, -5, 1.5, "10", True):
            with self.subTest(amount=amount), self.assertRaises(ValueError):
                story.award_xp(self.profile, amount, NOW)
        self.assertEqual(self.profile, {"xp": 0})


class RecordStepTests(unittest.TestCase):
    def setUp(self):
        self.item = fixture()
        self.play = self.item["steps"][1]
        self.story = {"steps": {}}
        self.profile = {"xp": 0}

    def record(self, step=None, **run):
        run.setdefault("firstTry", True)
        return story.record_step(self.item, step or self.play, self.story, self.profile, run, NOW)

    def test_first_completion_pays_xp_once(self):
        self.assertEqual(self.record(), {"ok": True, "xpGained": 10, "xp": 10, "level": 1})
        again = self.record(firstTry=False, hintsUsed=1)
        self.assertEqual((again["xpGained"], again["xp"]), (0, 10))

    def test_a_better_run_replaces_the_entry_but_keeps_the_first_date(self):
        self.record(firstTry=False, hintsUsed=2, revealsUsed=1, attempts=3)
        self.record(firstTry=True, hintsUsed=0, revealsUsed=0, attempts=1)
        # An equal run later changes nothing, and the date stays the first one.
        story.record_step(self.item, self.play, self.story, self.profile,
                          {"firstTry": True, "hintsUsed": 0, "revealsUsed": 0, "attempts": 2}, LATER)
        entry = self.story["steps"]["fork/fork"]
        self.assertEqual(entry, {"firstTry": True, "hintsUsed": 0, "revealsUsed": 0, "attempts": 1,
                                 "completedAt": NOW.isoformat()})

    def test_worse_and_equal_runs_do_not_replace_the_entry(self):
        self.record(firstTry=True, hintsUsed=1, revealsUsed=0, attempts=2)
        for run in ({"firstTry": True, "hintsUsed": 1, "revealsUsed": 0, "attempts": 9},  # a tie keeps the old run
                    {"firstTry": True, "hintsUsed": 2, "revealsUsed": 0, "attempts": 1},  # more hints
                    {"firstTry": False, "hintsUsed": 1, "revealsUsed": 0, "attempts": 1},  # not first try
                    {"firstTry": True, "hintsUsed": 0, "revealsUsed": 1, "attempts": 1}):  # a reveal trumps hints
            with self.subTest(run=run):
                story.record_step(self.item, self.play, self.story, self.profile, run, LATER)
                self.assertEqual(self.story["steps"]["fork/fork"]["attempts"], 2)

    def test_reveal_beats_hints_hints_beat_first_try_ordering(self):
        self.record(firstTry=True, hintsUsed=3, revealsUsed=0, attempts=1)
        # Fewer hints wins even without firstTry.
        story.record_step(self.item, self.play, self.story, self.profile,
                          {"firstTry": False, "hintsUsed": 1, "revealsUsed": 0, "attempts": 4}, LATER)
        self.assertFalse(self.story["steps"]["fork/fork"]["firstTry"])
        # But any reveal loses to a reveal-free run.
        story.record_step(self.item, self.play, self.story, self.profile,
                          {"firstTry": True, "hintsUsed": 0, "revealsUsed": 1, "attempts": 1}, LATER)
        self.assertEqual(self.story["steps"]["fork/fork"]["revealsUsed"], 0)

    def test_unscored_kinds_are_refused(self):
        with self.assertRaisesRegex(ValueError, "not scored"):
            story.record_step(self.item, self.item["steps"][0], self.story, self.profile, {"firstTry": True}, NOW)
        self.assertEqual(self.story["steps"], {})

    def test_bad_bodies_are_refused(self):
        bad = [{}, {"firstTry": "yes"}, {"firstTry": True, "hintsUsed": -1}, {"firstTry": True, "revealsUsed": 1.5},
               {"firstTry": True, "attempts": True}]
        for run in bad:
            with self.subTest(run=run), self.assertRaises(ValueError):
                story.record_step(self.item, self.play, self.story, self.profile, run, NOW)
        self.assertEqual(self.story["steps"], {})


class StarsTests(unittest.TestCase):
    def setUp(self):
        self.item = fixture()
        self.story = {"steps": {}}
        self.profile = {"xp": 0}

    def record(self, step_id, **run):
        run.setdefault("firstTry", True)
        step = next(s for s in self.item["steps"] if s["id"] == step_id)
        story.record_step(self.item, step, self.story, self.profile, run, NOW)

    def test_not_completed_is_zero_stars(self):
        self.record("fork")
        self.assertEqual(story.stars(self.item, self.story, None), 0)

    def test_legacy_completion_without_entries_is_one_star(self):
        self.assertEqual(story.stars(self.item, self.story, NOW.isoformat()), 1)

    def test_three_stars_needs_every_scored_step_clean(self):
        self.record("fork")
        self.assertEqual(story.stars(self.item, self.story, NOW.isoformat()), 2)  # "spot" has no entry
        self.record("spot")
        self.assertEqual(story.stars(self.item, self.story, NOW.isoformat()), 3)

    def test_hints_cost_a_star_reveals_cost_two(self):
        self.record("fork")
        self.record("spot", hintsUsed=1, firstTry=False)
        self.assertEqual(story.stars(self.item, self.story, NOW.isoformat()), 2)
        self.record("spot", hintsUsed=1, revealsUsed=1, firstTry=False)  # worse run: not kept
        self.assertEqual(story.stars(self.item, self.story, NOW.isoformat()), 2)
        self.story["steps"]["fork/spot"]["revealsUsed"] = 1
        self.assertEqual(story.stars(self.item, self.story, NOW.isoformat()), 1)

    def test_step_results_only_covers_scored_steps_with_entries(self):
        self.record("fork")
        results = story.step_results(self.item, self.story)
        self.assertEqual(list(results), ["fork"])
        self.assertEqual(results["fork"]["completedAt"], NOW.isoformat())


class StorageTests(unittest.TestCase):
    def test_round_trip_and_defaults(self):
        with tempfile.TemporaryDirectory() as tmp:
            story_path, profile_path = Path(tmp) / "story.json", Path(tmp) / "profile.json"
            blank = {"xp": 0, "streak": {"count": 0, "lastActiveDate": None}, "history": {}}
            self.assertEqual(story.load(story_path), {"steps": {}})
            self.assertEqual(story.load_profile(profile_path), blank)
            story.save(story_path, {"steps": {"a/b": {"firstTry": True}}})
            story.save_profile(profile_path, {"xp": 130, "streak": {"count": 2, "lastActiveDate": "2026-10-02"},
                                              "history": {"2026-10-02": {"xp": 35}}})
            self.assertEqual(story.load(story_path)["steps"]["a/b"]["firstTry"], True)
            loaded = story.load_profile(profile_path)
            self.assertEqual((loaded["xp"], loaded["streak"]["count"], loaded["history"]["2026-10-02"]["xp"]), (130, 2, 35))
            profile_path.write_text('{"xp": "lots", "streak": "fire"}', encoding="utf-8")
            self.assertEqual(story.load_profile(profile_path), blank)


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import threading
        from http.server import ThreadingHTTPServer
        from torre.server import studio
        cls.tmp = tempfile.TemporaryDirectory()
        studio.use_data_dir(cls.tmp.name)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), studio.Handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
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
        request = Request(self.base + path, json.dumps(body).encode(), {"Content-Type": "application/json", "X-Chess-Studio": "1"})
        with urlopen(request) as response:
            return json.loads(response.read())

    def test_step_results_xp_profile_and_stars(self):
        from urllib.error import HTTPError
        profile = self.get("/api/profile")
        self.assertEqual(profile, {"xp": 0, "level": 1, "xpIntoLevel": 0, "xpForLevel": 100,
                                   "streak": {"count": 0, "doneToday": False, "goal": 30, "xpToday": 0, "freezes": 0}})
        fork = self.get("/api/lessons/knight-fork")
        self.assertEqual((fork["stepResults"], fork["stars"]), ({}, 0))
        result = self.post("/api/lessons/knight-fork/steps/win-the-queen",
                           {"firstTry": True, "hintsUsed": 0, "revealsUsed": 0, "attempts": 1})
        self.assertEqual(result, {"ok": True, "xpGained": 10, "xp": 10, "level": 1})
        profile = self.get("/api/profile")
        # Ten XP is below the daily goal: it counts for today but starts no streak.
        self.assertEqual(profile["streak"], {"count": 0, "doneToday": False, "goal": 30, "xpToday": 10, "freezes": 0})
        again = self.post("/api/lessons/knight-fork/steps/win-the-queen",
                          {"firstTry": False, "hintsUsed": 2, "revealsUsed": 0, "attempts": 3})
        self.assertEqual(again["xpGained"], 0)  # XP is paid once; the worse run is not kept
        fork = self.get("/api/lessons/knight-fork")
        self.assertEqual(fork["stepResults"]["win-the-queen"]["firstTry"], True)
        # Finishing the lesson the old way turns completion into stars.
        self.post("/api/lessons/progress", {"slug": "knight-fork", "step": len(fork["steps"])})
        self.assertEqual(self.get("/api/lessons/knight-fork")["stars"], 2)
        with self.assertRaises(HTTPError) as explain:
            self.post("/api/lessons/knight-fork/steps/how-a-knight-attacks", {"firstTry": True})
        self.assertEqual(explain.exception.code, 400)
        for path in ("/api/lessons/nope/steps/win-the-queen", "/api/lessons/knight-fork/steps/nope"):
            with self.subTest(path), self.assertRaises(HTTPError) as missing:
                self.post(path, {"firstTry": True})
            self.assertEqual(missing.exception.code, 404)
        with self.assertRaises(HTTPError) as bad:
            self.post("/api/lessons/knight-fork/steps/win-the-queen", {"firstTry": "sure"})
        self.assertEqual(bad.exception.code, 400)

    def test_steps_enqueue_lesson_review_cards(self):
        # Runs after test_step_results..., which queued the knight-fork card.
        self.assertEqual(self.get("/api/drills")["total"], 1)
        clean = {"firstTry": True, "hintsUsed": 0, "revealsUsed": 0, "attempts": 1}
        self.post("/api/lessons/scholars-mate/steps/spot-the-mate", clean)
        info = self.get("/api/drills")
        self.assertEqual((info["total"], info["new_total"]), (2, 2))
        # The knight-fork card was queued first; it carries its source and lesson for the label.
        card = info["card"]
        self.assertEqual(card["id"], "lesson:knight-fork/win-the-queen")
        self.assertEqual((card["source"], card["lesson"], card["lesson_title"], card["step"]),
                         ("lesson", "knight-fork", "The knight fork", "win-the-queen"))
        self.assertNotIn("best", card)
        # A choose step is not a position, and repeating a play step pays no second card.
        self.post("/api/lessons/scholars-mate/steps/quiz", clean)
        self.post("/api/lessons/scholars-mate/steps/spot-the-mate", {**clean, "attempts": 2})
        self.assertEqual(self.get("/api/drills")["new_total"], 2)

    def test_legacy_completion_gets_one_star(self):
        lesson = self.get("/api/lessons/scholars-mate")
        self.post("/api/lessons/progress", {"slug": "scholars-mate", "step": len(lesson["steps"])})
        self.assertEqual(self.get("/api/lessons/scholars-mate")["stars"], 1)


if __name__ == "__main__":
    unittest.main()
