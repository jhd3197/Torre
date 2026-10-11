// Node-limited strength: an engine searching a fixed number of nodes per move gets stronger
// smoothly as the budget grows, unlike UCI Skill Level's coarse steps. The ratings are
// engines.NODE_ELO_TABLE, read from the same content/grading.json (approximate, for single-threaded Stockfish).
import grading from '../../../torre/content/grading.json';

export const NODE_ELO_TABLE: readonly (readonly [nodes: number, elo: number])[] = grading.nodeElo.map(([nodes, elo]) => [nodes, elo] as const);

/** The node budgets the Arena's Strength picker offers. */
export const NODE_LEVELS = [50, 200, 800, 1600, 3200, 12800, 51200, 204800] as const;

/** The approximate rating of a node budget (log-linear between rows, clamped to the table). */
export function eloForNodes(nodes: number): number {
  const first = NODE_ELO_TABLE[0], last = NODE_ELO_TABLE[NODE_ELO_TABLE.length - 1];
  if (nodes <= first[0]) return first[1];
  for (let i = 1; i < NODE_ELO_TABLE.length; i++) {
    const [n0, e0] = NODE_ELO_TABLE[i - 1], [n1, e1] = NODE_ELO_TABLE[i];
    if (nodes <= n1) return Math.round(e0 + (e1 - e0) * Math.log(nodes / n0) / Math.log(n1 / n0));
  }
  return last[1];
}

/** The node budget for about `elo`, the inverse of eloForNodes. */
export function nodesForElo(elo: number): number {
  const first = NODE_ELO_TABLE[0], last = NODE_ELO_TABLE[NODE_ELO_TABLE.length - 1];
  if (elo <= first[1]) return first[0];
  for (let i = 1; i < NODE_ELO_TABLE.length; i++) {
    const [n0, e0] = NODE_ELO_TABLE[i - 1], [n1, e1] = NODE_ELO_TABLE[i];
    if (elo <= e1) return Math.round(n0 * (n1 / n0) ** ((elo - e0) / (e1 - e0)));
  }
  return last[0];
}
