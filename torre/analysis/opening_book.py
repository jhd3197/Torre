"""Offline, position-based opening recognition for game reviews.

Names come from the bundled Lichess CC0 index; never infer a variation from
an ECO tag alone. Match positions (including turn, castling and legal en
passant), so different move orders can reach the same named opening.
"""
import json
from functools import lru_cache
from pathlib import Path

import chess
from torre import paths

BOOK = paths.CONTENT / 'opening-book.json'
MAX_PLIES = 40

# General family ideas, not an assessment of the player's particular position.
# These complement the opening stories already used by the opening library.
FAMILY_IDEAS = {
    'Sicilian Defense': 'Black contests the center with the c-pawn, creating an asymmetric pawn structure. Development and central pawn breaks shape the plans for both sides.',
    'French Defense': 'Black challenges the white center with ...d5. In closed centers, pawn breaks and finding activity for the light-squared bishop are recurring themes.',
    'Caro-Kann Defense': 'Black supports ...d5 with the c-pawn, aiming for a solid center while keeping the light-squared bishop available for development.',
    'Italian Game': 'White develops the bishop toward f7. Completing development, castling and choosing when to play d4 are recurring ideas.',
    'Ruy Lopez': 'White puts pressure on the knight that defends e5. Central tension and steady development matter more than immediately capturing the pawn.',
    'Scotch Game': 'White challenges the center early with d4, opening lines for active piece play.',
    "Queen's Gambit": 'White challenges the d5 pawn with c4, trying to increase central control and open useful lines.',
    'Slav Defense': 'Black supports d5 with the c-pawn, keeping the light-squared bishop free to develop.',
    "King's Indian Defense": 'Black allows White space in the center and prepares to challenge it with pawn breaks after developing the kingside.',
    'London System': 'White develops the dark-squared bishop before closing its diagonal with e3, then builds a solid center and completes development.',
    'Indian Defense: London System': 'White develops the dark-squared bishop before closing its diagonal with e3, then builds a solid center and completes development.',
    'English Opening': 'White controls d5 from the flank with c4 and can keep the central pawn structure flexible.',
    'Scandinavian Defense': 'Black challenges e4 immediately with d5; central exchanges and developing efficiently are recurring themes.',
    'Pirc Defense': 'Black develops the kingside while letting White occupy the center, then looks for a well-timed central challenge.',
    "King's Gambit": 'White offers the f-pawn to open attacking lines, accepting a less sheltered king in return for activity.',
}


@lru_cache(maxsize=1)
def positions():
    try:
        return json.loads(BOOK.read_text(encoding='utf-8'))['positions']
    except (OSError, ValueError, KeyError):
        return {}  # a missing optional book must never prevent a game from opening


@lru_cache(maxsize=1)
def move_index():
    """Known position/move pairs from every prefix of the bundled opening lines."""
    result = set()
    for entry in positions().values():
        board = chess.Board()
        for uci in entry.get('uci', [])[:MAX_PLIES]:
            move = chess.Move.from_uci(uci)
            if move not in board.legal_moves:
                break
            result.add((board.epd(), uci))
            board.push(move)
    return result


def is_book_move(board, move):
    """Opening provenance, independent of engine quality or a legend's game archive."""
    return board.ply() < MAX_PLIES and (board.epd(), move.uci()) in move_index()


def recognize(game):
    """Deepest named position reached, with the game's actual line, or None.

    A match identifies an opening, not a sound move or a theoretical novelty.
    Custom starting positions and malformed games are deliberately not named.
    """
    if game is None or game.errors or game.board().fen() != chess.STARTING_FEN:
        return None
    book = positions()
    board, played, sans, labels, found = game.board(), [], [], [], None
    for ply, move in enumerate(game.mainline_moves(), 1):
        if ply > MAX_PLIES:
            break
        san = board.san(move)
        labels.append(f'{board.fullmove_number}{"." if board.turn else "..."} {san}')
        sans.append(san)
        played.append(move.uci())
        mover = 'white' if board.turn else 'black'
        board.push(move)
        entry = book.get(board.epd())
        if entry:
            name = entry['name']
            idea = next((FAMILY_IDEAS[key] for key in sorted(FAMILY_IDEAS, key=len, reverse=True)
                         if name.startswith(key)), None)
            found = {'name': name, 'eco': entry['eco'], 'ply': ply,
                     'move_number': (ply + 1) // 2, 'move': san, 'played_by': mover,
                     'line': ' '.join(labels), 'moves': list(sans),
                     'transposed': played != entry['uci'], 'family_idea': idea,
                     'continuation': []}
        elif found and len(found['continuation']) < 4:
            found['continuation'].append(labels[-1])
    return found
