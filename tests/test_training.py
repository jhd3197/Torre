"""Drill and PGN export checks: .venv/Scripts/python -m unittest test_training -v"""
import io
import unittest
from pathlib import Path
from datetime import datetime, timedelta, timezone

import chess
import chess.pgn

from torre.analysis import analyze
from torre.server import api_training
from torre.analysis import engine_service
from torre.learning import drills
from torre.analysis import pgn_export
NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)
# 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6?? 4. Qxf7#  (Black, the user, blunders on ply 6)
PGN = '[White "Bot"]\n[Black "Me"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n'
BEFORE_NF6 = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3"


def record(game_id=1, date="2026.09.01"):
    evals = [[30, None], [30, None], [25, None], [20, None], [40, None], [30, None], [None, 1], [100_000, None]]
    best_moves = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g7g6", "h5f7", None]
    return {
        "id": str(game_id), "date": date, "opponent": "Bot", "scoring_version": analyze.SCORING_VERSION,
        "evals": evals, "best_moves": best_moves,
        "worst_moves": [
            {"ply": 6, "move_number": 3, "san": "Nf6", "fen": BEFORE_NF6, "class": "blunder"},
            {"ply": 2, "move_number": 1, "san": "e5", "fen": chess.STARTING_FEN, "class": "inaccuracy"},
        ],
    }


def equal(board):
    return [0, None]


def losing(board):
    """The side that just moved is now lost."""
    return [900 if board.turn == chess.WHITE else -900, None]


class DeckTests(unittest.TestCase):
    def test_mistakes_and_blunders_only_from_current_analysis(self):
        old = {**record(2), "scoring_version": 1}
        deck = drills.build_deck([record(1), old])
        self.assertEqual(list(deck), ["1:6"])
        self.assertEqual(deck["1:6"]["best"], "g7g6")
        self.assertEqual(deck["1:6"]["eval_before"], [30, None])

    def test_a_card_held_for_three_weeks_counts_as_mastered(self):
        deck = drills.build_deck([record(1)])
        state = drills.load_state(_missing())
        drills.review(state, "1:6", True, NOW)
        self.assertEqual(drills.next_card(deck, state, NOW)["mastered"], 0)
        state["cards"]["1:6"]["fsrs"]["stability"] = drills.MASTERED_DAYS + 1
        self.assertEqual(drills.next_card(deck, state, NOW)["mastered"], 1)

    def test_newest_games_first_and_daily_limit(self):
        deck = drills.build_deck([record(i, f"2026.09.{i:02d}") for i in range(1, 13)])
        state = drills.load_state(_missing())
        self.assertEqual(drills.next_card(deck, state, NOW)["card"]["game_id"], "12")
        for card_id in list(deck)[:drills.NEW_PER_DAY]:
            drills.answer(deck, state, card_id, "g7g6", equal, NOW)
        info = drills.next_card(deck, state, NOW)
        self.assertEqual(info["new"], 0)
        self.assertEqual(info["new_total"], 2)
        self.assertEqual(drills.next_card(deck, state, NOW + timedelta(days=1))["new"], 2)


class AnswerTests(unittest.TestCase):
    def setUp(self):
        self.deck = drills.build_deck([record()])
        self.state = drills.load_state(_missing())

    def test_engine_move_is_correct(self):
        result = drills.answer(self.deck, self.state, "1:6", "g7g6", losing, NOW)
        self.assertTrue(result["correct"])
        self.assertEqual(result["verdict"], "best")
        self.assertEqual(self.state["cards"]["1:6"]["lapses"], 0)
        self.assertGreater(datetime.fromisoformat(result["next_review"]), NOW)

    def test_equally_good_alternative_is_accepted(self):
        result = drills.answer(self.deck, self.state, "1:6", "d8e7", equal, NOW)
        self.assertTrue(result["correct"])
        self.assertEqual(result["verdict"], "good")

    def test_repeating_the_blunder_is_missed_and_comes_back_soon(self):
        result = drills.answer(self.deck, self.state, "1:6", "g8f6", losing, NOW)
        self.assertFalse(result["correct"])
        self.assertEqual(result["verdict"], "blunder")
        self.assertEqual(result["best_san"], "g6")
        self.assertEqual(self.state["cards"]["1:6"]["lapses"], 1)
        self.assertLess(datetime.fromisoformat(result["next_review"]), NOW + timedelta(hours=1))

    def test_due_card_returns(self):
        drills.answer(self.deck, self.state, "1:6", "g8f6", losing, NOW)
        self.assertIsNone(drills.next_card(self.deck, self.state, NOW)["card"])
        later = drills.next_card(self.deck, self.state, NOW + timedelta(hours=1))
        self.assertEqual(later["card"]["id"], "1:6")
        self.assertNotIn("best", later["card"])

    def test_illegal_or_unknown(self):
        with self.assertRaises(ValueError):
            drills.answer(self.deck, self.state, "1:6", "e1e2", equal, NOW)
        with self.assertRaises(ValueError):
            drills.answer(self.deck, self.state, "9:9", "g7g6", equal, NOW)

    def test_state_round_trip(self):
        path = _missing()
        drills.answer(self.deck, self.state, "1:6", "g7g6", equal, NOW)
        drills.save_state(path, self.state)
        try:
            self.assertEqual(drills.load_state(path), self.state)
        finally:
            path.unlink()


class MissedMateCardTests(unittest.TestCase):
    """Forced mates let go become cards, though they grade as inaccuracies at most."""
    PGN = "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0"

    def test_a_mate_let_go_becomes_a_card_and_a_mate_played_does_not(self):
        rec = record(1)
        # Move 4: White had mate in 1 (Qxf7#) and played it; replace that with a game where they let it go.
        game = {"id": "1", "pgn": "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxe5+ *", "user_color": "white"}
        rec = {**rec, "user_color": "white", "evals": rec["evals"][:7] + [[600, None]], "best_moves": rec["best_moves"]}
        cards = drills.missed_mate_cards([rec], {"1": game})
        self.assertEqual(list(cards), ["1:7"])
        card = cards["1:7"]
        self.assertEqual((card["mate"], card["best"], card["played"]), (1, "h5f7", "Qxe5+"))
        self.assertEqual(drills.card_view(card)["mate"], 1)
        played = {**game, "pgn": self.PGN}
        self.assertEqual(drills.missed_mate_cards([{**record(1), "user_color": "white"}], {"1": played}), {})


class LessonCardTests(unittest.TestCase):
    """Lesson `play` steps queued as FSRS review cards (source "lesson")."""
    LESSON = {"slug": "pins", "title": "Pins"}
    STEP = {"id": "pin-and-win", "kind": "play", "fen": BEFORE_NF6,
            "moves": [{"uci": "g7g6", "san": "g6"}], "alternatives": []}
    CARD_ID = "lesson:pins/pin-and-win"
    # White mates with both Qb7# (the line) and Qa7# (any mate is accepted).
    MATE = "k7/8/KQ6/8/8/8/8/8 w - - 0 1"

    def setUp(self):
        self.state = drills.load_state(_missing())
        drills.add_lesson_card(self.state, self.LESSON, self.STEP, NOW)

    @staticmethod
    def explode(board):
        raise AssertionError("lesson cards never call the engine")

    def test_enqueue_is_idempotent(self):
        self.assertIsNone(drills.add_lesson_card(self.state, self.LESSON, self.STEP, NOW + timedelta(days=1)))
        self.assertEqual(list(self.state["lesson_cards"]), [self.CARD_ID])

    def test_lesson_cards_join_the_queue_with_their_source(self):
        info = drills.next_card({}, self.state, NOW)
        self.assertEqual((info["total"], info["new"], info["new_total"]), (1, 1, 1))
        card = info["card"]
        self.assertEqual(card["id"], self.CARD_ID)
        self.assertEqual((card["source"], card["lesson"], card["lesson_title"], card["step"]),
                         ("lesson", "pins", "Pins", "pin-and-win"))
        self.assertEqual(card["fen"], BEFORE_NF6)
        self.assertNotIn("best", card)

    def test_the_line_is_the_answer_no_engine_needed(self):
        result = drills.answer({}, self.state, self.CARD_ID, "g7g6", self.explode, NOW)
        self.assertTrue(result["correct"])
        self.assertEqual((result["verdict"], result["source"], result["lesson"], result["lesson_title"]),
                         ("best", "lesson", "pins", "Pins"))

    def test_another_move_is_judged_against_the_lines_move(self):
        # The engine scores the line's move and the reader's: a big drop is a miss, an equal one counts.
        scores = {"g7g6": [0, None], "g8f6": [300, None]}
        evaluate = lambda board: scores[board.peek().uci()]
        result = drills.answer({}, self.state, self.CARD_ID, "g8f6", evaluate, NOW)
        self.assertFalse(result["correct"])
        self.assertIn(result["verdict"], ("mistake", "blunder"))
        state = drills.load_state(_missing())
        drills.add_lesson_card(state, self.LESSON, self.STEP, NOW)
        scores["g8f6"] = [10, None]
        self.assertTrue(drills.answer({}, state, self.CARD_ID, "g8f6", evaluate, NOW)["correct"])

    def test_a_listed_alternative_is_accepted(self):
        step = {**self.STEP, "alternatives": [{"uci": "d8e7", "san": "Qe7"}]}
        state = drills.load_state(_missing())
        drills.add_lesson_card(state, self.LESSON, step, NOW)
        self.assertTrue(drills.answer({}, state, self.CARD_ID, "d8e7", self.explode, NOW)["correct"])

    def test_any_checkmate_is_accepted(self):
        step = {**self.STEP, "fen": self.MATE, "moves": [{"uci": "b6b7", "san": "Qb7#"}]}
        state = drills.load_state(_missing())
        drills.add_lesson_card(state, self.LESSON, step, NOW)
        result = drills.answer({}, state, self.CARD_ID, "b6a7", self.explode, NOW)
        self.assertTrue(result["correct"])
        self.assertEqual(result["verdict"], "mate")

    def test_lesson_cards_share_the_daily_new_card_cap(self):
        deck = drills.build_deck([record(i, f"2026.09.{i:02d}") for i in range(1, 13)])
        info = drills.next_card(deck, self.state, NOW)
        self.assertEqual(info["new"], drills.NEW_PER_DAY)  # the lesson card takes one of the ten slots
        self.assertEqual(info["new_total"], 13)
        self.assertEqual(info["card"]["id"], self.CARD_ID)  # lessons come first


class ReviewedFlagTests(unittest.TestCase):
    """A Good review pays XP once; a duplicate retry before the card is due pays nothing."""
    def setUp(self):
        self.deck = drills.build_deck([record()])
        self.state = drills.load_state(_missing())

    def test_good_review_then_duplicate(self):
        first = drills.answer(self.deck, self.state, "1:6", "g7g6", losing, NOW)
        self.assertTrue(first["correct"])
        self.assertTrue(first["reviewed"])
        again = drills.answer(self.deck, self.state, "1:6", "g7g6", losing, NOW)
        self.assertFalse(again["reviewed"])  # the card is no longer due

    def test_the_next_scheduled_review_counts_again(self):
        drills.answer(self.deck, self.state, "1:6", "g7g6", losing, NOW)
        due = datetime.fromisoformat(self.state["cards"]["1:6"]["fsrs"]["due"])
        later = drills.answer(self.deck, self.state, "1:6", "g7g6", losing, due + timedelta(seconds=1))
        self.assertTrue(later["reviewed"])


class PgnExportTests(unittest.TestCase):
    def test_annotations(self):
        text = pgn_export.annotated_pgn(PGN, record())
        game = chess.pgn.read_game(io.StringIO(text))
        self.assertEqual(game.errors, [])
        nodes = list(game.mainline())
        self.assertEqual(nodes[0].eval().white().score(), 30)
        self.assertEqual(nodes[5].eval().white().mate(), 1)
        self.assertIn(chess.pgn.NAG_BLUNDER, nodes[5].nags)
        self.assertIn("Blunder. g6 was best.", nodes[5].comment)
        self.assertEqual(nodes[5].parent.variations[1].move.uci(), "g7g6")
        self.assertIsNone(nodes[-1].eval())  # no eval on the mated position
        self.assertFalse(nodes[-1].nags)
        self.assertEqual(game.headers["Annotator"], "Torre (Stockfish)")

    def test_unanalyzed_game_exports_as_is(self):
        game = chess.pgn.read_game(io.StringIO(pgn_export.annotated_pgn(PGN, None)))
        self.assertNotIn("Annotator", game.headers)
        self.assertTrue(all(n.eval() is None and not n.nags for n in game.mainline()))

    def test_clock_comments_survive(self):
        pgn = PGN.replace("1. e4 e5", "1. e4 { [%clk 0:09:59] } e5")
        first = next(iter(chess.pgn.read_game(io.StringIO(pgn_export.annotated_pgn(pgn, record()))).mainline()))
        self.assertEqual(first.clock(), 599)
        self.assertIsNotNone(first.eval())

    def test_filename(self):
        headers = {"Date": "2026.09.05", "White": "jhd3197", "Black": "Duke BOT/x"}
        self.assertEqual(pgn_export.filename(headers), "2026.09.05-jhd3197-vs-Duke_BOT_x.pgn")


class ServerTests(unittest.TestCase):
    """The new endpoints through the real request handler."""
    @classmethod
    def setUpClass(cls):
        import json, tempfile, threading
        from http.server import ThreadingHTTPServer
        from torre.server import studio
        cls.tmp = tempfile.TemporaryDirectory()
        data = Path(cls.tmp.name)
        (data / "games.jsonl").write_text(json.dumps({"id": "1", "pgn": PGN, "user_color": "black"}) + "\n", encoding="utf-8")
        (data / "analysis.jsonl").write_text(json.dumps(record()) + "\n", encoding="utf-8")
        studio.use_data_dir(data)
        # A stand-in for the built interface (web/ builds the real one).
        cls.saved_ui = studio.UI_DIR
        studio.UI_DIR = data / "ui"
        (studio.UI_DIR / "assets").mkdir(parents=True)
        (studio.UI_DIR / "index.html").write_text('<!doctype html><html><head><script src="./assets/app.js"></script></head></html>', encoding="utf-8")
        (studio.UI_DIR / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), studio.Handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        from torre.server import studio
        studio.UI_DIR = cls.saved_ui
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def get(self, path):
        from urllib.request import urlopen
        with urlopen(self.base + path) as response:
            return response.headers, response.read().decode()

    def post(self, path, body):
        import json
        from urllib.request import Request, urlopen
        request = Request(self.base + path, json.dumps(body).encode(),
                          {"Content-Type": "application/json", "X-Chess-Studio": "1"})
        with urlopen(request) as response:
            return json.loads(response.read())

    def test_board_endpoints_still_work(self):
        self.assertEqual(len(self.post("/api/position", {})["legal"]), 20)

    def test_drills(self):
        import json
        card = json.loads(self.get("/api/drills")[1])["card"]
        self.assertEqual(card["id"], "1:6")
        self.assertNotIn("best", card)

    def test_drills_xp_pays_once_per_review(self):
        import json
        from torre.server import studio
        if not engine_service.ENGINE_PATH.exists():
            self.skipTest("Stockfish is not installed")
        xp = json.loads(self.get("/api/profile")[1])["xp"]
        first = self.post("/api/drills/answer", {"id": "1:6", "move": "g7g6"})
        self.assertTrue(first["correct"])
        self.assertTrue(first["reviewed"])
        self.assertEqual(json.loads(self.get("/api/profile")[1])["xp"], xp + 5)
        again = self.post("/api/drills/answer", {"id": "1:6", "move": "g7g6"})  # a duplicate retry
        self.assertFalse(again["reviewed"])
        self.assertEqual(json.loads(self.get("/api/profile")[1])["xp"], xp + 5)

    def test_pgn_download(self):
        headers, text = self.get("/api/games/1/pgn")
        self.assertIn("attachment", headers["Content-Disposition"])
        self.assertIn("$4", text)

    def status_of(self, path):
        from urllib.error import HTTPError
        try:
            return self.get(path)[0] and 200
        except HTTPError as error:
            return error.code

    def test_every_app_route_serves_the_page_with_a_base_for_its_depth(self):
        for path, base in [("/", "./"), ("/games", "./"), ("/games/12/30", "../../"), ("/insights/openings", "../"), ("/explore?moves=e2e4", "./")]:
            with self.subTest(path=path):
                headers, html = self.get(path)
                self.assertIn("text/html", headers["Content-Type"])
                self.assertIn(f'<head><base href="{base}">', html)

    def test_assets_are_served_and_nothing_outside_the_build(self):
        self.assertEqual(self.get("/assets/app.js")[1], "console.log(1)")
        for path in ("/assets/missing.js", "/api/nope", "/../studio.py", "/assets/../../studio.py", "/studio.py"):
            with self.subTest(path=path):
                self.assertEqual(self.status_of(path), 404)

    def test_line_sans(self):
        result = self.post("/api/line", {"moves": ["e2e4", "e7e5", "g1f3"]})
        self.assertEqual([m["san"] for m in result["moves"]], ["e4", "e5", "Nf3"])
        self.assertNotIn("error", result)
        cut = self.post("/api/line", {"moves": ["e2e4", "e2e4", "g1f3"]})
        self.assertEqual([m["san"] for m in cut["moves"]], ["e4"])
        self.assertIn("illegal", cut["error"])

    def test_review_analyzes_a_range_of_plies(self):
        from torre.server import studio
        if not engine_service.ENGINE_PATH.exists():
            self.skipTest("Stockfish is not installed")
        moves = ["f2f3", "e7e5", "g2g4", "d8h4"]
        plies = self.post("/api/review", {"moves": moves, "from": 2, "to": 4})["plies"]
        self.assertEqual([p["ply"] for p in plies], [2, 3, 4])
        self.assertEqual(plies[1]["best"], "d8h4")
        self.assertEqual(plies[2]["state"]["result"], "0-1")
        self.assertEqual(plies[2]["lines"], [])

    def test_stats(self):
        import json
        stats = json.loads(self.get("/api/stats")[1])
        self.assertEqual(stats["counts"]["analyzed"], 1)  # other tests may add played games
        self.assertIn("weaknesses", stats["summary"])

    def test_arena_ladder_is_empty_without_matches(self):
        import json
        board = json.loads(self.get("/api/arena/ladder")[1])
        self.assertEqual((board["players"], board["games"]), ([], 0))

    def test_puzzles(self):
        import json
        catalog = json.loads(self.get("/api/puzzles")[1])
        self.assertEqual((catalog["rating"], catalog["missed"]), (1500, 0))
        pid = json.loads(self.get("/api/puzzles/next?theme=fork")[1])["id"]
        puzzle = json.loads(self.get(f"/api/puzzles/{pid}")[1])
        self.assertIn("fork", [t["slug"] for t in puzzle["themes"]])
        self.assertIsNone(puzzle["progress"])
        result = self.post("/api/puzzles/attempt", {"id": pid, "misses": ["Qd2", "Kh1"], "hint": False, "revealed": False, "seconds": 7})  # one miss is a partial solve
        self.assertEqual((result["result"], result["missed_left"]), ("missed", 1))
        self.assertEqual(json.loads(self.get("/api/puzzles/next?theme=missed")[1])["id"], pid)
        self.assertEqual(self.status_of("/api/puzzles/next?theme=cooking"), 404)
        self.assertEqual(self.status_of("/api/puzzles/nope!"), 404)

    def test_puzzle_runs_are_unrated_and_keep_the_best(self):
        import json
        from urllib.error import HTTPError
        first = json.loads(self.get("/api/puzzles/next?run=streak&index=0")[1])["id"]
        second = json.loads(self.get(f"/api/puzzles/next?run=storm&index=3&exclude={first}")[1])["id"]
        self.assertTrue(first and second and first != second)
        self.assertEqual(self.status_of("/api/puzzles/next?run=marathon"), 404)
        self.assertEqual(self.post("/api/puzzles/run", {"mode": "streak", "score": 6})["best"], 6)
        self.assertEqual(self.post("/api/puzzles/run", {"mode": "streak", "score": 2})["best"], 6)
        with self.assertRaises(HTTPError):
            self.post("/api/puzzles/run", {"mode": "streak", "score": -1})
        catalog = json.loads(self.get("/api/puzzles")[1])
        self.assertEqual((catalog["rating"], catalog["rated"], catalog["runs"]["streak"]), (1500, 0, {"best": 6, "played": 2}))
        self.assertIsNotNone(json.loads(self.get("/api/puzzles/next?theme=weak")[1])["id"])  # no history yet: mixed

    def test_puzzles_xp_pays_for_a_first_clean_solve_only(self):
        import json
        xp = json.loads(self.get("/api/profile")[1])["xp"]
        pid = json.loads(self.get("/api/puzzles/next?theme=pin")[1])["id"]
        clean = {"id": pid, "misses": [], "hint": False, "revealed": False, "seconds": 9}
        result = self.post("/api/puzzles/attempt", clean)
        self.assertEqual((result["result"], result["rated"]), ("solved", True))
        self.assertEqual(json.loads(self.get("/api/profile")[1])["xp"], xp + 5)
        retry = self.post("/api/puzzles/attempt", clean)  # solved again: no second payout
        self.assertFalse(retry["rated"])
        self.assertEqual(json.loads(self.get("/api/profile")[1])["xp"], xp + 5)

    def test_review_results_are_saved_for_next_time(self):
        from torre.server import studio
        moves = ["e2e4", "e7e5"]
        self.assertEqual(self.post("/api/review", {"moves": moves, "from": 0, "to": 2, "cachedOnly": True})["plies"], [])
        if not engine_service.ENGINE_PATH.exists():
            self.skipTest("Stockfish is not installed")
        fresh = self.post("/api/review", {"moves": moves, "from": 0, "to": 2})["plies"]
        engine_service.forget_evals()  # as after a restart: read back from position-evals.jsonl
        saved = self.post("/api/review", {"moves": moves, "from": 0, "to": 2, "cachedOnly": True})["plies"]
        self.assertEqual([(p["ply"], p["best"]) for p in saved], [(p["ply"], p["best"]) for p in fresh])

    def test_played_games_feed_the_awards(self):
        import json
        game = {"gameId": "test-fools-mate", "initialFen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                "moves": ["f2f3", "e7e5", "g2g4", "d8h4"], "playerColor": "black", "result": "0-1", "botId": "baron-blunder", "elo": 330}
        before = {a["id"]: a["count"] for a in json.loads(self.get("/api/achievements")[1])["awards"]}
        first = self.post("/api/played", game)
        self.assertTrue(first["recorded"])
        self.assertFalse(self.post("/api/played", game)["recorded"])  # the same game is kept once
        after = {a["id"]: a["count"] for a in json.loads(self.get("/api/achievements")[1])["awards"]}
        self.assertEqual((after["checkmate"] - before["checkmate"], after["legend"] - before["legend"]), (1, 1))
        from urllib.error import HTTPError
        with self.assertRaises(HTTPError):  # a game still in progress is not recorded
            self.post("/api/played", {**game, "gameId": "test-unfinished", "moves": ["e2e4"], "result": "1-0"})

    def test_analysis_status(self):
        import json
        status = json.loads(self.get("/api/analysis")[1])
        self.assertFalse(status["running"])
        self.assertEqual(status["remaining"], 0)


def _missing():
    from pathlib import Path
    import tempfile
    return Path(tempfile.gettempdir()) / f"drills-test-{id(object())}.json"


if __name__ == "__main__":
    unittest.main()


class TodayPlanTests(unittest.TestCase):
    """GET /api/today: drills, puzzles to retry and new puzzles from your games, in one plan."""
    def setUp(self):
        import json, tempfile
        from torre.learning import puzzles
        from torre.server import studio
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        (self.data / "games.jsonl").write_text(json.dumps({"id": "1", "pgn": PGN, "user_color": "black"}) + "\n", encoding="utf-8")
        (self.data / "analysis.jsonl").write_text(json.dumps(record()) + "\n", encoding="utf-8")
        mine = [{"id": f"mine{i}", "fen": BEFORE_NF6, "moves": ["g7g6", "h5f7"], "rating": 1200, "themes": ["mateIn1"]} for i in range(7)]
        (self.data / "my-puzzles.json").write_text(json.dumps({"version": 1, "mined": [1], "puzzles": mine}), encoding="utf-8")
        studio.use_data_dir(self.data)
        self.addCleanup(setattr, puzzles, "MINE_FILE", puzzles.MINE_FILE)
        self.studio, self.puzzles = api_training, puzzles

    def test_plan_counts_every_kind_of_work(self):
        now = drills.now_utc()
        plan = self.studio.today_view(now)
        self.assertEqual((plan["drills"]["due"], plan["drills"]["new"]), (0, 1))  # the blunder, not the inaccuracy
        self.assertEqual(plan["reviews"]["due"], 0)
        self.assertEqual(plan["mine"], {"total": 7, "fresh": 7, "today": self.studio.MINE_PER_DAY})
        self.assertEqual(plan["todo"], 1 + self.studio.MINE_PER_DAY)
        packs = self.puzzles.load_packs()
        state = self.puzzles.load_state(self.data / "puzzles.json")
        self.puzzles.record(packs, state, "mine0", ["a", "b"], False, False, 5, now)  # a miss: retry it
        self.puzzles.record(packs, state, "mine1", [], False, False, 5, now)
        self.puzzles.save_state(self.data / "puzzles.json", state)
        plan = self.studio.today_view(now)
        self.assertEqual(plan["reviews"]["due"], 1)
        self.assertEqual(plan["mine"], {"total": 7, "fresh": 5, "today": self.studio.MINE_PER_DAY - 2})
        self.assertEqual(plan["todo"], 1 + 1 + self.studio.MINE_PER_DAY - 2)
