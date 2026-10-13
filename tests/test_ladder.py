"""The Elo ladder: .venv/Scripts/python -m unittest test_ladder -v"""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from torre.learning import ladder
def sf(elo=None):
    return {'name': f'Stockfish {elo}' if elo else 'Stockfish', 'engineId': 'stockfish', 'modelId': None,
            'masterId': None, 'elo': elo}


def legend(master_id, elo):
    return {'name': master_id, 'engineId': 'stockfish', 'modelId': None, 'masterId': master_id, 'elo': elo}


def maia(level):
    return {'name': f'Maia {level}', 'engineId': 'lc0', 'modelId': f'maia-{level}', 'masterId': None, 'elo': None}


def ai(model, level=0, effort=None):
    """An AI seat as arena.AiPlayer.describe() saves it: no engine, model or legend of its own."""
    return {'name': model.split('/', 1)[1], 'engineId': None, 'modelId': None, 'masterId': None, 'elo': None,
            'ai': {'model': model, 'level': level, 'effort': effort}}


def match(a, b, wins=0, draws=0, losses=0):
    """A record like arena.py saves: wins/draws/losses are the first player's, colors alternate."""
    results = ['W'] * wins + ['D'] * draws + ['L'] * losses
    games = []
    for number, outcome in enumerate(results):
        white = number % 2
        first = {'W': 1.0, 'D': 0.5, 'L': 0.0}[outcome]
        white_points = first if white == 0 else 1 - first
        games.append({'number': number + 1, 'white': white, 'result': {1.0: '1-0', 0.5: '1/2-1/2', 0.0: '0-1'}[white_points]})
    return {'id': f'{a["name"]}-{b["name"]}', 'players': [a, b], 'games': games, 'score': [wins + draws / 2, losses + draws / 2]}


def by_id(board):
    return {row['id']: row for row in board['players']}


class LadderTests(unittest.TestCase):
    def test_player_ids_and_nominal_ratings(self):
        self.assertEqual(ladder.player_id(sf(1500)), 'engine:stockfish@1500')
        self.assertEqual(ladder.player_id(sf()), 'engine:stockfish')
        self.assertEqual(ladder.player_id(legend('Carlsen', 2882)), 'master:Carlsen@2882')
        self.assertEqual(ladder.player_id(maia(1100)), 'model:lc0/maia-1100')
        self.assertEqual(ladder.nominal(sf(1500)), 1500)
        for spec in (sf(), legend('Carlsen', 2882), maia(1100), {**sf(2000), 'engineId': 'other'}):
            self.assertIsNone(ladder.nominal(spec))

    def test_scores_follow_colors(self):
        self.assertEqual(ladder.game_score({'white': 0, 'result': '1-0'}), 1.0)
        self.assertEqual(ladder.game_score({'white': 1, 'result': '1-0'}), 0.0)
        self.assertEqual(ladder.game_score({'white': 1, 'result': '1/2-1/2'}), 0.5)
        self.assertIsNone(ladder.game_score({'white': 0, 'result': '*'}))

    def test_an_even_match_puts_both_at_the_base(self):
        board = ladder.build_ladder([match(maia(1100), maia(1500), wins=3, draws=4, losses=3)])
        for row in board['players']:
            self.assertEqual(row['rating'], 1500)
            self.assertEqual((row['games'], row['score'], row['placed_by']), (10, 50.0, 'average'))
            self.assertLess(row['ci_low'], 1500)
            self.assertGreater(row['ci_high'], 1500)
        self.assertEqual(board['games'], 10)

    def test_ratings_match_the_score_gap(self):
        # 75% with a prior draw: 15.5/21 is a gap near 400*log10(15.5/5.5) = 180.
        board = ladder.build_ladder([match(maia(1900), maia(1100), wins=12, draws=6, losses=2)])
        top, bottom = board['players']
        self.assertEqual(top['id'], 'model:lc0/maia-1900')
        self.assertAlmostEqual(top['rating'] - bottom['rating'], 180, delta=2)
        self.assertAlmostEqual((top['rating'] + bottom['rating']) / 2, 1500, delta=1)
        self.assertEqual((top['wins'], top['draws'], top['losses'], top['score']), (12, 6, 2, 75.0))

    def test_a_perfect_score_stays_finite(self):
        board = ladder.build_ladder([match(legend('Carlsen', 2882), sf(2500), wins=10)])
        top, bottom = board['players']
        self.assertEqual(top['score'], 100.0)
        self.assertGreater(top['rating'], bottom['rating'] + 300)
        self.assertLess(top['rating'], bottom['rating'] + 1200)

    def test_nominal_bots_place_the_group(self):
        records = [match(sf(1500), sf(2000), wins=2, draws=4, losses=14), match(maia(1100), sf(1500), wins=5, draws=2, losses=5)]
        rows = by_id(ladder.build_ladder(records))
        self.assertEqual(rows['engine:stockfish@1500']['placed_by'], 'nominal')
        mean = (rows['engine:stockfish@1500']['rating'] + rows['engine:stockfish@2000']['rating']) / 2
        self.assertAlmostEqual(mean, 1750, delta=1)
        self.assertAlmostEqual(rows['model:lc0/maia-1100']['rating'], rows['engine:stockfish@1500']['rating'], delta=2)

    def test_the_anchor_is_pinned_with_no_spread(self):
        records = [match(sf(1500), maia(1500), wins=6, draws=2, losses=4)]
        rows = by_id(ladder.build_ladder(records, anchor='model:lc0/maia-1500', anchor_rating=1600))
        pinned = rows['model:lc0/maia-1500']
        self.assertEqual((pinned['rating'], pinned['ci_low'], pinned['ci_high'], pinned['placed_by']), (1600, 1600, 1600, 'anchor'))
        self.assertGreater(rows['engine:stockfish@1500']['rating'], 1600)
        self.assertEqual(ladder.build_ladder(records, anchor='engine:stockfish@1500')['players'][0]['rating'], 1500)

    def test_more_games_narrow_the_interval(self):
        few = ladder.build_ladder([match(maia(1), maia(2), wins=2, losses=2)])['players'][0]
        many = ladder.build_ladder([match(maia(1), maia(2), wins=20, losses=20)])['players'][0]
        self.assertLess(many['ci_high'] - many['ci_low'], few['ci_high'] - few['ci_low'])

    def test_unconnected_groups_are_rated_apart(self):
        records = [match(sf(1500), sf(2000), wins=1, losses=9), match(maia(1), maia(2), wins=5, losses=5)]
        board = ladder.build_ladder(records, anchor='engine:stockfish@2000')
        rows = by_id(board)
        self.assertEqual(board['groups'], 2)
        self.assertEqual(rows['engine:stockfish@2000']['rating'], 2000)
        self.assertNotEqual(rows['model:lc0/maia-1']['group'], rows['engine:stockfish@2000']['group'])
        self.assertEqual((rows['model:lc0/maia-1']['rating'], rows['model:lc0/maia-1']['placed_by']), (1500, 'average'))

    def test_a_chain_orders_transitively(self):
        records = [match(maia(3), maia(2), wins=8, draws=2), match(maia(2), maia(1), wins=8, draws=2)]
        board = ladder.build_ladder(records)
        self.assertEqual([row['id'][-1] for row in board['players']], ['3', '2', '1'])
        self.assertNotIn('model:lc0/maia-1', board['pairs']['model:lc0/maia-3'])  # they never met
        head = board['pairs']['model:lc0/maia-3']['model:lc0/maia-2']
        self.assertEqual((head['games'], head['wins'], head['draws'], head['losses'], head['score']), (10, 8, 2, 0, 90.0))
        self.assertGreater(head['expected'], 50)
        back = board['pairs']['model:lc0/maia-2']['model:lc0/maia-3']
        self.assertEqual((back['losses'], back['score']), (8, 10.0))
        self.assertAlmostEqual(head['expected'] + back['expected'], 100, delta=0.2)

    def test_self_play_and_unfinished_games_are_skipped(self):
        records = [match(sf(1500), sf(1500), wins=3), {'players': [sf(1500), sf(2000)], 'games': [{'white': 0, 'result': None}]},
                   {'players': [sf(1500)]}, {'nope': 1}]
        board = ladder.build_ladder(records)
        self.assertEqual((board['players'], board['games'], board['groups']), ([], 0, 0))

    def test_load_ladder_reads_the_data_folder(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, True)
        lines = [json.dumps(match(sf(1500), sf(2000), wins=3, losses=7)), 'not json', json.dumps(match(sf(2000), sf(2500), wins=4, losses=6))]
        (folder / 'arena.jsonl').write_text('\n'.join(lines) + '\n', encoding='utf-8')
        board = ladder.load_ladder(folder)
        self.assertEqual(board, ladder.load_ladder(folder / 'arena.jsonl'))
        self.assertEqual([row['id'] for row in board['players']], ['engine:stockfish@2500', 'engine:stockfish@2000', 'engine:stockfish@1500'])
        self.assertEqual(board['players'][1]['games'], 20)
        self.assertEqual(ladder.load_ladder(folder / 'missing')['players'], [])

    def test_ai_players_are_rated_by_model_level_and_effort(self):
        claude, gpt = ai('claude/claude-fable-5-1', effort='high'), ai('openai/gpt-6-astra', effort='high')
        self.assertEqual(ladder.player_id(claude), 'ai:claude/claude-fable-5-1@L0/high')
        self.assertEqual(ladder.player_id(ai('claude/claude-fable-5-1', level=3)), 'ai:claude/claude-fable-5-1@L3')
        self.assertIsNone(ladder.nominal(claude))
        # Not Stockfish: two models used to share its id, and their match was dropped as self-play.
        duel = {**match(claude, gpt, wins=1, losses=1), 'cost': [3.5, 1.25]}
        stockfish = {**match(ai('claude/claude-fable-5-1', effort='max'), sf(1500), losses=2), 'cost': [4.0, 0.0]}
        board = by_id(ladder.build_ladder([duel, stockfish, match(claude, gpt, wins=1, draws=1)]))
        mine = board['ai:claude/claude-fable-5-1@L0/high']
        self.assertEqual(mine['ai'], {'model': 'claude/claude-fable-5-1', 'level': 0, 'effort': 'high'})
        self.assertEqual((mine['games'], mine['wins'], mine['draws'], mine['losses']), (4, 2, 1, 1))
        self.assertEqual((mine['cost'], mine['cost_games']), (3.5, 2))  # the match without a cost adds no games
        self.assertEqual(board['ai:openai/gpt-6-astra@L0/high']['cost'], 1.25)
        maxed = board['ai:claude/claude-fable-5-1@L0/max']
        self.assertEqual((maxed['placed_by'], maxed['cost'], maxed['cost_games']), ('nominal', 4.0, 2))
        self.assertLess(maxed['rating'], 1500)
        self.assertIsNone(board['engine:stockfish@1500']['ai'])
        self.assertNotIn('cost', board['engine:stockfish@1500'])


if __name__ == '__main__':
    unittest.main()
