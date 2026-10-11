"""The Ladder: one Elo list for every player that has ever met another in the Arena.

Ratings are fitted by maximum likelihood over every finished game in data/arena.jsonl
(Bradley-Terry on the Elo scale, draws as half points), as Bayeselo and Ordo do,
rather than added up match by match. Each pair that met also gets virtual draws (a weak
prior) so a player who won or lost everything still gets a finite rating.

Players who never met, directly or through others, cannot be compared, so each connected
group is rated on its own. A group is placed by, in order: the anchor player, the nominal
ratings of the rating-limited Stockfish bots in it (their UCI_Elo), or an average of BASE.
The 95% intervals come from the Fisher information and are relative to that placement.
"""
import math
from pathlib import Path

from torre import jsonio
BASE = 1500
PRIOR_DRAWS = 1.0                # virtual draws added to every pair that played
NOMINAL_ENGINES = ('stockfish',)  # engines whose "elo" setting is a calibrated rating
SCALE = 400 / math.log(10)        # Elo points per natural-log unit of odds
Z95 = 1.96


def player_id(spec):
    """A stable key for one Arena player: a legend, a model, or an engine at a rating."""
    if spec.get('masterId'):
        key = f"master:{spec['masterId']}"
    elif spec.get('modelId'):
        return f"model:{spec.get('engineId')}/{spec['modelId']}"
    else:
        key = f"engine:{spec.get('engineId') or 'stockfish'}"
    return f"{key}@{spec['elo']}" if spec.get('elo') is not None else key


def nominal(spec):
    """The rating a player is set to play at, when it can anchor the ladder, else None."""
    if spec.get('masterId') or spec.get('modelId') or spec.get('elo') is None:
        return None
    return spec['elo'] if (spec.get('engineId') or 'stockfish') in NOMINAL_ENGINES else None


def game_score(game):
    """The first player's points from one saved game, or None if it never finished."""
    points = {'1-0': 1.0, '0-1': 0.0, '1/2-1/2': 0.5}.get(game.get('result'))
    if points is None:
        return None
    return points if game.get('white', 0) == 0 else 1.0 - points


def collect(records):
    """(players, pairs): who played, and every pair's record from both sides."""
    players, pairs = {}, {}
    for record in records:
        sides = record.get('players') or []
        if len(sides) != 2 or not all(isinstance(s, dict) for s in sides):
            continue
        ids = [player_id(s) for s in sides]
        if ids[0] == ids[1]:
            continue  # a player against itself says nothing about its rating
        for pid, spec in zip(ids, sides):
            info = players.setdefault(pid, {'id': pid, 'nominal': nominal(spec)})
            info['name'] = spec.get('name') or pid  # the latest name wins
        for game in record.get('games') or []:
            score = game_score(game)
            if score is None:
                continue
            for me, them, points in ((ids[0], ids[1], score), (ids[1], ids[0], 1.0 - score)):
                cell = pairs.setdefault(me, {}).setdefault(them, {'games': 0, 'wins': 0, 'draws': 0, 'losses': 0, 'points': 0.0})
                cell['games'] += 1
                cell['points'] += points
                cell['wins' if points == 1 else 'losses' if points == 0 else 'draws'] += 1
    return {pid: p for pid, p in players.items() if pid in pairs}, pairs


def components(ids, pairs):
    """The connected groups of players, each in first-seen order."""
    seen, groups = set(), []
    for start in ids:
        if start in seen:
            continue
        group, stack = [], [start]
        seen.add(start)
        while stack:
            pid = stack.pop()
            group.append(pid)
            for other in pairs.get(pid, {}):
                if other not in seen:
                    seen.add(other)
                    stack.append(other)
        groups.append(sorted(group, key=ids.index))
    return groups


def solve(matrix, vector):
    """x for matrix @ x = vector (Gauss-Jordan with partial pivoting)."""
    n = len(vector)
    rows = [list(matrix[i]) + [vector[i]] for i in range(n)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(rows[r][col]))
        rows[col], rows[pivot] = rows[pivot], rows[col]
        lead = rows[col][col]
        rows[col] = [v / lead for v in rows[col]]
        for r in range(n):
            if r != col and rows[r][col]:
                factor = rows[r][col]
                rows[r] = [a - factor * b for a, b in zip(rows[r], rows[col])]
    return [row[n] for row in rows]


def invert(matrix):
    n = len(matrix)
    columns = [solve(matrix, [1.0 if i == j else 0.0 for i in range(n)]) for j in range(n)]
    return [[columns[j][i] for j in range(n)] for i in range(n)]


def fit(group, pairs, prior=PRIOR_DRAWS, iterations=100):
    """(strengths, covariance) in natural-log units for one connected group, with the
    first player held at 0; Newton's method on the (concave) log-likelihood."""
    index = {pid: i for i, pid in enumerate(group)}
    edges = []
    for pid in group:
        for other, cell in pairs[pid].items():
            if index[pid] < index[other]:
                edges.append((index[pid], index[other], cell['games'] + prior, cell['points'] + prior / 2))
    n = len(group)
    r = [0.0] * n

    def system():
        grad, hess = [0.0] * n, [[0.0] * n for _ in range(n)]
        for i, j, games, points in edges:
            p = 1 / (1 + math.exp(r[j] - r[i]))
            grad[i] += points - games * p
            grad[j] -= points - games * p
            w = games * p * (1 - p)
            hess[i][i] += w
            hess[j][j] += w
            hess[i][j] -= w
            hess[j][i] -= w
        return grad, hess  # hess is the negative Hessian (the Fisher information)

    for _ in range(iterations):
        grad, hess = system()
        step = solve([row[1:] for row in hess[1:]], grad[1:]) if n > 1 else []
        largest = max((abs(s) for s in step), default=0.0)
        damp = min(1.0, 2.0 / largest) if largest else 1.0
        for k, s in enumerate(step, 1):
            r[k] += damp * s
        if largest < 1e-9:
            break
    _, hess = system()
    reduced = invert([row[1:] for row in hess[1:]]) if n > 1 else []
    cov = [[0.0] * n for _ in range(n)]
    for a in range(1, n):
        for b in range(1, n):
            cov[a][b] = reduced[a - 1][b - 1]
    return r, cov


def build_ladder(records, anchor=None, anchor_rating=None, base=BASE, prior=PRIOR_DRAWS):
    """The ladder from Arena match records (see the module docstring for how groups are placed).

    anchor: a player id (see player_id) whose rating is pinned to anchor_rating, else to
    its nominal rating, else to base. Returns {'players': [...] best first, 'pairs':
    {id: {opponent id: {...}}}, 'groups', 'games', 'anchor'}.
    """
    players, pairs = collect(records)
    order = list(players)
    rows = []
    for number, group in enumerate(components(order, pairs)):
        r, cov = fit(group, pairs, prior)
        n = len(group)
        if anchor in group:
            weights = [1.0 if pid == anchor else 0.0 for pid in group]
            target = anchor_rating if anchor_rating is not None else players[anchor]['nominal'] or base
            how = 'anchor'
        elif any(players[pid]['nominal'] is not None for pid in group):
            rated = [pid for pid in group if players[pid]['nominal'] is not None]
            weights = [1 / len(rated) if pid in rated else 0.0 for pid in group]
            target = sum(players[pid]['nominal'] for pid in rated) / len(rated)
            how = 'nominal'
        else:
            weights, target, how = [1 / n] * n, base, 'average'
        # rating_i = target + SCALE * (r_i - w.r); its variance is C_ii - 2(Cw)_i + w'Cw.
        center = sum(w * v for w, v in zip(weights, r))
        cw = [sum(cov[i][k] * weights[k] for k in range(n)) for i in range(n)]
        wcw = sum(w * c for w, c in zip(weights, cw))
        for i, pid in enumerate(group):
            rating = target + SCALE * (r[i] - center)
            spread = Z95 * SCALE * math.sqrt(max(0.0, cov[i][i] - 2 * cw[i] + wcw))
            record = pairs[pid].values()
            games = sum(c['games'] for c in record)
            points = sum(c['points'] for c in record)
            rows.append({**players[pid], 'rating': round(rating), 'ci_low': round(rating - spread),
                         'ci_high': round(rating + spread), 'games': games, 'points': points,
                         'score': round(100 * points / games, 1),
                         'wins': sum(c['wins'] for c in record), 'draws': sum(c['draws'] for c in record),
                         'losses': sum(c['losses'] for c in record), 'group': number, 'placed_by': how,
                         '_exact': rating})
    exact = {row['id']: row.pop('_exact') for row in rows}
    rows.sort(key=lambda row: (-exact[row['id']], row['name']))
    head = {me: {them: {**cell, 'score': round(100 * cell['points'] / cell['games'], 1),
                        'expected': round(100 / (1 + 10 ** ((exact[them] - exact[me]) / 400)), 1)}
                 for them, cell in opponents.items()} for me, opponents in pairs.items()}
    return {'players': rows, 'pairs': head, 'groups': len({row['group'] for row in rows}),
            'games': sum(row['games'] for row in rows) // 2,
            'anchor': anchor if anchor in players else None}


def read_records(path):
    """Every readable match record in an arena.jsonl (or a data folder holding one)."""
    path = Path(path)
    if path.is_dir():
        path = path / 'arena.jsonl'
    return jsonio.read_records(path)


def load_ladder(path, anchor=None, **options):
    """build_ladder over the matches saved at path (an arena.jsonl or its data folder)."""
    return build_ladder(read_records(path), anchor=anchor, **options)
