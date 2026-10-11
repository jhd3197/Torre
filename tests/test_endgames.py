"""Endgame practice checks: .venv/Scripts/python -m unittest test_endgames -v"""
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import chess

from torre.learning import endgames
from torre.analysis import engine_service
NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)


def position(fen, goal, moves=10):
    return {"id": "test", "group": "test", "goal": goal, "moves": moves, "fen": fen,
            "title": {"en": "Test"}, "explain": {"en": "Test"}}


def scripted(move, score):
    """A think() that always plays `move` and scores the position `score` for the side to move."""
    calls = []

    def think(board):
        calls.append(board.fen())
        return chess.Move.from_uci(move), score
    think.calls = calls
    return think


QUEEN_MATE = position("7k/8/6K1/8/8/8/8/1Q6 w - - 0 1", "win")  # 1. Qb8#
PROMOTE = position("8/4P3/8/8/8/8/k7/4K3 w - - 0 1", "win")    # 1. e8=Q
DEFEND = position("8/8/8/8/4k3/8/4P3/4K3 b - - 0 1", "draw", moves=2)


class CatalogTests(unittest.TestCase):
    def test_every_position_is_legal_with_you_to_move(self):
        self.assertGreaterEqual(len(endgames.POSITIONS), 15)
        self.assertEqual(len(endgames.BY_ID), len(endgames.POSITIONS))
        for p in endgames.POSITIONS:
            with self.subTest(p["id"]):
                board = chess.Board(p["fen"])
                self.assertTrue(board.is_valid())
                self.assertFalse(board.is_game_over())
                self.assertIn(p["goal"], ("win", "draw"))
                self.assertTrue(p["title"]["es"] and p["explain"]["es"] and p["explain"]["en"])

    def test_catalog_is_localized_and_shows_progress(self):
        state = endgames.load_state(Path(tempfile.gettempdir()) / f"endgames-{id(object())}.json")
        state["positions"]["lucena"] = {"attempts": 2, "completed": NOW.isoformat(), "best": 9}
        view = endgames.catalog(state, "es")
        lucena = next(p for p in view["positions"] if p["id"] == "lucena")
        self.assertEqual(lucena["title"], "Posición de Lucena")
        self.assertEqual((lucena["attempts"], lucena["best"], lucena["color"]), (2, 9, "white"))
        self.assertEqual(view["completed"], 1)
        philidor = next(p for p in view["positions"] if p["id"] == "philidor")
        self.assertEqual(philidor["color"], "black")


class PlayTests(unittest.TestCase):
    def test_mate_wins_without_asking_the_engine(self):
        think = scripted("h8h7", 0)
        result = endgames.play(QUEEN_MATE, ["b1b8"], think)
        self.assertEqual((result["status"], result["reason"], result["reply"]), ("success", "mate", None))
        self.assertEqual(think.calls, [])

    def test_the_engine_answers_while_play_goes_on(self):
        result = endgames.play(QUEEN_MATE, ["b1b7"], scripted("h8g8", -endgames.MATE + 3))
        self.assertEqual((result["status"], result["reply"], result["reply_san"], result["used"]), ("playing", "h8g8", "Kg8", 1))

    def test_stalemate_fails_a_win(self):
        stalemate = position("7k/8/5K2/8/8/8/8/6Q1 w - - 0 1", "win")
        result = endgames.play(stalemate, ["g1g6"], scripted("h8g8", 0))
        self.assertEqual((result["status"], result["reason"]), ("failed", "drawn"))

    def test_promotion_into_a_won_position_converts(self):
        self.assertEqual(endgames.play(PROMOTE, ["e7e8q"], scripted("a2b3", -endgames.MATE + 20))["reason"], "converted")
        # A promotion the engine does not rate as winning plays on.
        self.assertEqual(endgames.play(PROMOTE, ["e7e8q"], scripted("a2b3", 0))["status"], "playing")
        # Without a promotion or a bare king, a big score is not enough: you must mate.
        self.assertEqual(endgames.play(QUEEN_MATE, ["b1b7"], scripted("h8g8", -5000))["status"], "playing")

    def test_running_out_of_moves_fails_a_win(self):
        short = {**QUEEN_MATE, "moves": 1}
        result = endgames.play(short, ["b1b7"], scripted("h8g8", -5000))
        self.assertEqual((result["status"], result["reason"]), ("failed", "limit"))

    def test_holding_a_draw(self):
        self.assertEqual(endgames.play(DEFEND, ["e4e5"], scripted("e1d2", 0))["status"], "playing")
        held = endgames.play(DEFEND, ["e4e5", "e1d2", "e5d5"], scripted("d2e3", 0))
        self.assertEqual((held["status"], held["reason"], held["used"]), ("success", "held", 2))
        lost = endgames.play(DEFEND, ["e4e5", "e1d2", "e5d5"], scripted("d2e3", endgames.HOLD_CP + 50))
        self.assertEqual((lost["status"], lost["reason"]), ("failed", "lost"))
        clearly = endgames.play(DEFEND, ["e4d4"], scripted("e1d2", endgames.LOST_CP))
        self.assertEqual((clearly["status"], clearly["reason"], clearly["reply"]), ("failed", "lost", None))

    def test_a_draw_by_rule_holds(self):
        capture = position("8/8/8/8/8/3k4/4P3/7K b - - 0 1", "draw")
        result = endgames.play(capture, ["d3e2"], scripted("h1g1", 0))
        self.assertEqual((result["status"], result["reason"]), ("success", "drawn"))

    def test_tablebases_decide_when_installed(self):
        self.assertEqual(endgames.play(PROMOTE, ["e7e8q"], scripted("a2b3", 0), probe=lambda b: -2)["reason"], "converted")
        slipped = endgames.play(QUEEN_MATE, ["b1b7"], scripted("h8g8", 0), probe=lambda b: 0)
        self.assertEqual((slipped["status"], slipped["reason"]), ("failed", "slipped"))
        lost = endgames.play(DEFEND, ["e4d4"], scripted("e1d2", 0), probe=lambda b: 2)
        self.assertEqual((lost["status"], lost["reason"]), ("failed", "lost"))

    def test_bad_requests(self):
        for moves in ([], ["b1b7", "h8g8"], ["e2e4"]):
            with self.subTest(moves=moves), self.assertRaises(ValueError):
                endgames.play(QUEEN_MATE, moves, scripted("h8g8", 0))


class RecordTests(unittest.TestCase):
    def test_attempts_and_completion(self):
        path = Path(tempfile.gettempdir()) / f"endgames-{id(object())}.json"
        state = endgames.load_state(path)
        endgames.record(state, "kqk", {"status": "playing"}, 1, NOW)
        endgames.record(state, "kqk", {"status": "success"}, 9, NOW)
        endgames.record(state, "kqk", {"status": "success"}, 12, NOW)
        self.assertEqual(state["positions"]["kqk"], {"attempts": 1, "completed": NOW.isoformat(), "best": 9})
        endgames.save_state(path, state)
        try:
            self.assertEqual(endgames.load_state(path), state)
        finally:
            path.unlink()


class StudioServer(unittest.TestCase):
    """Endpoints through the real request handler, on a temporary data folder."""
    GAMES = []

    @classmethod
    def setUpClass(cls):
        import json, threading
        from http.server import ThreadingHTTPServer
        from torre.server import studio
        cls.tmp = tempfile.TemporaryDirectory()
        data = Path(cls.tmp.name)
        (data / "games.jsonl").write_text("".join(json.dumps(g) + "\n" for g in cls.GAMES), encoding="utf-8")
        studio.use_data_dir(data)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), studio.Handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def get(self, path):
        import json
        from urllib.request import Request, urlopen
        with urlopen(Request(self.base + path, headers={"X-Lang": "es"})) as response:
            return json.loads(response.read())

    def post(self, path, body):
        import json
        from urllib.error import HTTPError
        from urllib.request import Request, urlopen
        request = Request(self.base + path, json.dumps(body).encode(),
                          {"Content-Type": "application/json", "X-Chess-Studio": "1"})
        try:
            with urlopen(request) as response:
                return json.loads(response.read())
        except HTTPError as error:
            return {"status": error.code, **json.loads(error.read())}


class ServerTests(StudioServer):
    def test_catalog_and_a_mate(self):
        from torre.server import studio
        catalog = self.get("/api/endgames")
        self.assertEqual(catalog["total"], len(endgames.POSITIONS))
        self.assertEqual(catalog["positions"][0]["title"], "Mate con dama")
        self.assertEqual(self.post("/api/endgames/move", {"id": "nope", "moves": []})["status"], 404)
        if not engine_service.ENGINE_PATH.exists():
            self.skipTest("Stockfish is not installed")
        # 1. Qh5+ against the real engine, then an illegal history.
        first = self.post("/api/endgames/move", {"id": "kqk", "moves": ["h1h5"]})
        self.assertEqual(first["status"], "playing")
        self.assertIn(first["reply"], [m.uci() for m in chess.Board("8/8/8/4k2Q/8/8/8/4K3 b - - 1 1").legal_moves])
        self.assertEqual(first["progress"]["attempts"], 1)
        self.assertEqual(self.post("/api/endgames/move", {"id": "kqk", "moves": ["h1h8", "e5e4", "e1e1"]})["status"], 400)
        self.assertEqual(self.get("/api/endgames")["positions"][0]["attempts"], 1)


if __name__ == "__main__":
    unittest.main()
