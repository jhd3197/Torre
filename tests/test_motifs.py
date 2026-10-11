"""Tactical blind spots: .venv/Scripts/python -m unittest test_motifs -v"""
import unittest

import chess

from torre.analysis import game_stats
from torre.analysis import motifs
from tests.test_training import PGN, record

GAME = {"id": "1", "pgn": PGN, "user_color": "black", "date": "2026.09.01", "opponent": "Bot"}


class MotifTests(unittest.TestCase):
    def test_a_blunder_that_allows_mate(self):
        out = motifs.build([GAME], {"1": record()})
        self.assertEqual(out["errors"], 1)  # 3...Nf6?? only; 1...e5 is an inaccuracy
        self.assertEqual([(r["tag"], r["slug"], r["count"]) for r in out["allowed"]], [("mateIn1", "mate-in-1", 1)])
        self.assertEqual(out["allowed"][0]["examples"][0]["ply"], 6)
        self.assertEqual(out["missed"], [])  # ...g6 holds, but it is no tactic

    def test_tags_for_reads_the_move_and_a_mate_the_eval_sees(self):
        board = chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1")
        self.assertEqual(motifs.tags_for(board, "a1a8", [None, 1]), ["mateIn1", "backRankMate"])
        quiet = chess.Board()
        self.assertEqual(motifs.tags_for(quiet, "e2e4", [None, 3]), ["mateIn3"])  # a mate for White the eval sees
        self.assertEqual(motifs.tags_for(quiet, "e2e4", [None, -3]), [])  # a mate for the other side is not this move's
        self.assertEqual(motifs.tags_for(quiet, "e2e5", [20, None]), [])  # illegal
        hanging = chess.Board("4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1")
        self.assertEqual(motifs.tags_for(hanging, "d1d5", [500, None]), ["hangingPiece"])

    def test_skips_games_without_matching_analysis(self):
        self.assertEqual(motifs.build([GAME], {}), {"errors": 0, "games": 0, "missed": [], "allowed": []})
        self.assertEqual(motifs.build([GAME], {"1": {**record(), "evals": [[0, None]]}})["errors"], 0)

    def test_trend_compares_recent_games_with_earlier_ones(self):
        self.assertIsNone(motifs.trend(1, 10, 5, 100))  # too few recent games
        self.assertEqual(motifs.trend(1, 40, 20, 100), {"recent": 0.2, "earlier": 2.0, "direction": "better"})
        self.assertEqual(motifs.trend(12, 40, 10, 100)["direction"], "worse")
        self.assertIsNone(motifs.trend(4, 40, 10, 100)["direction"])  # about the same rate
        self.assertIsNone(motifs.trend(0, 40, 2, 100)["direction"])  # too few cases to tell

    def test_trend_windows_are_the_newest_games(self):
        games = [{**GAME, "id": str(i), "date": f"2026.{1 + i // 28:02d}.{1 + i % 28:02d}"} for i in range(60)]
        out = motifs.build(games, {str(i): record(i) for i in range(60)})
        self.assertEqual((out["games"], out["errors"]), (60, 60))
        self.assertEqual(out["allowed"][0]["trend"], {"recent": 10.0, "earlier": 10.0, "direction": None})

    def test_stats_carry_the_motifs(self):
        self.assertEqual(game_stats.build_stats([GAME], {"1": record()})["motifs"]["allowed"][0]["tag"], "mateIn1")
