"""Game analytics checks: .venv/Scripts/python -m unittest test_game_stats -v"""
import json
import math
import random
import tempfile
import unittest
from pathlib import Path

import chess

from torre.analysis import game_stats as gs
from torre.analysis import scoring
PGN = """[Event "Test"]
[White "me"]
[Black "them"]
[Result "0-1"]
[ECO "C20"]
[TimeControl "60+1"]

1. e4 {[%clk 0:00:59]} e5 {[%clk 0:00:58]} 2. Qh5 {[%clk 0:00:20]} Nc6 {[%clk 0:00:55]}
3. Bc4 {[%clk 0:00:05]} Nf6 {[%clk 0:00:50]} 4. Qxf7# {[%clk 0:00:04]} 0-1
"""


def record(**kw):
    rec = {"id": "g1", "type": "live", "date": "2026.10.01", "end_time_unix": 1_000_000, "time_control": "60+1",
           "user_color": "white", "user_result": 1, "user_rating": 800, "opp_rating": 900, "pgn": PGN}
    rec.update(kw)
    return rec


def analysis(**kw):
    # Start, then after each of the 7 plies (White POV); ply 5 (Bc4) blunders.
    rec = {"id": "g1", "scoring_version": 2,
           "evals": [[30, None], [30, None], [30, None], [-20, None], [-20, None], [-500, None], [-500, None],
                     [-100000, None]]}
    rec.update(kw)
    return rec


class FormulaTests(unittest.TestCase):
    def test_lichess_formulas(self):
        self.assertAlmostEqual(gs.win_pct(200), 50 + 50 * (2 / (1 + math.exp(-0.00368208 * 200)) - 1))
        raw = 103.1668100711649 * math.exp(-0.04354415386753951 * 15) - 3.166924740191411
        self.assertAlmostEqual(gs.move_accuracy(60, 45), raw + 1)
        self.assertEqual(gs.move_accuracy(100, 0), 0)

    def test_weights_reproduce_game_accuracy(self):
        rng = random.Random(7)
        for plies in (1, 9, 25, 80):
            timeline = [rng.uniform(5, 95) for _ in range(plies + 1)]
            weights = gs.volatility_weights(timeline)
            self.assertEqual(len(weights), plies)
            expected = scoring.game_accuracy(timeline)
            for color, parity in (("white", 0), ("black", 1)):
                pairs = []
                for i in range(parity, plies, 2):
                    b, a = timeline[i], timeline[i + 1]
                    b, a = (b, a) if parity == 0 else (100 - b, 100 - a)
                    pairs.append((gs.move_accuracy(b, a), weights[i]))
                self.assertAlmostEqual(gs.aggregate_accuracy(pairs) or None, expected[color])

    def test_aggregate_empty(self):
        self.assertIsNone(gs.aggregate_accuracy([]))


class PhaseTests(unittest.TestCase):
    def test_start_and_move_cap(self):
        board = chess.Board()
        self.assertEqual(gs.position_phase(board), "opening")
        board.fullmove_number = 13
        self.assertEqual(gs.position_phase(board), "middlegame")

    def test_material_endgames(self):
        self.assertEqual(gs.position_phase(chess.Board("4k3/pp3r2/8/8/8/8/PP3R2/4K3 w - - 0 20")), "endgame")
        # Queens off, two rooks and two minors each: 32 points, still a middlegame.
        self.assertEqual(gs.position_phase(chess.Board("r3kbnr/pp3ppp/8/8/8/8/PP3PPP/R3KBNR w - - 0 20")),
                         "middlegame")
        # Queens off, rook and minor each: 16 points.
        self.assertEqual(gs.position_phase(chess.Board("4kb1r/pp3ppp/8/8/8/8/PP3PPP/4KB1R w - - 0 9")), "endgame")

    def test_never_goes_back(self):
        self.assertEqual(gs.position_phase(chess.Board(), "endgame"), "endgame")
        self.assertEqual(gs.position_phase(chess.Board(), "middlegame"), "middlegame")


class TimeTests(unittest.TestCase):
    def test_clock_deltas_with_increment(self):
        rec = record()
        times = gs.move_times(gs.parse_game(rec), rec)
        self.assertEqual([t["elapsed_s"] for t in times], [2, 3, 40, 4, 16, 6, 2])
        self.assertEqual(times[4]["clock_s"], 20)  # Bc4 decided with 20s left
        self.assertTrue(all(t["source"] == "clock_delta" for t in times))

    def test_emt_and_play_timings(self):
        pgn = PGN.replace("[%clk 0:00:59]", "[%emt 0:00:07]")
        rec = record(pgn=pgn, timings=[{"ply": 3, "uci": "d1h5", "elapsed_ms": 1500, "source": "ui_active",
                                        "partial": False},
                                       {"ply": 5, "elapsed_ms": 9000, "source": "ui_active", "partial": True}])
        times = gs.move_times(gs.parse_game(rec), rec)
        self.assertEqual((times[0]["elapsed_s"], times[0]["source"]), (7, "pgn_emt"))
        self.assertEqual((times[2]["elapsed_s"], times[2]["source"]), (1.5, "ui_active"))
        self.assertEqual(times[4]["source"], "clock_delta")  # partial observation dropped

    def test_chesscom_timestamps(self):
        pgn = "\n".join(line.split(" {")[0] if False else line for line in PGN.splitlines())
        plain = "[TimeControl \"60\"]\n\n1. e4 e5 2. Nf3 Nc6 *\n"
        rec = record(pgn=plain, time_control="60", move_timestamps="580,595,500,590,499")
        times = gs.move_times(gs.parse_game(rec), rec)
        self.assertEqual([t["elapsed_s"] for t in times], [2, 0.5, 8, 0.5])

    def test_unknown_control_stays_unknown(self):
        rec = record(time_control="?", pgn=PGN.replace('[TimeControl "60+1"]', '[TimeControl "?"]'))
        self.assertTrue(all(t["elapsed_s"] is None for t in gs.move_times(gs.parse_game(rec), rec)))

    def test_buckets(self):
        self.assertEqual(gs.think_bucket(1.9), "<2s")
        self.assertEqual(gs.think_bucket(75), "60s+")
        self.assertEqual(gs.clock_bucket(25, 0.9), "time_trouble")
        self.assertEqual(gs.clock_bucket(50, 0.08), "time_trouble")
        self.assertEqual(gs.clock_bucket(100, 0.2), "low")
        self.assertEqual(gs.clock_bucket(400, 0.7), "plenty")


class GameMovesTests(unittest.TestCase):
    def test_user_moves(self):
        moves = gs.game_moves(record(), analysis())
        self.assertEqual([m["ply"] for m in moves], [1, 3, 5, 7])
        bc4 = moves[2]
        self.assertEqual(bc4["class"], scoring.BLUNDER)
        self.assertEqual(bc4["cpl"], 480)
        self.assertEqual(bc4["elapsed_s"], 16)
        self.assertIsNone(moves[3]["class"])  # mating move is never judged
        self.assertTrue(all(m["phase"] == "opening" for m in moves))

    def test_black_pov_and_mismatch(self):
        moves = gs.game_moves(record(user_color="black"), analysis())
        self.assertEqual([m["ply"] for m in moves], [2, 4, 6])
        self.assertEqual(moves[2]["win_after"], 100 - gs.win_pct(-500))
        self.assertEqual(gs.game_moves(record(), analysis(evals=[[0, None]] * 3)), [])

    def test_played_record(self):
        played = {"id": "p1", "date": "2026.10.04", "user_color": "black", "result": "0-1", "bot_id": "kwame",
                  "elo": 380, "initialFen": chess.STARTING_FEN, "moves": ["e2e4", "e7e5"]}
        rec = gs.normalize_game(played)
        self.assertEqual((rec["user_result"], rec["opponent"], rec["opp_rating"]), (1, "kwame", 380))
        moves = gs.game_moves(rec, {"evals": [[20, None], [40, None], [30, None]]})
        self.assertEqual([m["ply"] for m in moves], [2])


class BreakdownTests(unittest.TestCase):
    def fake(self, move_number, cls=None, phase="middlegame", cpl=0):
        return {"move_number": move_number, "class": cls, "phase": phase, "cpl": cpl, "accuracy": 90, "weight": 1,
                "elapsed_s": None, "clock_s": None, "clock_frac": None, "time_source": None}

    def test_heatmap(self):
        moves = [self.fake(n) for n in range(1, 30)] + [self.fake(7, "blunder"), self.fake(64, "mistake", "endgame")]
        heat = gs.error_heatmap(moves)
        rows = {r["bucket"]: r for r in heat["by_move"]}
        self.assertEqual(rows["6-10"]["blunder"], 1)
        self.assertEqual(rows["6-10"]["moves"], 6)
        self.assertEqual(rows["61+"]["mistake"], 1)
        self.assertEqual(heat["by_phase"]["endgame"]["mistake"], 1)
        self.assertEqual(heat["peak"], "61+")  # no bucket has 10 moves, so all compete
        self.assertEqual(gs.move_bucket(60), "56-60")

    def test_time_trouble_split(self):
        moves = []
        for i in range(10):
            m = self.fake(30, "blunder" if i < 5 else None)
            m.update(elapsed_s=1, clock_s=20, clock_frac=0.05, time_source="clock_delta")
            moves.append(m)
            m = self.fake(10)
            m.update(elapsed_s=12, clock_s=500, clock_frac=0.8, time_source="clock_delta")
            moves.append(m)
        t = gs.time_stats(moves)
        self.assertEqual(t["time_trouble"]["in"]["blunder_rate"], 50)
        self.assertEqual(t["time_trouble"]["out"]["blunder_rate"], 0)
        self.assertEqual([r["bucket"] for r in t["by_think_time"]], ["<2s", "10-30s"])
        self.assertEqual(t["avg_think_s"]["blunder"], 1)

    def test_phase_stats_means_games(self):
        a = [dict(self.fake(5, phase="opening"), accuracy=100), dict(self.fake(20), accuracy=50)]
        b = [dict(self.fake(5, phase="opening"), accuracy=80)]
        stats = gs.phase_stats([a, b])
        self.assertEqual(stats["opening"]["accuracy"], 90)
        self.assertEqual(stats["opening"]["games"], 2)
        self.assertEqual(stats["middlegame"]["games"], 1)
        self.assertIsNone(gs.phase_stats([])["endgame"]["accuracy"])

    def test_performance(self):
        games = [record(id=1, user_result=1), record(id=2, user_result=0, user_color="black", opp_rating=1200),
                 record(id=3, user_result=0.5, time_control="180+2", pgn=PGN.replace("C20", "D02"))]
        perf = gs.performance(games)
        self.assertEqual(perf["overall"]["score_pct"], 50)
        self.assertEqual(perf["by_color"]["white"]["games"], 2)
        self.assertEqual(perf["by_rating"]["much_higher"]["losses"], 1)
        self.assertEqual(perf["by_time_control"]["blitz"]["draws"], 1)
        self.assertEqual(perf["by_opening"][0]["eco"], "C20")
        self.assertEqual(gs.time_class("600"), "rapid")
        self.assertEqual(gs.time_class("1/259200"), "daily")
        self.assertEqual(gs.rating_bucket(-50), "similar")


class TiltTests(unittest.TestCase):
    def game(self, i, t, score, acc=None, date="2026.10.01"):
        return {"id": i, "end_time_unix": t, "date": date, "score": score, "accuracy": acc}

    def test_sessions(self):
        games = [self.game(1, 0, 1), self.game(2, 600, 0), self.game(3, 600 + 46 * 60, 1),
                 self.game(4, 600 + 47 * 60, 1, date="2026.10.02"), self.game(5, None, 1)]
        self.assertEqual([[g["id"] for g in s] for s in gs.sessions(games)], [[1, 2], [3], [4]])

    def test_flags_declining_streak_and_recommends(self):
        games, t = [], 0
        for day in range(4):  # each session: win, then three losses with falling accuracy, then a loss
            date = f"2026.10.0{day + 1}"
            for score, acc in ((1, 85), (0, 80), (0, 72), (0, 60), (1, 70)):
                t += 600
                games.append(self.game(len(games), t, score, acc, date))
            t += 86400
        result = gs.tilt(games)
        self.assertEqual(len(result["flagged"]), 4)
        self.assertEqual(result["flagged"][0]["streaks"][0]["accuracy_drop"], 20)
        self.assertEqual(result["recommendation"]["break_after_losses"], 1)
        self.assertIn("Take a break after 1 loss", result["recommendation"]["text"])

    def test_no_recommendation_without_evidence(self):
        games = [self.game(i, i * 600, 1, 80) for i in range(5)]
        rec = gs.tilt(games)["recommendation"]
        self.assertEqual(rec, {"break_after_losses": None, "text": None})


class BuildStatsTests(unittest.TestCase):
    def test_shape_and_json(self):
        games = [record(), record(id="g2", user_result=0, end_time_unix=1_000_300, user_accuracy=70.0)]
        stats = gs.build_stats(games, [analysis()])
        json.dumps(stats)
        for key in ("accuracy", "heatmap", "time", "tilt", "performance", "per_game", "summary", "phase_method"):
            self.assertIn(key, stats)
        self.assertEqual(stats["counts"], {"games": 2, "analyzed": 1, "timed_games": 1})
        self.assertEqual(stats["accuracy"]["overall"]["blunder"], 1)
        self.assertEqual(stats["time"]["timed_moves"], 4)
        timeline = [gs.win_pct(scoring.STANDARD_START_CP)] + [gs.win_pct(*e) for e in analysis()["evals"][1:]]
        self.assertEqual(stats["per_game"][0]["accuracy"], round(scoring.game_accuracy(timeline)["white"], 1))
        self.assertIsInstance(stats["summary"]["weaknesses"], list)

    def test_load_stats(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            (d / "games.jsonl").write_text(json.dumps(record()) + "\n", encoding="utf-8")
            (d / "analysis.jsonl").write_text(json.dumps(analysis(scoring_version=1, evals=[])) + "\n"
                                              + json.dumps(analysis()) + "\nnot json\n", encoding="utf-8")
            stats = gs.load_stats(d)
        self.assertEqual(stats["counts"]["analyzed"], 1)

    def test_empty(self):
        stats = gs.build_stats([], [])
        json.dumps(stats)
        self.assertEqual(stats["summary"]["weaknesses"], [])


if __name__ == "__main__":
    unittest.main()
