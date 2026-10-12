"""Lesson format and progress checks: .venv/Scripts/python -m unittest test_lessons -v"""
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import chess

from torre.learning import lessons
NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)
FORK = "2q3k1/5ppp/8/3N4/8/8/5PPP/6K1 w - - 0 1"


def lesson(**extra):
    return {"version": 1, "title": "Fork", "summary": "Forks.", "category": "tactics", "level": "beginner", "minutes": 3,
            "steps": [{"id": "fork", "kind": "play", "fen": FORK, "prompt": "Fork.", "line": ["d5e7", "g8f8", "e7c8"]}],
            **extra}


class BundledLessonTests(unittest.TestCase):
    def test_every_bundled_lesson_loads(self):
        loaded, problems = lessons.load_all()
        self.assertEqual(problems, [])
        self.assertGreaterEqual(len(loaded), 6)
        for slug, item in loaded.items():
            with self.subTest(slug=slug):
                self.assertTrue(all(step["kind"] in lessons.KINDS for step in item["steps"]))

    def test_catalog_is_ordered_by_category_then_level_then_unit(self):
        loaded, _ = lessons.load_all()
        units = lessons.load_units(lessons.LESSONS_DIR)
        rank = lambda l: units.get(l["category"], []).index(l["unit"]) if l["unit"] in units.get(l["category"], []) else 99
        order = [(lessons.CATEGORIES.index(l["category"]), l["unit"] is not None, rank(l), l["unit"] or "", l["order"])
                 for l in loaded.values()]
        self.assertEqual(order, sorted(order))
        history = [l["unit"] for l in loaded.values() if l["category"] == "history"]
        self.assertLess(history.index("Paul Morphy"), history.index("Magnus Carlsen"))

    def test_units_file_names_only_real_units(self):
        loaded, _ = lessons.load_all()
        real = {(l["category"], l["unit"]) for l in loaded.values()}
        for category, names in lessons.load_units(lessons.LESSONS_DIR).items():
            for name in names:
                self.assertIn((category, name), real)

    def test_lesson_wording_has_no_em_dashes(self):
        # Em dashes read as machine-written; lessons use commas, colons and full stops (lessons/README.md).
        def strings(node):
            if isinstance(node, str):
                yield node
            elif isinstance(node, dict):
                for value in node.values():
                    yield from strings(value)
            elif isinstance(node, list):
                for value in node:
                    yield from strings(value)
        for path in sorted(lessons.LESSONS_DIR.glob("*.json")):
            with self.subTest(lesson=path.stem):
                dashed = [text for text in strings(json.loads(path.read_text(encoding="utf-8"))) if "—" in text]
                self.assertEqual(dashed, [])

    def test_practice_links_name_real_puzzle_themes(self):
        from torre.learning import puzzles
        loaded, _ = lessons.load_all()
        for slug, item in loaded.items():
            if item["practice"]:
                with self.subTest(slug=slug):
                    self.assertIn(item["practice"], puzzles.THEMES)


class ParseTests(unittest.TestCase):
    def test_play_step_gets_sans_and_mate(self):
        step = lessons.parse(lesson(), "fork")["steps"][0]
        self.assertEqual([m["san"] for m in step["moves"]], ["Ne7+", "Kf8", "Nxc8"])
        self.assertFalse(step["mate"])
        mate = lessons.parse(lesson(steps=[{"id": "m", "kind": "play", "fen": "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1",
                                            "prompt": "Mate.", "line": ["d1d8"]}]), "m")["steps"][0]
        self.assertTrue(mate["mate"])

    def test_reel_step_gets_sans_and_sorted_notes(self):
        step = lessons.parse(lesson(category="history", steps=[{"id": "g", "kind": "reel", "text": "A game.",
            "moves": ["e2e4", "e7e5", "g1f3"], "notes": [{"ply": 3, "text": "later"}, {"ply": 1, "text": "sooner"}]}]), "g")["steps"][0]
        self.assertEqual(step["fen"], chess.STARTING_FEN)
        self.assertEqual([m["san"] for m in step["moves"]], ["e4", "e5", "Nf3"])
        self.assertEqual([n["text"] for n in step["notes"]], ["sooner", "later"])

    def test_guess_step_stops_at_sorted_plies_with_alternatives(self):
        step = lessons.parse(lesson(category="history", steps=[{"id": "g", "kind": "guess", "text": "Guess.",
            "moves": ["e2e4", "e7e5", "g1f3", "b8c6"],
            "guesses": [{"ply": 3, "prompt": "Develop.", "also": ["b1c3"], "why": "Knights first."},
                        {"ply": 1, "prompt": "Open."}]}]), "g")["steps"][0]
        self.assertEqual([g["ply"] for g in step["guesses"]], [1, 3])
        self.assertEqual(step["guesses"][1]["also"], [{"uci": "b1c3", "san": "Nc3"}])
        self.assertIsNone(step["guesses"][0]["hint"])
        bad = {"no stops": [], "ply past the end": [{"ply": 9, "prompt": "x"}], "repeat": [{"ply": 1, "prompt": "x"}, {"ply": 1, "prompt": "y"}],
               "illegal also": [{"ply": 1, "prompt": "x", "also": ["e2e5"]}]}
        for name, guesses in bad.items():
            with self.subTest(name), self.assertRaises(lessons.LessonError):
                lessons.parse(lesson(steps=[{"id": "g", "kind": "guess", "text": "x", "moves": ["e2e4"], "guesses": guesses}]), "g")

    def test_unit_order_and_practice_fields(self):
        parsed = lessons.parse(lesson(unit="Paul Morphy", order=2, practice="fork"), "fork")
        self.assertEqual((parsed["unit"], parsed["order"], parsed["practice"]), ("Paul Morphy", 2, "fork"))
        self.assertIsNone(lessons.parse(lesson(), "fork")["unit"])
        for extra in ({"unit": ""}, {"order": "2"}, {"practice": "Fork Puzzles"}):
            with self.subTest(extra), self.assertRaises(lessons.LessonError):
                lessons.parse(lesson(**extra), "fork")

    def test_youtube_id_accepts_links_and_bare_ids(self):
        for link in ("dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s",
                     "https://youtube.com/shorts/dQw4w9WgXcQ?feature=share", " https://www.youtube.com/embed/dQw4w9WgXcQ "):
            self.assertEqual(lessons.youtube_id(link), "dQw4w9WgXcQ", link)
        for link in ("", "short", "https://vimeo.com/dQw4w9WgXcQ", None):
            self.assertIsNone(lessons.youtube_id(link), link)

    def test_videos_file_links_lessons_review_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "lessons"
            folder.mkdir()
            (folder / "fork.json").write_text(json.dumps(lesson()), encoding="utf-8")
            (folder / "pin.json").write_text(json.dumps(lesson()), encoding="utf-8")
            videos = Path(tmp) / "videos.json"
            videos.write_text(json.dumps({"videos": [
                {"id": "fork-short", "kind": "short", "lesson": "fork", "youtube": "https://youtube.com/shorts/aaaaaaaaaaa"},
                {"id": "fork-review", "kind": "review", "lesson": "fork", "youtube": "https://youtu.be/bbbbbbbbbbb"},
                {"id": "pin-review", "kind": "review", "lesson": "pin", "youtube": ""},
                {"id": "lost", "kind": "short", "lesson": "nowhere", "youtube": ""},
                {"id": "typo", "kind": "short", "lesson": "pin", "youtube": "not a link"}]}), encoding="utf-8")
            loaded, problems = lessons.load_all(folder, videos)
        self.assertEqual(loaded["fork"]["video"], {"youtube": "bbbbbbbbbbb"})
        self.assertIsNone(loaded["pin"]["video"])
        self.assertEqual(problems, ['video lost: unknown lesson "nowhere".', 'video typo: "not a link" is not a YouTube link.'])
        self.assertEqual(lessons.catalog(loaded, [], {"lessons": {}})["lessons"][0]["video"], {"youtube": "bbbbbbbbbbb"})

    def test_bundled_videos_name_real_lessons(self):
        _, problems = lessons.load_all()
        self.assertEqual([p for p in problems if p.startswith("video")], [])

    def test_explain_narration_move_cues_fit_the_demo(self):
        def explain(narration):
            return lesson(steps=[{"id": "e", "kind": "explain", "fen": FORK, "text": "x", "demo": ["d5e7", "g8f8"],
                                  "narration": narration}])
        parsed = lessons.parse(explain("The knight jumps. [move] The king steps aside. [move]"), "e")
        self.assertEqual(parsed["steps"][0]["narration"].count(lessons.MOVE_CUE), 2)
        with self.assertRaisesRegex(lessons.LessonError, "3 \[move\] cues"):
            lessons.parse(explain("One. [move] Two. [move] Three. [move]"), "e")

    def test_alternatives_only_on_the_last_move(self):
        alt = lessons.parse(lesson(steps=[{"id": "a", "kind": "play", "fen": FORK, "prompt": "x", "line": ["d5e7|d5c7"]}]), "a")
        self.assertEqual(alt["steps"][0]["alternatives"], [{"uci": "d5c7", "san": "Nc7"}])
        with self.assertRaisesRegex(lessons.LessonError, "only the last move"):
            lessons.parse(lesson(steps=[{"id": "a", "kind": "play", "fen": FORK, "prompt": "x", "line": ["d5e7|d5c7", "g8f8", "e7c8"]}]), "a")

    def test_branches_give_the_opponent_other_replies(self):
        step = lessons.parse(lesson(steps=[{"id": "b", "kind": "play", "fen": FORK, "prompt": "x", "nudge": "Look for a fork.",
            "hint": "Knight to e7.", "line": ["d5e7", "g8f8", "e7c8"],
            "branches": [{"line": ["d5e7", "g8h8", "e7c8"], "success": "The king hid in the corner, the queen still fell."}]}]), "b")["steps"][0]
        self.assertEqual(step["nudge"], "Look for a fork.")
        self.assertEqual([m["san"] for m in step["moves"]], ["Ne7+", "Kf8", "Nxc8"])
        self.assertEqual(len(step["branches"]), 1)
        self.assertEqual([m["san"] for m in step["branches"][0]["moves"]], ["Ne7+", "Kh8", "Nxc8"])
        self.assertIn("corner", step["branches"][0]["success"])
        self.assertEqual(lessons.parse(lesson(), "fork")["steps"][0]["branches"], [])
        bad = {"is not legal": [{"line": ["d5e7", "g8g7", "e7c8"]}], "already in the step": [{"line": ["d5e7", "g8f8", "e7c8"]}],
               "odd-length": [{"line": ["d5e7", "g8h8"]}], "must be an object": [["d5e7", "g8h8", "e7c8"]]}
        for message, branches in bad.items():
            with self.subTest(message), self.assertRaisesRegex(lessons.LessonError, message):
                lessons.parse(lesson(steps=[{"id": "b", "kind": "play", "fen": FORK, "prompt": "x", "line": ["d5e7", "g8f8", "e7c8"],
                                             "branches": branches}]), "b")

    def test_branch_text_takes_a_translation(self):
        raw = lesson(steps=[{"id": "b", "kind": "play", "fen": FORK, "prompt": "x", "nudge": "Fork.", "line": ["d5e7", "g8f8", "e7c8"],
                             "branches": [{"line": ["d5e7", "g8h8", "e7c8"], "success": "Corner."}]}])
        lessons._merge_text(raw, {"steps": [{"id": "b", "nudge": "Horquilla.", "branches": [{"success": "Esquina."}]}]})
        self.assertEqual((raw["steps"][0]["nudge"], raw["steps"][0]["branches"][0]["success"]), ("Horquilla.", "Esquina."))

    def test_a_drill_is_a_recipe_with_defaults(self):
        item = lessons.parse(lesson(steps=[
            {"id": "watch", "kind": "stars", "piece": "R", "watch": True, "narration": "Watch me."},
            {"id": "reach", "kind": "reach", "piece": "N", "blockers": 6, "distance": 3, "prompt": "Jump to the flag."},
            {"id": "take", "kind": "capture", "piece": "Q"},
            {"id": "count", "kind": "count", "piece": "B", "enemies": 0},
        ]), "drills")
        watch, reach, take, count = item["steps"]
        self.assertEqual(watch, {"id": "watch", "kind": "stars", "title": None, "orientation": "white", "piece": "R",
                                 "stars": 3, "blockers": 0, "watch": True, "narration": "Watch me.", "scored": False})
        self.assertEqual((reach["blockers"], reach["distance"], reach["prompt"]), (6, 3, "Jump to the flag."))
        self.assertEqual((take["enemies"], take["blockers"]), (3, 1))
        self.assertEqual((count["blockers"], count["enemies"]), (1, 0))
        # Answered kinds are scored, a watched drill is not: the page reads the flag.
        self.assertEqual([s["scored"] for s in item["steps"]], [False, True, True, True])

    def test_card_choose_boards_and_rules(self):
        item = lessons.parse(lesson(rules=[{"id": "check", "title": "Check.", "text": "The king is attacked.", "icon": "k"}], steps=[
            {"id": "card", "kind": "card", "fen": FORK, "text": "Check means the king is attacked.", "rule": "check",
             "points": [{"icon": "k", "label": "Move"}, {"icon": "✕", "label": "Capture"}], "highlight": ["g8"]},
            {"id": "pick", "kind": "choose", "question": "Which is mate?", "reveal": [["e8"]], "options": [
                {"text": "A", "fen": FORK, "correct": True}, {"text": "B", "fen": FORK}]},
        ]), "cards")
        card, pick = item["steps"]
        self.assertEqual(item["rules"], [{"id": "check", "title": "Check.", "text": "The king is attacked.", "icon": "k"}])
        self.assertEqual((card["kind"], card["scored"], card["rule"], card["highlight"]), ("card", False, "check", ["g8"]))
        self.assertEqual(card["points"][1], {"icon": "✕", "label": "Capture"})
        self.assertEqual(pick["reveal"], [{"from": "e8", "to": "e8"}])
        self.assertEqual(pick["options"][0]["fen"], chess.Board(FORK).fen())

    def test_problems_are_reported_not_raised(self):
        cases = {
            "unknown kind": {"id": "x", "kind": "video", "fen": FORK},
            "is not legal": {"id": "x", "kind": "play", "fen": FORK, "prompt": "x", "line": ["d5d7"]},
            "odd-length": {"id": "x", "kind": "play", "fen": FORK, "prompt": "x", "line": ["d5e7", "g8f8"]},
            "not a valid chess position": {"id": "x", "kind": "explain", "fen": "8/8/8/8/8/8/8/8 w - - 0 1", "text": "x"},
            "exactly one option": {"id": "x", "kind": "choose", "question": "?", "options": [{"text": "a"}, {"text": "b"}]},
            '"text" must be': {"id": "x", "kind": "explain", "fen": FORK},
            "non-empty list of UCI": {"id": "x", "kind": "reel", "text": "x", "moves": []},
            "not legal after e4": {"id": "x", "kind": "reel", "text": "x", "moves": ["e2e4", "e2e5"]},
            "a move number from 1 to 1": {"id": "x", "kind": "reel", "text": "x", "moves": ["e2e4"], "notes": [{"ply": 2, "text": "x"}]},
            '"piece" must be one of': {"id": "x", "kind": "stars", "piece": "P"},
            '"stars" must be a whole number from 1 to 5': {"id": "x", "kind": "stars", "piece": "R", "stars": 9},
            '"distance" must be a whole number from 2 to 4': {"id": "x", "kind": "reach", "piece": "N", "distance": 1},
            "only a stars step can be watched": {"id": "x", "kind": "reach", "piece": "R", "watch": True},
            "every option a \"fen\", or none": {"id": "x", "kind": "choose", "question": "?",
                                                 "options": [{"text": "a", "fen": FORK, "correct": True}, {"text": "b"}]},
            "needs an \"icon\"": {"id": "x", "kind": "card", "text": "x", "points": [{"label": "Move"}]},
            "one of the lesson's \"rules\"": {"id": "x", "kind": "explain", "fen": FORK, "text": "x", "rule": "nope"},
        }
        for message, step in cases.items():
            with self.subTest(message=message), tempfile.TemporaryDirectory() as tmp:
                Path(tmp, "bad.json").write_text(json.dumps(lesson(steps=[step])), encoding="utf-8")
                Path(tmp, "good.json").write_text(json.dumps(lesson()), encoding="utf-8")
                loaded, problems = lessons.load_all(tmp)
                self.assertEqual(list(loaded), ["good"])
                self.assertEqual(len(problems), 1)
                self.assertIn(message, problems[0])

    def test_unknown_prerequisites_are_dropped_and_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "a.json").write_text(json.dumps(lesson(requires=["missing"])), encoding="utf-8")
            loaded, problems = lessons.load_all(tmp)
        self.assertEqual(loaded["a"]["requires"], [])
        self.assertIn("missing", problems[0])


class ProgressTests(unittest.TestCase):
    def test_progress_and_completion(self):
        loaded = {"fork": lessons.parse(lesson(steps=lesson()["steps"] + [
            {"id": "end", "kind": "choose", "question": "?", "options": [{"text": "a", "correct": True}, {"text": "b"}]}]), "fork")}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lessons.json"
            state = lessons.load_state(path)
            self.assertEqual(lessons.catalog(loaded, [], state)["lessons"][0]["step"], 0)
            lessons.record(loaded, state, "fork", 1, NOW)
            self.assertIsNone(state["lessons"]["fork"]["completed"])
            lessons.record(loaded, state, "fork", 2, NOW)
            lessons.save_state(path, state)
            card = lessons.catalog(loaded, [], lessons.load_state(path))["lessons"][0]
            self.assertEqual((card["step"], card["steps"], card["completed"]), (2, 2, NOW.isoformat()))
            # Restarting keeps the completion date.
            lessons.record(loaded, state, "fork", 0, NOW)
            self.assertEqual(state["lessons"]["fork"]["completed"], NOW.isoformat())
            for bad in (-1, 3, "1", True):
                with self.subTest(step=bad), self.assertRaises(ValueError):
                    lessons.record(loaded, state, "fork", bad, NOW)
            with self.assertRaises(ValueError):
                lessons.record(loaded, state, "nope", 0, NOW)


class PositionTests(unittest.TestCase):
    def test_progress_follows_the_step_id_when_steps_move(self):
        steps = [{"id": i} for i in ("a", "b", "c")]
        state = {"lessons": {}}
        entry = lessons.record({"x": {"steps": steps}}, state, "x", 1, NOW)
        self.assertEqual(entry["at"], "b")
        # A step is added in front: the reader is still on "b".
        self.assertEqual(lessons.position({"steps": [{"id": "new"}, *steps]}, entry), 2)
        # "b" was removed: fall back to the saved index.
        self.assertEqual(lessons.position({"steps": [steps[0], steps[2]]}, entry), 1)
        finished = lessons.record({"x": {"steps": steps}}, state, "x", 3, NOW)
        self.assertEqual(lessons.position({"steps": [*steps, {"id": "d"}]}, finished), 4)
        # Progress saved before ids were kept uses its index.
        self.assertEqual(lessons.position({"steps": steps}, {"step": 2}), 2)


class SkipTests(unittest.TestCase):
    def test_a_known_lesson_is_done_without_stars_until_it_is_taken(self):
        loaded = {"fork": lessons.parse(lesson(), "fork")}
        state = {"lessons": {}}
        entry = lessons.skip(loaded, state, "fork", NOW)
        self.assertEqual((entry["completed"], entry["skipped"], entry["step"]), (NOW.isoformat(), True, 0))
        self.assertTrue(lessons.catalog(loaded, [], state)["lessons"][0]["skipped"])
        # Taking it after all makes it a lesson taken.
        lessons.record(loaded, state, "fork", 1, NOW)
        self.assertNotIn("skipped", state["lessons"]["fork"])
        with self.assertRaises(ValueError):
            lessons.skip(loaded, state, "nope", NOW)

    def test_a_finished_lesson_is_not_marked_skipped(self):
        loaded = {"fork": lessons.parse(lesson(), "fork")}
        state = {"lessons": {}}
        lessons.record(loaded, state, "fork", 1, NOW)
        self.assertNotIn("skipped", lessons.skip(loaded, state, "fork", NOW))


class PlacementTests(unittest.TestCase):
    def test_a_check_takes_the_last_exercise_of_lessons_not_taken(self):
        from torre.coaching import coach_lessons
        with tempfile.TemporaryDirectory() as tmp:
            slug = coach_lessons.ensure_placement(tmp, "tactics", {"knight-fork"})
            rendered = coach_lessons.render(tmp, slug)
        self.assertEqual(slug, "placement-tactics")
        checks = rendered["coach"]["lessons"]
        self.assertTrue(checks)
        self.assertLessEqual(len(checks), coach_lessons.PLACEMENT)
        self.assertNotIn("knight-fork", checks.values())
        self.assertTrue(all(s["kind"] == "play" for s in rendered["steps"][1:]))
        self.assertEqual(rendered["steps"][0]["kind"], "explain")

    def test_nothing_left_to_check(self):
        from torre.coaching import coach_lessons
        loaded, _ = lessons.load_all()
        endgames = {s for s, l in loaded.items() if l["category"] == "endgames"}
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(coach_lessons.ensure_placement(tmp, "endgames", endgames))


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

    def test_catalog_lesson_and_progress(self):
        from urllib.error import HTTPError
        catalog = self.get("/api/lessons")
        self.assertEqual(catalog["problems"], [])
        self.assertIsInstance(catalog["lessons"][0]["steps"], int)  # a count; steps come with the lesson
        fork = self.get("/api/lessons/knight-fork")
        self.assertEqual(fork["step"], 0)
        self.post("/api/lessons/progress", {"slug": "knight-fork", "step": len(fork["steps"])})
        self.assertTrue(self.get("/api/lessons/knight-fork")["completed"])
        with self.assertRaises(HTTPError) as missing:
            self.get("/api/lessons/nope")
        self.assertEqual(missing.exception.code, 404)
        with self.assertRaises(HTTPError) as bad:
            self.post("/api/lessons/progress", {"slug": "knight-fork", "step": 99})
        self.assertEqual(bad.exception.code, 400)


if __name__ == "__main__":
    unittest.main()


class LocalizeTests(unittest.TestCase):
    def test_overlay_replaces_only_text_and_keeps_the_unit_key(self):
        raw = lesson(unit="Fork tricks", steps=[{"id": "fork", "kind": "play", "fen": FORK, "prompt": "Fork.", "hint": "Jump.",
                                               "line": ["d5e7", "g8f8", "e7c8"], "success": "Won."}])
        parsed = lessons.parse(raw, "fork")
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "es").mkdir()
            (Path(folder) / "es" / "fork.json").write_text(json.dumps({
                "title": "Horquilla", "unit": "Trucos de horquilla",
                "steps": [{"id": "fork", "prompt": "Horquilla.", "line": ["a2a4"], "fen": "8/8/8/8/8/8/8/8 w - - 0 1"}],
            }), encoding="utf-8")
            es = lessons.localize(parsed, "es", folder)
        self.assertEqual((es["title"], es["unitTitle"], es["unit"]), ("Horquilla", "Trucos de horquilla", "Fork tricks"))
        step = es["steps"][0]
        self.assertEqual((step["prompt"], step["hint"]), ("Horquilla.", "Jump."))  # untranslated text stays English
        self.assertEqual(step["fen"], parsed["steps"][0]["fen"])  # positions never come from an overlay
        self.assertEqual(lessons.localize(parsed, "en")["title"], "Fork")
