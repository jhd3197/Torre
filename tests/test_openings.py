"""Opening trainer checks: .venv/Scripts/python -m unittest test_openings -v"""
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import chess

from torre.analysis import analyze
from torre.learning import openings
NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)


def game(game_id, color, moves, eco="C40"):
    return {"id": str(game_id), "user_color": color,
            "pgn": f'[ECO "{eco}"]\n\n{moves} *\n'}


GAMES = [
    game(1, "white", "1. e4 e5 2. Nf3 Nc6 3. Bc4"),
    game(2, "white", "1. e4 e5 2. Nf3 Nf6 3. Nxe5"),
    game(3, "white", "1. e4 c5 2. Nf3 d6"),
    game(4, "white", "1. d4 d5 2. c4"),  # the odd 1. d4: no cards for what follows
    game(5, "white", "1. d4 d5 2. c4"),
    game(6, "black", "1. e4 c5 2. Nf3 d6"),
    game(7, "black", "1. e4 c5 2. Nc3 Nc6"),
]


def key(color, *sans):
    board = chess.Board()
    for san in sans:
        board.push_san(san)
    return f"{color}:{openings.position_key(board)}"


def _missing():
    return Path(tempfile.gettempdir()) / f"openings-test-{id(object())}.json"


class RepertoireTests(unittest.TestCase):
    def test_most_played_moves_along_your_own_lines(self):
        deck = openings.build_repertoire(GAMES)
        start = deck[key("white")]
        self.assertEqual(start["best"], "e2e4")
        self.assertEqual(start["seen"], 5)
        self.assertEqual(start["played"], [{"san": "e4", "count": 3}, {"san": "d4", "count": 2}])
        self.assertEqual(deck[key("white", "e4", "e5")]["best"], "g1f3")
        self.assertEqual(deck[key("white", "e4", "e5")]["line"], ["e4", "e5"])
        # Reached once only (1. e4 c5) or only after a move you do not usually play (1. d4).
        self.assertNotIn(key("white", "e4", "c5"), deck)
        self.assertNotIn(key("white", "d4", "d5"), deck)
        # Black: answers to 1. e4 come from the games where it was played.
        self.assertEqual(deck[key("black", "e4")]["best"], "c7c5")
        self.assertEqual(deck[key("black", "e4")]["opening"], "King's Knight Opening")

    def test_unsound_moves_give_way(self):
        def analysis(game_id, bad):
            # Plies 1-3 are fine; ply 3 (2. Nf3) is a blunder in the analysis when `bad`.
            evals = [[20, None], [30, None], [20, None], [-600 if bad else 30, None], [-600, None], [-600, None]]
            return {"id": game_id, "scoring_version": analyze.SCORING_VERSION, "evals": evals,
                    "best_moves": ["e2e4", "e7e5", "b1c3", "b8c6", None]}
        games = [game(1, "white", "1. e4 e5 2. Nf3 Nc6"), game(2, "white", "1. e4 e5 2. Nf3 Nc6"),
                 game(3, "white", "1. e4 e5 2. Nc3 Nc6")]
        found = {"1": analysis(1, True), "2": analysis(2, True), "3": analysis(3, False)}
        card = openings.build_repertoire(games, found)[key("white", "e4", "e5")]
        self.assertEqual(card["best"], "b1c3")
        self.assertFalse(card["corrected"])
        # Never played a sound move here: the engine's choice is expected.
        card = openings.build_repertoire(games[:2], found)[key("white", "e4", "e5")]
        self.assertEqual(card["best"], "b1c3")
        self.assertTrue(card["corrected"])


class AnswerTests(unittest.TestCase):
    def setUp(self):
        self.state = openings.load_state(_missing())
        self.deck = openings.full_deck(openings.build_repertoire(GAMES), self.state)

    def test_queue_and_grading(self):
        info = openings.next_card(self.deck, self.state, NOW)
        self.assertEqual(info["colors"], {"white": 2, "black": 1})
        card = info["card"]
        self.assertNotIn("best", card)
        right = openings.answer(self.deck, self.state, card["id"], self.deck[card["id"]]["best"], NOW)
        self.assertTrue(right["correct"])
        # A new card steps through FSRS learning: Good waits longer than Again.
        self.assertGreater(datetime.fromisoformat(right["next_review"]), NOW + timedelta(minutes=5))
        start = key("white")
        wrong = openings.answer(self.deck, self.state, start, "d2d4", NOW)
        self.assertFalse(wrong["correct"])
        self.assertEqual(wrong["best_san"], "e4")
        self.assertLess(datetime.fromisoformat(wrong["next_review"]), datetime.fromisoformat(right["next_review"]))
        self.assertEqual(self.state["cards"][start]["lapses"], 1)
        self.assertEqual(openings.next_card(self.deck, self.state, NOW + timedelta(hours=1))["card"]["id"], start)

    def test_illegal_or_unknown(self):
        with self.assertRaises(ValueError):
            openings.answer(self.deck, self.state, key("white"), "e2e5", NOW)
        with self.assertRaises(ValueError):
            openings.answer(self.deck, self.state, "white:nowhere", "e2e4", NOW)


class LineTests(unittest.TestCase):
    def test_your_own_lines_add_cards_and_win_over_the_games(self):
        state = openings.load_state(_missing())
        line = openings.add_line(state, "white", "1. e4 e5 2. Bc4 Nf6 3. d3", NOW)
        self.assertEqual(line["moves"], ["e2e4", "e7e5", "f1c4", "g8f6", "d2d3"])
        self.assertIs(openings.add_line(state, "white", "e2e4 e7e5 f1c4 g8f6 d2d3", NOW), line)
        deck = openings.full_deck(openings.build_repertoire(GAMES), state)
        self.assertEqual(deck[key("white", "e4", "e5")]["best"], "f1c4")
        self.assertEqual(deck[key("white", "e4", "e5")]["source"], "custom")
        self.assertEqual(deck[key("white", "e4", "e5", "Bc4", "Nf6")]["best"], "d2d3")
        self.assertEqual(list(deck)[0], key("white"))
        view = openings.next_card(deck, state, NOW)["lines"]
        self.assertEqual(view[0]["text"], "1. e4 e5 2. Bc4 Nf6 3. d3")
        openings.delete_line(state, line["id"])
        self.assertEqual(openings.full_deck({}, state), {})
        with self.assertRaises(ValueError):
            openings.delete_line(state, line["id"])

    def test_bad_lines(self):
        state = openings.load_state(_missing())
        for color, text in (("white", "1. e4 e4"), ("white", ""), ("black", "1. e4"), ("red", "1. e4")):
            with self.subTest(text=text), self.assertRaises(ValueError):
                openings.add_line(state, color, text, NOW)

    def test_state_round_trip(self):
        path = _missing()
        state = openings.load_state(path)
        openings.add_line(state, "black", "1. d4 Nf6", NOW)
        openings.save_state(path, state)
        try:
            self.assertEqual(openings.load_state(path), state)
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
    GAMES = GAMES

    def test_trainer_endpoints(self):
        info = self.get("/api/openings")
        self.assertEqual(info["card"]["id"], key("white"))
        self.assertEqual(self.get("/api/openings/next")["total"], 3)
        result = self.post("/api/openings/answer", {"id": key("white"), "move": "e2e4"})
        self.assertTrue(result["correct"])
        self.assertEqual(result["next"]["learned"], 1)
        added = self.post("/api/openings/lines", {"color": "black", "line": "1. d4 Nf6 2. c4 e6"})
        self.assertEqual(added["line"]["text"], "1. d4 Nf6 2. c4 e6")
        self.assertEqual(added["next"]["total"], 5)
        self.assertEqual(self.post("/api/openings/lines", {"color": "black", "line": "1. d4 Ke2"})["status"], 400)
        left = self.post("/api/openings/lines/delete", {"id": added["line"]["id"]})
        self.assertEqual((left["next"]["total"], left["next"]["lines"]), (3, []))


if __name__ == "__main__":
    unittest.main()
