"""scoring.py and engines.py against web/src/lib/grading-cases.json, the answers the
browser's review (grades.ts, nodeStrength.ts) is checked against too."""

import json
import unittest
from pathlib import Path

from torre.analysis import engines
from torre.analysis import scoring
CASES = json.loads((Path(__file__).resolve().parents[1] / 'web' / 'src' / 'lib' / 'grading-cases.json').read_text(encoding='utf-8'))


class GradeParityTests(unittest.TestCase):
    def test_judgments(self):
        for case in CASES['judge']:
            with self.subTest(case=case):
                self.assertEqual(scoring.judge(tuple(case['before']), tuple(case['after']), case['white']), case['judgment'])

    def test_win_pct_and_accuracy(self):
        for case in CASES['winPct']:
            self.assertAlmostEqual(scoring.win_pct(case['cp'], case['mate']), case['winPct'], places=9)
        for case in CASES['moveAccuracy']:
            self.assertAlmostEqual(scoring.move_accuracy(case['before'], case['after']), case['accuracy'], places=9)

    def test_node_ratings(self):
        for case in CASES['eloForNodes']:
            self.assertEqual(engines.elo_for_nodes(case['nodes']), case['elo'])
        for case in CASES['nodesForElo']:
            self.assertEqual(engines.nodes_for_elo(case['elo']), case['nodes'])


if __name__ == '__main__':
    unittest.main()
