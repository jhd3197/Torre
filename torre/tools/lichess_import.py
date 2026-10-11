"""Incremental Lichess import into data/games.jsonl, clocks and Lichess accuracy included.

The games come from importer.fetch_lichess (the same records the import page makes). The
newest game's createdAt is remembered per username in data/lichess_sync.json, so the next sync
only asks for newer games. Games already in the library (same id or URL) are skipped.

A correspondence game still running at sync time is not exported yet, and since the
cursor follows createdAt it will not come in later; a --full sync picks it up.

Usage:  .venv/Scripts/python lichess_import.py <username> [--full] [--since YYYY-MM-DD]
"""

import argparse
import sys
import time
from pathlib import Path

from torre.games import importer
from torre import jsonio
DATA_DIR = Path('data')
OUT_FILE = DATA_DIR / 'games.jsonl'
STATE_FILE = DATA_DIR / 'lichess_sync.json'


# --- sync state -------------------------------------------------------------------

def last_synced(username, state_file=STATE_FILE):
    """{'newest_ms', 'synced_at', 'added'} of the last sync of `username`, or None."""
    return jsonio.read_dict(state_file).get(username.strip().lower())


def save_cursor(username, newest_ms, added, state_file=STATE_FILE):
    with importer.FILE_LOCK:
        state = jsonio.read_dict(state_file)
        name = username.strip().lower()
        old = state.get(name) or {}
        state[name] = {'newest_ms': max(newest_ms or 0, old.get('newest_ms') or 0) or None,
                       'synced_at': int(time.time()), 'added': added}
        Path(state_file).parent.mkdir(parents=True, exist_ok=True)
        jsonio.write_json(state_file, state, indent=2)


def library_keys(games_file):
    """Ids and URLs already in the library, so a game is never added twice."""
    return {record[k] for record in jsonio.read_jsonl(games_file) if isinstance(record, dict)
            for k in ('id', 'url') if record.get(k)}


# --- sync ---------------------------------------------------------------------------

def sync(username, games_file=OUT_FILE, state_file=STATE_FILE, *, full=False, since=None, stream=None,
         progress=lambda done, total, label: None, should_stop=lambda: False):
    """Fetch games newer than the last sync of `username` and append them to `games_file`.

    `full` ignores the cursor; `since` ('YYYY-MM-DD') overrides it. The cursor only moves
    when the whole stream was read, so a cancelled sync is simply resumed next time.
    Returns {'username', 'since_ms', 'fetched', 'added', 'duplicates', 'failed', 'newest_ms', 'complete'}.
    """
    name = username.strip().lower()
    cursor = None if full or since else (last_synced(name, state_file) or {}).get('newest_ms')
    since_ms = importer.day_ms(since) if since else cursor + 1 if cursor else None
    records, failed, newest, complete = importer.fetch_lichess(name, since_ms, stream=stream, progress=progress,
                                                               should_stop=should_stop)
    have = library_keys(games_file)
    added, _ = importer.append([r for r in records if r['id'] not in have and r.get('url') not in have], games_file)
    if complete:
        save_cursor(name, newest, added, state_file)
    return {'username': name, 'since_ms': since_ms, 'fetched': len(records), 'added': added,
            'duplicates': len(records) - added, 'failed': failed, 'newest_ms': newest, 'complete': complete}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Import a Lichess player\'s games into data/games.jsonl.')
    parser.add_argument('username')
    parser.add_argument('--full', action='store_true', help='ignore the sync cursor and fetch every game')
    parser.add_argument('--since', help='fetch games from this day (YYYY-MM-DD) instead of the cursor')
    parser.add_argument('--games-file', default=str(OUT_FILE))
    parser.add_argument('--state-file', default=str(STATE_FILE))
    args = parser.parse_args(argv)
    importer.migrate_ids(Path(args.games_file).parent)
    try:
        result = sync(args.username, args.games_file, args.state_file, full=args.full, since=args.since,
                      progress=lambda done, total, label: done % 100 == 0 and print(f'  {done} games read'))
    except importer.ImportProblem as exc:
        sys.exit(str(exc))
    for f in result['failed']:
        print(f'  FAILED {f["where"]}: {f["error"]}')
    print(f'Done. fetched={result["fetched"]} added={result["added"]} duplicates={result["duplicates"]} '
          f'errors={len(result["failed"])} -> {args.games_file}')


if __name__ == '__main__':
    main()
