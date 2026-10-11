"""Puzzles mined from your own games: .venv/Scripts/python -m unittest test_my_puzzles -v"""
import json
import tempfile
import unittest
from pathlib import Path

import chess
import chess.engine

from torre.analysis import analyze
from torre.analysis import engines
from torre.learning import my_puzzles
from torre.learning import puzzles
# White (the user) misses Qxf7# after 3...Nf6?? and plays 4.d3 instead.
PGN = '[White "me"]\n[Black "Bot"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. d3 *'
GAME = {'id': '42', 'type': 'computer', 'date': '2026.10.01', 'opponent': 'Bot', 'user_color': 'white', 'pgn': PGN}
ANALYSIS = {'id': '42', 'scoring_version': analyze.SCORING_VERSION,
            'evals': [[30, None]] * 6 + [[None, 1], [0, None]]}
STOCKFISH = engines.resolve_engine('stockfish')


class FakeEngine:
    """Scores every mating move as mate in 1 and everything else as 0.00."""
    def analyse(self, board, limit, multipv=1):
        infos = []
        for move in board.legal_moves:
            board.push(move)
            score = chess.engine.Mate(1) if board.is_checkmate() else chess.engine.Cp(0)
            board.pop()
            infos.append({'pv': [move], 'score': chess.engine.PovScore(score, board.turn)})
        infos.sort(key=lambda i: i['score'].pov(board.turn), reverse=True)
        return infos[:multipv]


def top(*evs):
    return [(chess.Move.null(), ev) for ev in evs]


class CandidateTests(unittest.TestCase):
    def test_a_missed_mate_is_a_candidate_solved_by_the_user(self):
        self.assertEqual(my_puzzles.candidates(GAME, ANALYSIS), [('missed', 5)])

    def test_a_blunder_is_a_candidate_for_the_opponent(self):
        evals = [[30, None]] * 7 + [[-500, None]]  # 4.d3 drops a piece instead
        self.assertEqual(my_puzzles.candidates(GAME, {**ANALYSIS, 'evals': evals}), [('punish', 6)])

    def test_mismatched_analysis_is_ignored(self):
        self.assertEqual(my_puzzles.candidates(GAME, {**ANALYSIS, 'evals': [[0, None]]}), [])

    def test_only_move(self):
        self.assertTrue(my_puzzles.only_move(top((400, None), (20, None))))
        self.assertTrue(my_puzzles.only_move(top((None, 2), (300, None))))
        self.assertFalse(my_puzzles.only_move(top((150, None), (0, None))))  # not winning enough
        self.assertFalse(my_puzzles.only_move(top((520, None), (500, None))))  # two winning moves
        self.assertFalse(my_puzzles.only_move(top((None, 2), (None, 3))))  # two ways to mate


class MineTests(unittest.TestCase):
    def test_mine_game_builds_a_pack_puzzle(self):
        [item] = my_puzzles.mine_game(FakeEngine(), GAME, ANALYSIS)
        self.assertEqual((item['id'], item['moves'], item['rating']), ('my42-6', ['g8f6', 'h5f7'], 800))
        self.assertEqual(item['themes'], ['myGames', 'mateIn1'])
        self.assertEqual(item['game'], 'https://www.chess.com/game/computer/42?move=6')
        self.assertEqual((item['origin']['kind'], item['origin']['played']), ('missed', 'd3'))
        view = puzzles.view(item)
        self.assertTrue(view['mate'])
        self.assertEqual(view['themes'][0], {'slug': puzzles.MINE, 'title': 'From your games'})

    def test_themes_and_rating_of_a_quiet_fork(self):
        board = chess.Board('r1bqkbnr/ppp3pp/2np1p2/4p3/3P1P2/2B1P3/PPP3PP/RN1QKBNR b KQkq - 1 5')
        board.push_uci('c8e6')
        tags = my_puzzles.themes_of(board, ['d4d5'])
        self.assertEqual(tags, ['myGames', 'fork'])
        self.assertEqual(my_puzzles.rating_of(board, ['d4d5'], tags), 1150)

    def test_endgame_and_back_rank_tags(self):
        board = chess.Board('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1')
        self.assertEqual(my_puzzles.themes_of(board, ['a1a8']), ['myGames', 'mateIn1', 'backRankMate'])
        board = chess.Board('6k1/5ppp/8/8/8/8/1r3PPP/R5K1 w - - 0 1')  # ...Rb8 blocks: no mate, a rook ending
        self.assertEqual(my_puzzles.themes_of(board, ['a1a8']), ['myGames', 'rookEndgame'])

    @unittest.skipUnless(STOCKFISH and STOCKFISH.exists(), 'Stockfish is not installed')
    def test_stockfish_finds_the_back_rank_mate(self):
        board = chess.Board('1q4k1/5ppp/8/8/8/8/1P3PPP/4R1K1 b - - 0 1')
        board.push_uci('b8b2')
        engine = chess.engine.SimpleEngine.popen_uci(str(STOCKFISH))
        try:
            self.assertEqual(my_puzzles.solve(engine, board, depth=12), ['e1e8'])
        finally:
            engine.quit()


class RunTests(unittest.TestCase):
    def test_runs_are_incremental_and_the_pack_loads_as_a_theme(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / 'games.jsonl').write_text(json.dumps(GAME) + '\n', encoding='utf-8')
            (tmp / 'analysis.jsonl').write_text(json.dumps(ANALYSIS) + '\n', encoding='utf-8')
            files = dict(games_file=tmp / 'games.jsonl', analysis_file=tmp / 'analysis.jsonl',
                         pack_file=tmp / 'mine.json', engine=FakeEngine())
            pack, mined = my_puzzles.run(**files)
            self.assertEqual((mined, pack['mined'], len(pack['puzzles'])), (1, ['42'], 1))
            pack, mined = my_puzzles.run(**files)
            self.assertEqual((mined, len(pack['puzzles'])), (0, 1))
            pack, mined = my_puzzles.run(**files, rebuild=True)
            self.assertEqual((mined, len(pack['puzzles'])), (1, 1))

            (tmp / 'bundled').mkdir()
            (tmp / 'bundled' / 'mate-in-1.json').write_text(json.dumps({'version': 1, 'puzzles': []}), encoding='utf-8')
            packs = puzzles.load_packs(tmp / 'bundled', mine=tmp / 'mine.json')
            self.assertEqual(list(packs['themes']), [puzzles.MINE, 'mate-in-1'])
            self.assertEqual(packs['problems'], [])
            info = puzzles.catalog(packs, puzzles.load_state(tmp / 'missing.json'))
            self.assertEqual(info['groups'][0], 'yours')
            self.assertEqual((info['themes'][0]['slug'], info['themes'][0]['count']), (puzzles.MINE, 1))
            self.assertNotIn('yours', puzzles.catalog(puzzles.load_packs(tmp / 'bundled'), puzzles.load_state(tmp / 'x'))['groups'])


if __name__ == '__main__':
    unittest.main()
