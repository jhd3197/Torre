"""Puzzle packs, picking and progress: .venv/Scripts/python -m unittest test_puzzles -v"""
import json
import random
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from torre.learning import puzzles
NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)
# Black blunders Qxb2?? and White mates on the back rank: Re8#.
BACK_RANK = {"id": "br001", "fen": "1q4k1/5ppp/8/8/8/8/1P3PPP/4R1K1 b - - 0 1", "moves": ["b8b2", "e1e8"],
             "rating": 900, "themes": ["mateIn1", "backRankMate"]}


def pack(*items):
    return {"version": 1, "puzzles": list(items)}


def write(folder, slug, body):
    (Path(folder) / f"{slug}.json").write_text(json.dumps(body), encoding="utf-8")


def packs_of(*items, theme="mate-in-1"):
    with tempfile.TemporaryDirectory() as tmp:
        write(tmp, theme, pack(*items))
        return puzzles.load_packs(tmp)


def fake(pid, rating):
    return {**BACK_RANK, "id": pid, "rating": rating}


class BundledPuzzleTests(unittest.TestCase):
    def test_every_bundled_puzzle_is_playable(self):
        packs = puzzles.load_packs(mine=False)
        self.assertEqual(packs["problems"], [])
        self.assertEqual(set(packs["themes"]), set(puzzles.THEMES) - {puzzles.MINE})
        for pid, raw in packs["by_id"].items():
            with self.subTest(puzzle=pid):
                view = puzzles.view(raw)
                self.assertTrue(view["moves"])
                if "mateIn1" in raw["themes"]:
                    self.assertTrue(view["mate"])

    def test_every_theme_covers_beginners_to_masters(self):
        for slug, items in puzzles.load_packs(mine=False)["themes"].items():
            with self.subTest(theme=slug):
                self.assertGreaterEqual(len(items), 100)
                self.assertLess(min(p["rating"] for p in items), 900)
                self.assertGreater(max(p["rating"] for p in items), 2000)


class PackTests(unittest.TestCase):
    def test_view_splits_the_opponents_move_from_the_solution(self):
        view = puzzles.view(BACK_RANK)
        self.assertEqual(view["setup"], {"uci": "b8b2", "san": "Qxb2"})
        self.assertEqual(view["moves"], [{"uci": "e1e8", "san": "Re8#"}])
        self.assertTrue(view["mate"])
        self.assertEqual([t["slug"] for t in view["themes"]], ["mate-in-1", "back-rank-mate"])

    def test_problems_are_reported_not_raised(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "mate-in-1", pack(BACK_RANK, {**BACK_RANK, "id": "odd", "moves": ["b8b2"]}))
            write(tmp, "cooking", pack(BACK_RANK))
            (Path(tmp) / "fork.json").write_text("{", encoding="utf-8")
            packs = puzzles.load_packs(tmp)
        self.assertEqual(list(packs["by_id"]), ["br001"])
        text = " ".join(packs["problems"])
        for message in ("even-length", "unknown theme", "not valid JSON"):
            self.assertIn(message, text)

    def test_an_illegal_line_fails_when_served(self):
        with self.assertRaisesRegex(puzzles.PuzzleError, "not legal"):
            puzzles.view({**BACK_RANK, "moves": ["b8b2", "e1a8"]})


class PickTests(unittest.TestCase):
    def setUp(self):
        self.packs = packs_of(fake("a", 800), fake("b", 1500), fake("c", 1580), fake("d", 2400))
        self.state = puzzles.load_state(Path("missing.json"))

    def test_new_puzzles_come_from_near_the_rating(self):
        picks = {puzzles.pick_next(self.packs, self.state, "mate-in-1", rng=random.Random(i)) for i in range(20)}
        self.assertEqual(picks, {"b", "c"})

    def test_the_window_widens_and_solved_puzzles_are_skipped(self):
        self.state["puzzles"] = {"b": {}, "c": {}}
        self.assertEqual(puzzles.pick_next(self.packs, self.state, puzzles.MIXED), "a")
        self.state["puzzles"].update(a={}, d={})
        self.assertIsNone(puzzles.pick_next(self.packs, self.state, "mate-in-1"))

    def test_unknown_theme(self):
        with self.assertRaises(ValueError):
            puzzles.pick_next(self.packs, self.state, "fork")


class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.packs = packs_of(fake("easy", 1100), fake("hard", 1900))
        self.state = puzzles.load_state(Path("missing.json"))

    def test_first_try_moves_the_rating_and_retries_do_not(self):
        win = puzzles.record(self.packs, self.state, "hard", [], False, False, 12.4, NOW)
        self.assertEqual(win["result"], "solved")
        self.assertGreater(win["delta"], 40)
        self.assertEqual(self.state["rating"], 1500 + win["delta"])
        again = puzzles.record(self.packs, self.state, "hard", ["Qd2", "Kh1"], False, False, 3, NOW)
        self.assertEqual((again["rated"], again["delta"], again["result"], again["score"]), (False, 0, "missed", 0.4))
        entry = dict(self.state["puzzles"]["hard"])
        self.assertIn("due", entry.pop("review"))  # the miss gave it a review card
        self.assertEqual(entry, {"attempts": 2, "solved": 1, "first": "solved", "last": "missed",
                                 "last_at": NOW.isoformat(), "best_seconds": 12})

    def test_one_miss_is_a_partial_solve(self):
        result = puzzles.record(self.packs, self.state, "easy", ["Kh1"], False, False, 5, NOW)
        self.assertEqual((result["result"], result["score"], result["time_bonus"]), ("solved", 0.6, 0.0))
        self.assertLess(result["delta"], 0)  # expected ~0.91 against an 1100 puzzle
        entry = self.state["puzzles"]["easy"]
        self.assertEqual((entry["first"], entry["solved"]), ("solved", 0))  # solved, but not clean

    def test_two_misses_or_a_reveal_are_a_miss(self):
        two = puzzles.record(self.packs, self.state, "easy", ["Kh1", "Qd2"], False, False, 5, NOW)
        self.assertEqual((two["result"], two["score"], two["misses"]), ("missed", 0.4, ["Kh1", "Qd2"]))
        self.assertEqual(puzzles.pick_next(self.packs, self.state, puzzles.MISSED), "easy")
        state = puzzles.load_state(Path("missing.json"))
        shown = puzzles.record(self.packs, state, "easy", [], False, True, 5, NOW)
        self.assertEqual((shown["result"], shown["score"], shown["time_bonus"]), ("missed", 0.0, 0.0))

    def test_a_hint_caps_the_score_but_still_solves(self):
        result = puzzles.record(self.packs, self.state, "easy", [], True, False, 5, NOW)
        self.assertEqual((result["result"], result["score"]), ("solved", 0.5))
        self.assertLess(result["delta"], -10)
        hinted_miss = puzzles.record(self.packs, puzzles.load_state(Path("missing.json")), "easy", ["Kh1"], True, False, 5, NOW)
        self.assertEqual((hinted_miss["result"], hinted_miss["score"]), ("solved", 0.5))

    def test_a_fast_clean_solve_earns_a_time_bonus(self):
        fast = puzzles.record(self.packs, self.state, "easy", [], False, False, 1, NOW)
        slow = puzzles.record(self.packs, puzzles.load_state(Path("missing.json")), "easy", [], False, False, 999, NOW)
        self.assertGreater(fast["score"], 1.0)
        self.assertGreater(fast["time_bonus"], 0)
        self.assertEqual((slow["score"], slow["time_bonus"]), (1.0, 0.0))
        self.assertGreater(fast["delta"], slow["delta"])

    def test_best_seconds_tracks_the_fastest_clean_solve(self):
        puzzles.record(self.packs, self.state, "easy", [], False, False, 9.6, NOW)
        self.assertEqual(self.state["puzzles"]["easy"]["best_seconds"], 10)
        puzzles.record(self.packs, self.state, "easy", [], False, False, 30, NOW)
        self.assertEqual(self.state["puzzles"]["easy"]["best_seconds"], 10)
        puzzles.record(self.packs, self.state, "easy", ["Kh1"], False, False, 4, NOW)  # misses don't count
        puzzles.record(self.packs, self.state, "easy", [], True, False, 2, NOW)  # hints don't count
        self.assertEqual(self.state["puzzles"]["easy"]["best_seconds"], 10)
        puzzles.record(self.packs, self.state, "easy", [], False, False, 4.2, NOW)
        self.assertEqual(self.state["puzzles"]["easy"]["best_seconds"], 4)

    def test_missed_puzzles_queue_oldest_first_until_solved(self):
        puzzles.record(self.packs, self.state, "hard", ["x", "y"], False, False, 1, NOW)
        puzzles.record(self.packs, self.state, "easy", ["x", "y"], False, False, 1, NOW + timedelta(minutes=1))
        self.assertEqual(puzzles.pick_next(self.packs, self.state, puzzles.MISSED), "hard")
        self.assertEqual(puzzles.pick_next(self.packs, self.state, puzzles.MISSED, exclude="hard"), "easy")
        left = puzzles.record(self.packs, self.state, "hard", [], False, False, 1, NOW + timedelta(minutes=2))["missed_left"]
        self.assertEqual(left, 1)
        self.assertEqual(puzzles.pick_next(self.packs, self.state, puzzles.MISSED), "easy")

    def test_a_missed_puzzle_comes_back_spaced_until_it_sticks(self):
        puzzles.record(self.packs, self.state, "easy", [], False, False, 5, NOW)
        self.assertNotIn("review", self.state["puzzles"]["easy"])  # solved cleanly at first: never reviewed
        puzzles.record(self.packs, self.state, "hard", ["x", "y"], False, False, 5, NOW)
        retry = puzzles.record(self.packs, self.state, "hard", [], False, False, 5, NOW + timedelta(minutes=1))
        self.assertEqual(retry["missed_left"], 0)
        soon = datetime.fromisoformat(retry["next_review"])
        self.assertLess(soon, NOW + timedelta(hours=1))  # a learning step: back in minutes
        self.assertEqual(puzzles.pick_next(self.packs, self.state, puzzles.MISSED, now=soon), "hard")
        self.assertEqual(puzzles.reviews(self.packs, self.state, soon)["due"], 1)
        again = puzzles.record(self.packs, self.state, "hard", [], False, False, 5, soon)
        later = datetime.fromisoformat(again["next_review"])
        self.assertGreater(later, soon + timedelta(hours=12))  # graduated: back in days
        self.assertIsNone(puzzles.pick_next(self.packs, self.state, puzzles.MISSED, now=soon))
        self.assertEqual(puzzles.reviews(self.packs, self.state, soon), {"due": 0, "scheduled": 1, "next_due": again["next_review"]})
        lapse = puzzles.record(self.packs, self.state, "hard", ["x", "y"], False, False, 5, later)
        self.assertEqual(lapse["missed_left"], 1)  # missed again: straight back to the queue

    def test_catalog_counts_per_theme(self):
        puzzles.record(self.packs, self.state, "easy", [], False, False, 4, NOW)
        puzzles.record(self.packs, self.state, "hard", ["Kh1", "Qd2"], False, False, 9, NOW)
        info = puzzles.catalog(self.packs, self.state)
        theme = info["themes"][0]
        self.assertEqual((theme["count"], theme["attempted"], theme["solved_first"], theme["missed"]), (2, 2, 1, 1))
        self.assertEqual((info["missed"], info["rated"], len(info["trend"])), (1, 2, 2))
        self.assertEqual(info["recent"][0]["id"], "hard")
        self.assertEqual(info["recent"][0]["themes"], ["Mate in 1", "Back-rank mate"])

    def test_catalog_week_change_and_average_solve(self):
        old = puzzles.record(self.packs, self.state, "easy", [], False, False, 10, NOW - timedelta(days=9))
        new = puzzles.record(self.packs, self.state, "hard", [], False, False, 20, NOW)
        info = puzzles.catalog(self.packs, self.state, now=NOW)
        self.assertEqual(info["week"], new["delta"])
        self.assertNotEqual(old["delta"], 0)
        self.assertEqual(info["avg_seconds"], 15)
        self.assertIsNone(puzzles.catalog(self.packs, {**self.state, "history": []}, now=NOW)["avg_seconds"])

    def test_catalog_starts_runs_at_zero(self):
        info = puzzles.catalog(self.packs, self.state)
        self.assertEqual(info["runs"], {"streak": {"best": 0, "played": 0}, "storm": {"best": 0, "played": 0}})
        self.assertEqual(info["weak"], [])

    def test_state_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "puzzles.json"
            puzzles.record(self.packs, self.state, "easy", [], False, False, 4, NOW)
            puzzles.save_state(path, self.state)
            self.assertEqual(puzzles.load_state(path), self.state)


def two_themes():
    """A fork pack (weak: 1 of 5 first tries) and a pin pack (strong: 5 of 5), each with fresh puzzles left."""
    with tempfile.TemporaryDirectory() as tmp:
        write(tmp, "fork", pack(*[fake(f"f{i}", 1500) for i in range(8)]))
        write(tmp, "pin", pack(*[fake(f"p{i}", 1500) for i in range(8)]))
        return puzzles.load_packs(tmp)


class WeakTests(unittest.TestCase):
    def setUp(self):
        self.packs = two_themes()
        self.state = puzzles.load_state(Path("missing.json"))

    def tried(self, prefix, solved, total):
        for i in range(total):
            self.state["puzzles"][f"{prefix}{i}"] = {"attempts": 1, "solved": 0, "first": "solved" if i < solved else "missed"}

    def test_without_history_weak_falls_back_to_mixed(self):
        self.assertEqual(puzzles.weak_themes(self.packs, self.state), [])
        self.assertIn(puzzles.pick_next(self.packs, self.state, puzzles.WEAK), self.packs["by_id"])

    def test_weak_needs_enough_tries_and_a_low_rate(self):
        self.tried("f", 1, 4)  # one short of WEAK_MIN_TRIES
        self.tried("p", 5, 5)
        self.assertEqual(puzzles.weak_themes(self.packs, self.state), [])
        self.tried("f", 1, 5)
        self.assertEqual(puzzles.weak_themes(self.packs, self.state), ["fork"])
        self.assertEqual(puzzles.catalog(self.packs, self.state)["weak"], ["fork"])

    def test_weak_serves_the_weakest_theme_until_it_runs_out(self):
        self.tried("f", 1, 5)
        self.tried("p", 2, 5)  # 40%: weak too, but fork is weaker
        self.assertEqual(puzzles.weak_themes(self.packs, self.state), ["fork", "pin"])
        picks = {puzzles.pick_next(self.packs, self.state, puzzles.WEAK, rng=random.Random(i)) for i in range(30)}
        self.assertEqual(picks, {"f5", "f6", "f7", "p5", "p6", "p7"})
        self.tried("p", 5, 5)  # pin is strong again
        picks = {puzzles.pick_next(self.packs, self.state, puzzles.WEAK, rng=random.Random(i)) for i in range(30)}
        self.assertEqual(picks, {"f5", "f6", "f7"})
        picks = {puzzles.pick_next(self.packs, self.state, puzzles.WEAK, exclude=["f5", "f6", "f7"], rng=random.Random(i)) for i in range(30)}
        self.assertEqual(picks, {"p5", "p6", "p7"})  # fork used up: mixed takes over


class RunTests(unittest.TestCase):
    def setUp(self):
        self.packs = packs_of(*[fake(f"r{r}", r) for r in range(600, 2600, 50)])
        self.state = puzzles.load_state(Path("missing.json"))

    def test_runs_start_below_the_rating_and_climb(self):
        self.assertEqual(puzzles.run_target("streak", 1500, 0), 1300)
        self.assertEqual(puzzles.run_target("streak", 1500, 4), 1500)
        self.assertEqual(puzzles.run_target("storm", 1500, 0), 1100)
        self.assertEqual(puzzles.run_target("storm", 600, 0), 400)  # never below the floor
        first = self.packs["by_id"][puzzles.pick_run(self.packs, self.state, "streak", 0)]
        later = self.packs["by_id"][puzzles.pick_run(self.packs, self.state, "streak", 12)]
        self.assertLessEqual(abs(first["rating"] - 1300), 100)
        self.assertLessEqual(abs(later["rating"] - 1900), 100)

    def test_runs_skip_this_runs_puzzles_and_reuse_seen_ones_last(self):
        near = [f"r{r}" for r in range(1200, 1450, 50)]
        self.state["puzzles"] = {pid: {} for pid in near}
        self.assertNotIn(puzzles.pick_run(self.packs, self.state, "streak", 0), near)
        self.state["puzzles"] = {pid: {} for pid in self.packs["by_id"]}
        picks = {puzzles.pick_run(self.packs, self.state, "streak", 0, exclude=["r1300"], rng=random.Random(i)) for i in range(20)}
        self.assertTrue(picks <= set(near) - {"r1300"})
        with self.assertRaises(ValueError):
            puzzles.pick_run(self.packs, self.state, "marathon", 0)

    def test_a_run_saves_its_best_and_never_the_rating(self):
        before = json.dumps(self.state, sort_keys=True)
        first = puzzles.record_run(self.state, "streak", 7, NOW)
        self.assertEqual(first, {"mode": "streak", "score": 7, "best": 7, "new_best": True, "played": 1})
        worse = puzzles.record_run(self.state, "streak", 3, NOW)
        self.assertEqual((worse["best"], worse["new_best"], worse["played"]), (7, False, 2))
        self.assertEqual((self.state["rating"], self.state["rated"], self.state["puzzles"], self.state["history"]), (1500, 0, {}, []))
        self.assertNotEqual(before, json.dumps(self.state, sort_keys=True))
        self.assertEqual(puzzles.catalog(self.packs, self.state)["runs"]["streak"], {"best": 7, "played": 2})
        for bad in (-1, 2.5, True, "3"):
            with self.assertRaises(ValueError):
                puzzles.record_run(self.state, "storm", bad, NOW)


if __name__ == "__main__":
    unittest.main()
