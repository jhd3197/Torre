"""Give saved games their real date where the importer kept a placeholder ("1970.01.01", "????.??.??").

    python -m scripts.repair_game_dates

chess.com's bot and coach games carry Date "1970.01.01"; the real day is in the PGN's EndDate or the end
time (chesscom_common.real_date, which the importers now use). Rewrites data/games.jsonl and the matching
rows of data/analysis.jsonl, after copying each to <name>.bak. Safe to run again: it only changes bad dates.
"""
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from torre.games.chesscom_common import real_date  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / 'data'
HEADER = re.compile(r'\[(\w+) "([^"]*)"\]')


def repair(path, fixed_for):
    """Rewrite `path` (JSON lines) with each row's date from fixed_for(row); returns how many changed."""
    if not path.exists():
        return 0
    rows, changed = [], 0
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        date = fixed_for(row)
        if date and date != row.get('date'):
            row['date'] = date
            changed += 1
        rows.append(row)
    if changed:
        shutil.copyfile(path, path.with_suffix(path.suffix + '.bak'))
        path.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows), encoding='utf-8')
    return changed


def main():
    dates = {}

    def game_date(game):
        headers = dict(HEADER.findall(game.get('pgn') or ''))
        headers.setdefault('Date', game.get('date') or '')
        date = real_date(headers, game.get('end_time_unix'))
        dates[str(game.get('id'))] = date or game.get('date')
        return date

    games = repair(DATA / 'games.jsonl', game_date)
    analysis = repair(DATA / 'analysis.jsonl', lambda row: dates.get(str(row.get('id'))))
    print(f'fixed {games} game dates and {analysis} analysis dates')


if __name__ == '__main__':
    main()
