"""Build the offline opening-name index from a pinned Lichess CC0 dataset.

Run from the repository root: .venv/Scripts/python -m torre.tools.build_opening_book
"""
import csv
import io
import json
from pathlib import Path
from urllib.request import urlopen

import chess
import chess.pgn
from torre import paths

REVISION = 'a6189a30dc273ccb21fc2536a9a2fefd5592a67a'
SOURCE = 'https://github.com/lichess-org/chess-openings'
ROOT = paths.REPO


def main():
    positions = {}
    for volume in 'abcde':
        url = f'https://raw.githubusercontent.com/lichess-org/chess-openings/{REVISION}/{volume}.tsv'
        with urlopen(url, timeout=30) as response:
            rows = csv.DictReader(io.StringIO(response.read().decode('utf-8')), delimiter='\t')
            for row in rows:
                game = chess.pgn.read_game(io.StringIO(row['pgn']))
                if game is None or game.errors:
                    raise ValueError(f'Invalid opening: {row["name"]}')
                line = [m.uci() for m in game.mainline_moves()]
                key = game.end().board().epd()
                entry = {'eco': row['eco'], 'name': row['name'], 'uci': line}
                old = positions.get(key)
                if old is None or (len(line), row['name']) < (len(old['uci']), old['name']):
                    positions[key] = entry
    destination = paths.CONTENT / 'opening-book.json'
    destination.write_text(json.dumps({'source': SOURCE, 'revision': REVISION, 'license': 'CC0-1.0',
                                      'positions': positions}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'Wrote {len(positions)} named positions to {destination}')


if __name__ == '__main__':
    main()
