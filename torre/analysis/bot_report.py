"""How a game against a bot was really played, phase by phase: the after-game card that shows
whether the bot kept to the strength it was set to.

A bot plays every move at the rating it was given (one rating, or one per phase; see
api_board._phase_elo), and weak bots now and then play a deliberate weaker move (a "slip",
engines.strength_options). Neither changes during a game on its own. This module puts numbers
on that, from the engine's review of the finished game:

    phases   accuracy and errors for you and the bot in the opening, middlegame and endgame
             (phases.position_phase; Lichess accuracy, game_stats.aggregate_accuracy), each with
             a grade (phase_grade), a rating once it has enough moves (game_rating), and the
             ply of the phase's first move
    slips    the bot's deliberate weaker moves and how each turned out: one can land on a
             good move by chance, which is why a weak bot sometimes looks strong
    ratings  the rating the bot was set to in each phase it played
    rating   how strongly you and the bot played the whole game, in rating points (game_rating)
    retry    your costliest mistake, with the position before it, to play again from there

All evals are White-POV [cp, mate] pairs, one per position (the start and after every move).
"""
import chess

from torre.analysis import game_rating
from torre.analysis import game_stats
from torre.analysis import scoring
SIDES = ('you', 'bot')
PHASE_GRADES = scoring.GRADING['phaseGrades']


def phase_grade(accuracy, moves, brilliant=0, great=0):
    """One grade for a player's phase: brilliant or great when the phase holds such a move and
    its accuracy is high enough, else by accuracy (best, excellent, good, inaccuracy, mistake,
    blunder). None for a phase with too few moves to judge."""
    if accuracy is None or moves < PHASE_GRADES['minMoves']:
        return None
    if brilliant and accuracy >= PHASE_GRADES['brilliant']:
        return 'brilliant'
    if great and accuracy >= PHASE_GRADES['great']:
        return 'great'
    return next((grade for floor, grade in PHASE_GRADES['ladder'] if accuracy >= floor), PHASE_GRADES['below'])


def _pair(ev):
    """An engine_lines entry or a [cp, mate] pair as (cp, mate), mate taking the place of cp."""
    if isinstance(ev, dict):
        return (None, ev['mate']) if ev.get('mate') is not None else (ev.get('cp'), None)
    return tuple(ev)


def report(initial_fen, ucis, player_color, evals, notes=(), grades=None):
    """The card for a finished game. `evals` holds len(ucis) + 1 White-POV evals; `notes` the
    bot's own record of its moves ({ply, slip, elo}), as the play page saved them; `grades` each
    move's scoring.classify flags (index ply - 1), for the brilliant and great moves."""
    board = chess.Board(initial_fen)
    evals = [_pair(ev) for ev in evals]
    if len(evals) != len(ucis) + 1:
        raise ValueError('The review does not cover the whole game.')
    you = chess.WHITE if player_color == 'white' else chess.BLACK
    win = [game_stats.win_pct(*ev) for ev in evals]
    weights = game_stats.volatility_weights(win)
    by_ply = {n['ply']: n for n in notes if isinstance(n, dict) and isinstance(n.get('ply'), int)}
    rows = {phase: {side: [] for side in SIDES} for phase in game_stats.PHASES}
    slips, ratings, phase, worst, starts = [], {}, None, None, {}
    grades = list(grades or [])
    for i, uci in enumerate(ucis):
        move = chess.Move.from_uci(uci)
        phase = game_stats.position_phase(board, phase)
        starts.setdefault(phase, i + 1)
        mover = board.turn
        side = 'you' if mover == you else 'bot'
        before, after = (win[i], win[i + 1]) if mover == chess.WHITE else (100 - win[i], 100 - win[i + 1])
        judged = scoring.judge(evals[i], evals[i + 1], mover == chess.WHITE)
        grade = scoring.grade(grades[i]) if i < len(grades) and grades[i] else None
        rows[phase][side].append({'accuracy': game_stats.move_accuracy(before, after), 'weight': weights[i], 'class': judged,
                                  'grade': grade, 'loss': game_rating.centipawn_loss(evals[i], evals[i + 1], mover == chess.WHITE)})
        if side == 'you' and judged in ('mistake', 'blunder') and (worst is None or before - after > worst['drop']):
            worst = {'ply': i + 1, 'san': board.san(move), 'class': judged, 'fen': board.fen(), 'drop': before - after}
        note = by_ply.get(i + 1)
        if side == 'bot' and note:
            if isinstance(note.get('elo'), int):
                ratings.setdefault(phase, set()).add(note['elo'])
            if note.get('slip'):
                slips.append({'ply': i + 1, 'san': board.san(move), 'phase': phase, 'class': judged})
        board.push(move)

    def summary(moves, rated=False):
        if not moves:
            return None
        accuracy = game_stats.aggregate_accuracy([(m['accuracy'], m['weight']) for m in moves])
        special = {name: sum(m['grade'] == name for m in moves) for name in ('brilliant', 'great')}
        stats = {'accuracy': accuracy, 'moves': len(moves), 'acpl': sum(m['loss'] for m in moves) / len(moves)}
        return {'moves': len(moves), 'accuracy': round(accuracy, 1),
                **{e: sum(m['class'] == e for m in moves) for e in game_stats.ERRORS},
                'grade': phase_grade(accuracy, len(moves), **special),
                **({'rating': game_rating.estimate(stats, None) if len(moves) >= PHASE_GRADES['ratingMinMoves'] else None}
                   if rated else {})}

    overall = {side: summary([m for phase in game_stats.PHASES for m in rows[phase][side]]) for side in SIDES}
    played = game_rating.game_ratings(evals, chess.Board(initial_fen), [chess.Move.from_uci(u) for u in ucis])
    bot = 'black' if you == chess.WHITE else 'white'
    return {
        'phases': {phase: {side: summary(rows[phase][side], rated=True) for side in SIDES} for phase in game_stats.PHASES},
        # The ply of each phase's first move, to jump there.
        'starts': {phase: starts.get(phase) for phase in game_stats.PHASES},
        'overall': overall,
        'slips': slips,
        # A slip that came out fine (no error by the judgment rules) is luck, not a stronger bot.
        'luckySlips': sum(1 for s in slips if s['class'] is None),
        'ratings': {phase: sorted(values) for phase, values in ratings.items()},
        'rating': {'you': played['white' if you == chess.WHITE else 'black'], 'bot': played[bot]},
        'retry': {k: v for k, v in worst.items() if k != 'drop'} if worst else None,
    }
