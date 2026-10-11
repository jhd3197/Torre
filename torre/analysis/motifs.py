"""Tactical blind spots: which tactics your mistakes and blunders missed, and which they allowed.

    .venv/Scripts/python motifs.py          # print the counts for data/

For every analyzed move of yours judged a mistake or blunder, two moves are
read with the puzzle tagger (my_puzzles.themes_of, the same cheap Lichess-style
tags the mined puzzles get):

- missed: the engine's move in the position you faced (analysis best_moves),
  the tactic you could have played;
- allowed: the engine's reply after your move, the tactic you let your
  opponent play.

A forced mate the stored eval sees (mate in 1 to 4) is tagged as such even
when the single move is not mate yet. Each tag maps to the puzzle theme that
trains it (puzzles.TAG_TO_SLUG), so the Insights page and the coach can send
you to the right puzzles. Moves without a tag (positional errors) only count
toward the total.

Each tag also gets a trend: how often it happens per 10 games in your last
RECENT analyzed games against the games before, 'better' or 'worse' when the
rate moved by a third or more (with enough games and cases on both sides).
"""
import json
from collections import Counter

import chess

from torre.learning import my_puzzles
from torre.learning import puzzles
from torre.analysis import scoring
from torre.analysis.game_moves import parse_game

ERRORS = ('mistake', 'blunder')
# Tags worth reporting, in the order ties are shown.
MOTIFS = ('mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'backRankMate', 'hangingPiece', 'fork', 'promotion')
MATE_TAGS = {1: 'mateIn1', 2: 'mateIn2', 3: 'mateIn3', 4: 'mateIn4'}
EXAMPLES = 3
RECENT = 40          # the newest analyzed games that make the recent window
TREND_MIN_GAMES = 20  # games each window needs before a trend is shown
TREND_MIN_CASES = 3   # cases (both windows together) a tag needs for a trend
TREND_RATIO = 1.5    # how far the rate must move: below 1/1.5 is better, above 1.5 worse


def _mate_tag(ev, color):
    """'mateInN' when the White-POV [cp, mate] eval is a mate in 1-4 for `color`, else None."""
    mate = ev[1] if ev and len(ev) > 1 else None
    if not mate or (mate > 0) != (color == chess.WHITE):
        return None
    return MATE_TAGS.get(abs(mate))


def tags_for(board, uci, ev):
    """Motif tags for playing `uci` on `board` (side to move), plus a mate the eval `ev` sees."""
    if not uci:
        return []
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        return []
    if move not in board.legal_moves:
        return []
    tags = set(my_puzzles.themes_of(board, [uci]))
    mate = _mate_tag(ev, board.turn)
    if mate and not any(t.startswith('mateIn') for t in tags):
        tags.add(mate)
    return [t for t in MOTIFS if t in tags]


def game_motifs(rec, analysis):
    """[(kind, tag, example)] for one game's mistakes and blunders; kind is 'missed' or 'allowed'."""
    parsed = parse_game(rec)
    evals, best = analysis.get('evals') or [], analysis.get('best_moves') or []
    if parsed is None or len(evals) != len(parsed['moves']) + 1 or rec.get('user_color') not in ('white', 'black'):
        return []
    user = chess.WHITE if rec['user_color'] == 'white' else chess.BLACK
    board, found = parsed['board'].copy(), []
    for i, move in enumerate(parsed['moves']):
        # Mistakes and blunders, and forced mates let go (graded as no worse than an inaccuracy
        # while the game stays won, but a mate missed all the same).
        if board.turn == user and (scoring.judge(evals[i], evals[i + 1], user == chess.WHITE) in ERRORS
                                   or scoring.missed_mate(evals[i], evals[i + 1], user == chess.WHITE)):
            example = {'game_id': rec.get('id'), 'ply': i + 1, 'fen': board.fen(), 'date': rec.get('date'),
                       'opponent': rec.get('opponent')}
            if i < len(best) and best[i] != move.uci():
                found += [('missed', tag, example) for tag in tags_for(board, best[i], evals[i])]
            after = board.copy(stack=False)
            after.push(move)
            if i + 1 < len(best):
                found += [('allowed', tag, {**example, 'fen': after.fen()}) for tag in tags_for(after, best[i + 1], evals[i + 1])]
            found.append(('error', None, None))
        board.push(move)
    return found


def trend(recent, recent_games, earlier, earlier_games):
    """{'recent', 'earlier'} per 10 games and 'direction' ('better', 'worse' or None) for one tag."""
    if recent_games < TREND_MIN_GAMES or earlier_games < TREND_MIN_GAMES:
        return None
    now, before = 10 * recent / recent_games, 10 * earlier / earlier_games
    direction = None
    if recent + earlier >= TREND_MIN_CASES:
        if now * TREND_RATIO <= before:
            direction = 'better'
        elif now >= before * TREND_RATIO and recent >= 2:
            direction = 'worse'
    return {'recent': round(now, 1), 'earlier': round(before, 1), 'direction': direction}


def build(games, analysis_by_id):
    """{'errors', 'games', 'missed': [...], 'allowed': [...]}; each row {tag, slug, count, trend, examples},
    most frequent first."""
    analyzed = sorted((rec for rec in games if analysis_by_id.get(rec.get('id'))),
                      key=lambda r: str(r.get('date') or ''))
    recent_ids = {r.get('id') for r in analyzed[-RECENT:]}
    counts = {'missed': Counter(), 'allowed': Counter()}
    in_recent = {'missed': Counter(), 'allowed': Counter()}
    examples = {'missed': {}, 'allowed': {}}
    errors = 0
    for rec in analyzed:
        recent = rec.get('id') in recent_ids
        for kind, tag, example in game_motifs(rec, analysis_by_id[rec.get('id')]):
            if kind == 'error':
                errors += 1
                continue
            counts[kind][tag] += 1
            in_recent[kind][tag] += recent
            examples[kind].setdefault(tag, []).append(example)
    n_recent = len(recent_ids)
    n_earlier = len(analyzed) - n_recent
    rows = lambda kind: [{'tag': tag, 'slug': puzzles.TAG_TO_SLUG.get(tag), 'count': n,
                          'trend': trend(in_recent[kind][tag], n_recent, n - in_recent[kind][tag], n_earlier),
                          'examples': sorted(examples[kind][tag], key=lambda e: str(e.get('date') or ''), reverse=True)[:EXAMPLES]}
                         for tag, n in sorted(counts[kind].items(), key=lambda kv: (-kv[1], MOTIFS.index(kv[0])))]
    return {'errors': errors, 'games': len(analyzed), 'missed': rows('missed'), 'allowed': rows('allowed')}


if __name__ == '__main__':
    from torre.analysis import game_stats
    out = game_stats.load_stats()['motifs']
    print(json.dumps({k: v if k == 'errors' else [{x: r[x] for x in ('tag', 'count')} for r in v] for k, v in out.items()}, indent=1))
