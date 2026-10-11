"""Build puzzles/<theme>.json from the Lichess puzzle database.

    .venv/Scripts/python import_puzzles.py            # download (once) and build every pack
    .venv/Scripts/python import_puzzles.py --per-theme 400

The database (https://database.lichess.org/#puzzles, CC0) is a ~300 MB
zstandard CSV; it is cached in data/ so later runs skip the download. For each
theme in puzzles.THEMES this keeps well-tested puzzles (low rating deviation,
liked and played often) spread evenly over rating bands, so every level has
something to solve. Needs the `zstandard` package (dev only; the studio itself
does not).
"""
import argparse
import csv
import io
import json
import sys
import urllib.request
from pathlib import Path

from torre.learning import puzzles
from torre import paths
ROOT = paths.REPO
URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst'
CACHE = ROOT / 'data' / 'lichess_db_puzzle.csv.zst'
BANDS = range(400, 2800, 200)  # 400-599, 600-799, ... 2600-2799
MAX_DEVIATION, MIN_POPULARITY, MIN_PLAYS = 90, 80, 300


def download(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix('.part')
    print(f'Downloading {URL} ...')
    with urllib.request.urlopen(URL) as response, part.open('wb') as out:
        total = int(response.headers.get('Content-Length', 0))
        done = 0
        while chunk := response.read(1 << 20):
            out.write(chunk)
            done += len(chunk)
            if total:
                print(f'\r  {done * 100 // total}%', end='', flush=True)
    print()
    part.replace(path)


def rows(path):
    import zstandard
    with path.open('rb') as raw:
        text = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(raw), encoding='utf-8', newline='')
        yield from csv.DictReader(text)


def select(source, per_theme):
    """{slug: [puzzle]}: up to per_theme puzzles per theme, an even share per rating band."""
    per_band = max(1, per_theme // len(BANDS))
    wanted = {tag: slug for slug, (tag, *_rest) in puzzles.THEMES.items()}
    picked = {slug: {band: [] for band in BANDS} for slug in puzzles.THEMES}
    for n, row in enumerate(source, 1):
        if n % 500_000 == 0:
            print(f'  {n:,} puzzles read', flush=True)
        rating = int(row['Rating'])
        if (int(row['RatingDeviation']) > MAX_DEVIATION or int(row['Popularity']) < MIN_POPULARITY
                or int(row['NbPlays']) < MIN_PLAYS or not 400 <= rating < 2800):
            continue
        tags = row['Themes'].split()
        band = BANDS[(rating - 400) // 200]
        for tag in tags:
            slug = wanted.get(tag)
            if slug and len(picked[slug][band]) < per_band:
                picked[slug][band].append({
                    'id': row['PuzzleId'], 'fen': row['FEN'], 'moves': row['Moves'].split(), 'rating': rating,
                    'themes': [t for t in tags if t in puzzles.TAG_TO_SLUG], 'game': row['GameUrl'],
                })
    return {slug: sorted((p for band in bands.values() for p in band), key=lambda p: p['rating'])
            for slug, bands in picked.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--per-theme', type=int, default=240, help='puzzles to keep per theme (default 240)')
    parser.add_argument('--source', type=Path, default=CACHE, help='a local lichess_db_puzzle.csv.zst')
    args = parser.parse_args()
    if not args.source.exists():
        download(args.source)
    print(f'Reading {args.source} ...')
    packs = select(rows(args.source), args.per_theme)
    puzzles.PUZZLES_DIR.mkdir(exist_ok=True)
    for slug, items in packs.items():
        valid = []
        for item in items:
            try:
                puzzles.view(item)
                valid.append(item)
            except puzzles.PuzzleError as exc:
                print(f'  skipped {exc}', file=sys.stderr)
        body = {'version': 1, 'source': 'Lichess puzzle database (CC0), https://database.lichess.org/#puzzles',
                'puzzles': valid}
        text = json.dumps(body, separators=(',', ':')).replace('},{', '},\n{')
        (puzzles.PUZZLES_DIR / f'{slug}.json').write_text(text + '\n', encoding='utf-8')
        print(f'  {slug}: {len(valid)} puzzles, {valid[0]["rating"] if valid else "-"}-{valid[-1]["rating"] if valid else "-"}')


if __name__ == '__main__':
    main()
