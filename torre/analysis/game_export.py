"""Versioned, portable Torre game reports. Exporting never runs an engine."""
import io
import math
import re
from datetime import datetime, timezone
from statistics import mean, median

import chess
import chess.pgn

from torre.analysis import analyze
from torre.analysis import game_rating
from torre.analysis import pgn_export
from torre.analysis import scoring
def milliseconds(seconds):
    return round(seconds * 1000) if seconds is not None and math.isfinite(seconds) and seconds >= 0 else None


def game_report(pgn, analysis=None, *, record=None, timings=None):
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None or game.errors or not game.board().is_valid():
        raise ValueError('Could not export this game: invalid PGN or starting position.')
    board = game.board()
    initial_fen = board.fen()
    nodes = list(game.mainline())
    analysis = analysis or {}
    evals = analysis.get('evals') or []
    analyzed = analysis.get('scoring_version') == analyze.SCORING_VERSION and len(evals) == len(nodes) + 1
    best_moves = analysis.get('best_moves') or []
    alternatives = analysis.get('alternatives') or []
    # Only a single sudden-death period with optional Fischer increment is safe
    # to infer. Delay, hourglass, staged controls and unknown controls stay unknown.
    control = re.fullmatch(r'(\d+)(?:\+(\d+))?', game.headers.get('TimeControl', ''))
    base, increment = (map(int, (control[1], control[2] or 0)) if control else (None, None))
    previous = {chess.WHITE: None, chess.BLACK: None}
    if initial_fen == chess.STARTING_FEN and base is not None:
        previous = {chess.WHITE: base, chess.BLACK: base}
    measured = {}
    for item in timings or []:
        if not isinstance(item, dict) or type(item.get('ply')) is not int or item['ply'] in measured:
            raise ValueError('Timing entries must have unique integer ply numbers.')
        if not 1 <= item['ply'] <= len(nodes):
            raise ValueError('Timing ply is outside this game.')
        if item.get('source') != 'ui_active' or type(item.get('partial')) is not bool:
            raise ValueError('Timing entries need a source and partial flag.')
        value = item.get('elapsed_ms')
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
            raise ValueError('Move time must be a finite, nonnegative number of milliseconds.')
        measured[item['ply']] = item

    moves, times, decisions = [], [], []
    for ply, node in enumerate(nodes, 1):
        move = node.move
        color = 'white' if board.turn else 'black'
        phase = analyze.phase_of(board.fullmove_number)
        moves.append({
            'ply': ply, 'move_number': board.fullmove_number, 'color': color,
            'uci': move.uci(), 'san': board.san(move), 'fen_before': board.fen(),
            'phase': phase, 'in_check': board.is_check(), 'capture': board.is_capture(move),
            'legal_move_count': board.legal_moves.count(),
        })
        clock, emt = node.clock(), node.emt()
        elapsed, source, partial = milliseconds(emt), 'pgn_emt', False
        if elapsed is None:
            elapsed, source = None, None
            if control and clock is not None and previous[board.turn] is not None:
                elapsed = milliseconds(previous[board.turn] + increment - clock)
                if elapsed is not None:
                    source = 'clock_delta'
        previous[board.turn] = clock  # a gap breaks the chain; never charge several moves to one
        if ply in measured:
            item = measured[ply]
            if item.get('uci') != move.uci():
                raise ValueError('Timing does not match the move history.')
            elapsed, source, partial = round(item['elapsed_ms']), 'ui_active', item['partial']
        times.append({'ply': ply, 'elapsed_ms': elapsed, 'clock_after_ms': milliseconds(clock),
                      'source': source, 'partial': partial, 'reaction_ms': None})
        decision = {'ply': ply, 'analyzed': analyzed, 'eval_before': None, 'eval_after': None,
                    'centipawn_loss': None, 'win_chance_loss': None, 'accuracy': None,
                    'judgment': None, 'brilliant': None, 'best_uci': None, 'played_best': None,
                    'grade': None, 'great': None, 'book': None, 'excellent': None, 'miss': None, 'forced': None}
        if analyzed:
            before, after = evals[ply - 1], evals[ply]
            win_before, win_after, judgment, brilliant = analyze.judge_ply(board, move, before, after)
            best = best_moves[ply - 1] if ply <= len(best_moves) else None
            graded = scoring.classify(board, move,
                {'cp': before[0], 'mate': before[1], 'best': best,
                 'alternative': alternatives[ply - 1] if ply <= len(alternatives) else None},
                {'cp': after[0], 'mate': after[1]},
                {'cp': evals[ply - 2][0], 'mate': evals[ply - 2][1]} if ply > 1 else None)
            decision.update({
                'eval_before': {'cp': before[0], 'mate': before[1]},
                'eval_after': {'cp': after[0], 'mate': after[1]},
                'centipawn_loss': max(0, analyze.legacy_cp(before, board.turn) - analyze.legacy_cp(after, board.turn)),
                'win_chance_loss': round(max(0, win_before - win_after), 2),
                'accuracy': round(scoring.move_accuracy(win_before, win_after), 2),
                'judgment': judgment, 'brilliant': brilliant, 'best_uci': best,
                'played_best': move.uci() == best if best else None,
                'grade': scoring.grade(graded), 'great': graded['great'], 'book': graded['book'],
                'excellent': graded['excellent'], 'miss': graded['miss'], 'forced': graded['forced'],
            })
        decisions.append(decision)
        board.push(move)
        moves[-1]['fen_after'] = board.fen()

    # Separate colors and measurement sources so bot latency and clock-derived
    # thinking times are never averaged together with observed human activity.
    timing_summary, quality_summary = [], []
    for color in ('white', 'black'):
        for phase in ('opening', 'middlegame', 'endgame'):
            indices = [i for i, move in enumerate(moves) if move['color'] == color and move['phase'] == phase]
            if not indices:
                continue
            judged = [decisions[i] for i in indices if decisions[i]['analyzed']]
            quality_summary.append({
                'color': color, 'phase': phase, 'move_count': len(indices), 'analyzed_count': len(judged),
                'mean_centipawn_loss': round(mean(d['centipawn_loss'] for d in judged), 2) if judged else None,
                'mistakes': sum(d['judgment'] == 'mistake' for d in judged) if judged else None,
                'blunders': sum(d['judgment'] == 'blunder' for d in judged) if judged else None,
            })
            for source in ('pgn_emt', 'clock_delta', 'ui_active'):
                sample = [i for i in indices if times[i]['source'] == source and not times[i]['partial']]
                if not sample:
                    continue
                values = [times[i]['elapsed_ms'] for i in sample]
                fast = [i for i in sample if times[i]['elapsed_ms'] <= 2000 and decisions[i]['analyzed']]
                timing_summary.append({
                    'color': color, 'phase': phase, 'source': source, 'sample_count': len(sample),
                    'mean_ms': round(mean(values)), 'median_ms': round(median(values)), 'max_ms': max(values),
                    'fast_analyzed_count': len(fast),
                    'fast_blunders': sum(decisions[i]['judgment'] == 'blunder' for i in fast) if fast else None,
                })
    return {
        'format': 'torre-game', 'version': 1,
        'exported_at': datetime.now(timezone.utc).isoformat(),
        'game': {
            'id': (record or {}).get('id'), 'user_color': (record or {}).get('user_color'),
            'headers': dict(game.headers), 'pgn': pgn, 'initial_fen': initial_fen,
            'final_fen': board.fen(), 'moves': moves,
            'phase_method': 'fullmove_number: opening <= 10, middlegame <= 30, endgame > 30',
        },
        'timing': {
            'unit': 'milliseconds', 'moves': times, 'summary': timing_summary,
            'known_count': sum(t['elapsed_ms'] is not None for t in times),
            'unknown_count': sum(t['elapsed_ms'] is None for t in times),
            'partial_count': sum(t['partial'] for t in times), 'fast_threshold_ms': 2000,
            'reaction_time_available': False,
        },
        'quality': {
            'available': analyzed, 'source': 'archive_analysis' if analyzed else None,
            'engine': analysis.get('engine', 'stockfish') if analyzed else None,
            'scoring_version': analyze.SCORING_VERSION if analyzed else None,
            'evaluation_pov': 'white', 'loss_pov': 'mover',
            'moves': decisions, 'summary': quality_summary,
            # How strongly each side played, in rating points (game_rating.py): an estimate, None when too short.
            'estimated_rating': game_rating.game_ratings(
                evals, game.board(), [node.move for node in nodes], game.headers.get('TimeControl'),
                {'white': game.headers.get('WhiteElo'), 'black': game.headers.get('BlackElo')}) if analyzed else None,
        },
    }


def filename(report):
    return pgn_export.filename(report['game']['headers'])[:-4] + '.torre.json'
