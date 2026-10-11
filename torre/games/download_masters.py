"""Download master games (PGN Mentor's free player files) into games/masters/ to pick game stories from.

These files are for choosing games only and stay out of git: a game story ships
just the one game's moves and headers plus our own notes (moves are facts; no
one's annotations are copied). PGN Mentor's player files carry no annotations.

    python download_masters.py              # every legend in the Hall of Legends
    python download_masters.py Tal Morphy   # some players (PGN Mentor's file names)
    python download_masters.py --list       # what is already downloaded

Resumable: a player whose PGN is already here is skipped (--force to refetch).
"""

import argparse
import io
import sys
import time
import urllib.request
import zipfile
from pathlib import Path
from torre import paths

OUT = paths.REPO / 'games' / 'masters'
SOURCE = 'https://www.pgnmentor.com/players/{name}.zip'
AGENT = 'chess-jd/1.0 (personal study app; picks game stories)'
PAUSE = 1.5  # seconds between downloads, to be polite

# PGN Mentor's file names for the Hall of Legends: the players the history lessons are about,
# then the other world champions, the great uncrowned and today's stars.
# (Vera Menchik and Ju Wenjun have figurines but no PGN Mentor file.)
CHAMPIONS = ['Philidor', 'DeLaBourdonnais', 'Anderssen', 'Morphy', 'Steinitz', 'Chigorin', 'Pillsbury', 'Lasker', 'Rubinstein',
             'Capablanca', 'Alekhine', 'Nimzowitsch', 'Reti', 'Euwe', 'Botvinnik', 'Smyslov', 'Tal', 'Petrosian', 'Spassky',
             'Fischer', 'Karpov', 'Korchnoi', 'Kasparov', 'Kramnik', 'Anand', 'Carlsen', 'PolgarJ',
             'Marshall', 'Tartakower', 'Keres', 'Bronstein', 'Najdorf', 'Larsen', 'Gaprindashvili', 'Chiburdanidze', 'PolgarS',
             'Topalov', 'Hou', 'Ding', 'Gukesh', 'Nakamura', 'Caruana', 'Nepomniachtchi', 'Aronian', 'Firouzja', 'So']


def fetch(name):
    request = urllib.request.Request(SOURCE.format(name=name), headers={'User-Agent': AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        pgns = [n for n in archive.namelist() if n.lower().endswith('.pgn')]
        if not pgns:
            raise ValueError('the zip holds no PGN')
        return b'\n\n'.join(archive.read(n) for n in pgns)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('players', nargs='*', help='PGN Mentor file names (default: the champions)')
    parser.add_argument('--force', action='store_true', help='download again even if present')
    parser.add_argument('--list', action='store_true', help='list the downloaded files and stop')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.list:
        for path in sorted(OUT.glob('*.pgn')):
            print(f'{path.stem:20} {path.read_bytes().count(b"[Event "):6} games')
        return 0
    failed = []
    for i, name in enumerate(args.players or CHAMPIONS):
        target = OUT / f'{name}.pgn'
        if target.exists() and not args.force:
            print(f'skip {name} (already here)')
            continue
        if i:
            time.sleep(PAUSE)
        try:
            data = fetch(name)
        except Exception as exc:  # one bad file should not stop the rest
            print(f'FAILED {name}: {exc}')
            failed.append(name)
            continue
        target.write_bytes(data)
        print(f'{name}: {data.count(b"[Event ")} games')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
