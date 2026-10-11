import { eloForNodes, NODE_ELO_TABLE, NODE_LEVELS, nodesForElo } from './nodeStrength';

test('the node table maps both ways and clamps at its ends', () => {
  for (const [nodes, elo] of NODE_ELO_TABLE) {
    expect(eloForNodes(nodes)).toBe(elo);
    expect(nodesForElo(elo)).toBe(nodes);
  }
  expect(eloForNodes(1)).toBe(1200);
  expect(eloForNodes(1e8)).toBe(3150);
  expect(nodesForElo(800)).toBe(50);
  expect(eloForNodes(nodesForElo(1725))).toBe(1725);
});

test('the offered node levels get stronger step by step', () => {
  const ratings = NODE_LEVELS.map(eloForNodes);
  expect(ratings).toEqual([...ratings].sort((a, b) => a - b));
  expect(new Set(ratings).size).toBe(ratings.length);
});
