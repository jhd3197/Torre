"""Bring games into the library (data/games.jsonl) from chess.com, Lichess or PGN files.

Every source turns into the same flat records (game_record) that analyze.py and
insights.py read, each with a string id. The studio's ImportJob fetches or parses
them into a preview, and nothing is written until the player picks which games to
keep (commit). lichess_import.py syncs a Lichess account from the command line.

    chess.com   https://api.chess.com/pub/player/{u}/games/archives, then each month
                (live and daily games; games against bots are not in the public API,
                so those come from the browser extension's export file instead)
    Lichess     https://lichess.org/api/games/user/{u} as NDJSON, one game per line, with
                clocks and Lichess's accuracy
    Files       any number of PGN games, or the extension's chesscom_games_export.json
"""

import hashlib
import io
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import chess
import chess.pgn

from torre.analysis import analyze
from torre.server import jobs
from torre import jsonio
from torre.games.chesscom_common import build_pgn, real_date
from torre import net


UA = {'User-Agent': 'Mozilla/5.0 (chess-jd personal analysis tool)'}
RESULTS = {'1-0': (1, 0), '0-1': (0, 1), '1/2-1/2': (0.5, 0.5)}
CHESSCOM_GAME = re.compile(r'chess\.com/(?:game/)?(live|daily|computer)/(?:game/)?(\d+)')
LICHESS_GAME = re.compile(r'lichess\.org/([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?\b')
FILE_LOCK = threading.Lock()


class ImportProblem(ValueError):
    """A problem the player can act on (unknown user, nothing in range); shown as is."""


# --- fetching -------------------------------------------------------------------

def open_url(url, accept='application/json', retries=4):
    """GET `url`, waiting out 429s (Retry-After) and retrying server errors."""
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={**UA, 'Accept': accept})
            return net.urlopen(request, timeout=60)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise LookupError(url) from exc
            if exc.code != 429 and exc.code < 500 or attempt == retries - 1:
                raise ImportProblem('The server refused the request. Please try again later.') from exc
            wait = int(exc.headers.get('Retry-After') or 0) or 2 ** attempt * 5
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == retries - 1:
                raise ImportProblem('Could not reach the server. Check your internet connection.') from exc
            wait = 2 ** attempt * 2
        time.sleep(min(wait, 60))


def fetch_json(url):
    with open_url(url) as response:
        return json.loads(response.read().decode('utf-8'))


def month_of(url):
    """'.../games/2026/08' -> '2026-08'."""
    year, month = url.rstrip('/').split('/')[-2:]
    return f'{year}-{month}'


def chesscom_games(username, since=None, *, progress=lambda done, total, label: None,
                   should_stop=lambda: False, get=fetch_json):
    """All chess.com games of `username` from `since` ('YYYY-MM-DD' or None): (records, failed)."""
    name = username.strip().lower()
    try:
        archives = get(f'https://api.chess.com/pub/player/{urllib.parse.quote(name)}/games/archives')['archives']
    except LookupError:
        raise ImportProblem('There is no chess.com player with that username.') from None
    months = [url for url in archives if not since or month_of(url) >= since[:7]]
    records, failed = [], []
    for i, url in enumerate(reversed(months)):  # newest first: the games you remember come in first
        if should_stop():
            break
        progress(i, len(months), month_of(url))
        for game in get(url).get('games', []):
            if game.get('rules', 'chess') != 'chess':
                continue  # chess960, bughouse and friends: the analysis expects standard chess
            try:
                records.append(chesscom_record(game, name))
            except ValueError as exc:
                failed.append(failure(game.get('url'), game.get('white', {}).get('username'), game.get('black', {}).get('username'), exc))
    progress(len(months), len(months), None)
    return records, failed


def chesscom_record(game, username):
    """One game from a chess.com monthly archive."""
    found = CHESSCOM_GAME.search(game.get('url', ''))
    if not found:
        raise ValueError('The game has no chess.com link.')
    kind, gid = found.groups()
    me = 'white' if game['white']['username'].lower() == username else 'black'
    accuracy = (game.get('accuracies') or {}).get(me)
    return to_record(game['pgn'], {username}, id=gid, type='daily' if game.get('time_class') == 'daily' else kind,
                     url=game['url'], accuracy=accuracy, end_time=game.get('end_time'), clocks=True)


def ndjson_lines(url):
    with open_url(url, accept='application/x-ndjson') as response:
        for raw in response:
            yield raw.decode('utf-8')


def player_name(side):
    side = side or {}
    return (side.get('user') or {}).get('name') or (f'Stockfish level {side["aiLevel"]}' if side.get('aiLevel') else '?')


LICHESS_API = 'https://lichess.org/api/games/user/'
LICHESS_VARIANTS = ('standard', 'fromPosition')


def lichess_url(username, since_ms=None, max_games=None):
    """The NDJSON export URL: PGN in the JSON, clocks, evals and opening names."""
    query = {'moves': 'true', 'tags': 'true', 'pgnInJson': 'true', 'clocks': 'true', 'evals': 'true',
             'opening': 'true', 'finished': 'true'}
    if since_ms:
        query['since'] = int(since_ms)
    if max_games:
        query['max'] = int(max_games)
    return f'{LICHESS_API}{urllib.parse.quote(username.strip().lower())}?{urllib.parse.urlencode(query)}'


def fetch_lichess(username, since_ms=None, *, stream=None, progress=lambda done, total, label: None,
                  should_stop=lambda: False, max_games=None):
    """Lichess games of `username` created at or after `since_ms`: (records, failed, newest_ms, complete).

    `newest_ms` is the latest createdAt seen (variants and broken games included, so they
    are not asked for again); `complete` is False when `should_stop` cut the stream short.
    """
    name = username.strip().lower()
    records, failed, newest, complete = [], [], None, True
    try:
        for raw in (stream or ndjson_lines)(lichess_url(name, since_ms, max_games)):
            if should_stop():
                complete = False
                break
            if not raw.strip():
                continue
            game = json.loads(raw)
            if game.get('createdAt'):
                newest = max(newest or 0, game['createdAt'])
            progress(len(records) + len(failed) + 1, 0, None)
            if game.get('variant', 'standard') not in LICHESS_VARIANTS:
                continue
            try:
                records.append(lichess_record(game, name))
            except (KeyError, TypeError, ValueError) as exc:
                players = game.get('players', {})
                failed.append(failure(f'https://lichess.org/{game.get("id")}', player_name(players.get('white')),
                                      player_name(players.get('black')), exc))
    except LookupError:
        raise ImportProblem('There is no Lichess player with that username.') from None
    return records, failed, newest, complete


def lichess_games(username, since=None, *, progress=lambda done, total, label: None, should_stop=lambda: False,
                  stream=None):
    """All Lichess games of `username` from `since` ('YYYY-MM-DD' or None): (records, failed)."""
    records, failed, _, _ = fetch_lichess(username, day_ms(since) if since else None, stream=stream,
                                          progress=progress, should_stop=should_stop)
    return records, failed


def day_ms(day):
    """'YYYY-MM-DD' -> epoch milliseconds at UTC midnight."""
    return int(datetime.strptime(day, '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp() * 1000)


def lichess_record(game, username):
    """One game from the Lichess export, [%clk] kept in the PGN, with Lichess's accuracy when it analyzed the game."""
    players = game.get('players', {})
    vs_ai = any((side or {}).get('aiLevel') for side in players.values())
    kind = 'daily' if game.get('speed') == 'correspondence' else 'computer' if vs_ai else 'live'
    end = game.get('lastMoveAt') or game.get('createdAt')
    record = to_record(game['pgn'], {username}, id=f'li-{game["id"]}', type=kind, url=f'https://lichess.org/{game["id"]}',
                       end_time=end // 1000 if end else None, clocks=True)
    record['user_accuracy'] = ((players.get(record['user_color']) or {}).get('analysis') or {}).get('accuracy')
    return record


# --- files ------------------------------------------------------------------------

def read_file(name, text, my_names):
    """Records from one uploaded file: PGN text, or the extension's JSON export."""
    if text.lstrip().startswith('{'):
        try:
            export = json.loads(text)
        except ValueError:
            raise ImportProblem('This file is not a PGN file or a chess.com export.') from None
        return chesscom_export(export, my_names)
    return pgn_games(text, my_names)


def pgn_players(text):
    """How often each player name appears in a PGN text, most frequent first."""
    names = re.findall(r'^\[(?:White|Black) "([^"]*)"\]', text, re.M)
    counts = {}
    for name in names:
        if name and name != '?':
            counts[name] = counts.get(name, 0) + 1
    return sorted(counts.items(), key=lambda item: -item[1])


def pgn_games(text, my_names):
    """Every game in a PGN text: (records, failed). A broken game does not stop the rest."""
    stream = io.StringIO(text)
    records, failed = [], []
    index = 0
    # read_game does not raise on a broken game: it records the problem in game.errors, which
    # game_record turns into that game's failure.
    while (game := chess.pgn.read_game(stream)) is not None:
        index += 1
        headers = game.headers
        try:
            site = headers.get('Site', '') + ' ' + headers.get('Link', '')
            if found := CHESSCOM_GAME.search(site):
                gid, kind, url = found.group(2), found.group(1), f'https://www.chess.com/game/{found.group(1)}/{found.group(2)}'
            elif found := LICHESS_GAME.search(site):
                gid, kind, url = f'li-{found.group(1)}', 'live', f'https://lichess.org/{found.group(1)}'
            else:
                digest = hashlib.sha1('|'.join([headers.get('White', ''), headers.get('Black', ''), headers.get('Date', ''),
                                                ' '.join(m.uci() for m in game.mainline_moves())]).encode(), usedforsecurity=False).hexdigest()
                gid, kind, url = f'pgn-{digest[:12]}', 'pgn', None
            records.append(game_record(game, my_names, id=gid, type=kind, url=url, clocks=True))
        except ValueError as exc:
            failed.append(failure(f'#{index}', headers.get('White'), headers.get('Black'), exc))
    return records, failed


def chesscom_export(export, my_names):
    """The browser extension's export: chess.com's internal game objects, bot games included."""
    if not isinstance(export, dict) or not isinstance(export.get('games'), list):
        raise ImportProblem('This JSON file is not a chess.com export from the extension.')
    records, failed = [], []
    for entry in export['games']:
        gid = str(entry.get('id'))
        try:
            game = entry['data'].get('game', entry['data'])
            if game.get('isFinished') is False:
                continue
            kind = entry.get('type') or ('computer' if game.get('isVsComputer') or game.get('isVsCoach')
                                         else 'live' if game.get('isLiveGame') else 'daily')
            pgn = build_pgn(game.get('pgnHeaders', {}), game['moveList'])
            record = to_record(pgn, my_names, id=gid, type=kind, url=f'https://www.chess.com/game/{kind}/{gid}',
                               end_time=game.get('endTime'))
            record['end_reason'] = game.get('resultMessage') or record['end_reason']
            record['move_timestamps'] = game.get('moveTimestamps') or game.get('timestamps') or []
            records.append(record)
        except (KeyError, TypeError, ValueError) as exc:
            failed.append(failure(gid, None, None, exc))
    return records, failed


# --- records ----------------------------------------------------------------------

def failure(where, white, black, exc):
    return {'where': str(where) if where is not None else None, 'white': white, 'black': black, 'error': str(exc) or type(exc).__name__}


def move_error(error):
    """python-chess's "illegal san: 'Ke5' in <fen>" as a sentence."""
    found = re.search(r"'([^']+)'", str(error))
    return f'The move {found.group(1)} is not legal there.' if found else 'A move could not be read.'


def to_record(pgn_text, my_names, **fields):
    """A games.jsonl record from one PGN game; `my_names` (lowercase) says which side you played."""
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        raise ValueError('No game was found.')
    return game_record(game, my_names, **fields)


def game_record(game, my_names, *, id, type, url=None, accuracy=None, end_time=None, clocks=False):
    """`clocks` keeps each move's [%clk] (and drops every other comment and NAG) for move-time analysis."""
    if game.errors:
        raise ValueError(move_error(game.errors[0]))
    headers = game.headers
    white, black = headers.get('White', '?'), headers.get('Black', '?')
    if white.lower() in my_names:
        color = 'white'
    elif black.lower() in my_names:
        color = 'black'
    else:
        raise ValueError('Neither player is you.')
    if not game.board().is_valid():
        raise ValueError('The game starts from an impossible position.')
    plies = sum(1 for _ in game.mainline_moves())
    if not plies:
        raise ValueError('The game has no moves.')
    mine, theirs = ('White', 'Black') if color == 'white' else ('Black', 'White')
    result = RESULTS.get(headers.get('Result'))
    rating = lambda side: int(headers[f'{side}Elo']) if headers.get(f'{side}Elo', '').isdigit() else None
    if clocks:
        game.comment = ''
        for node in game.mainline():
            clock, node.comment, node.starting_comment, node.nags = node.clock(), '', '', set()
            if clock is not None:
                node.set_clock(clock)
    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=clocks)
    return {
        'id': id,
        'type': type,
        'date': real_date(headers, end_time),
        'end_time_unix': end_time,
        'time_control': headers.get('TimeControl'),
        'opponent': headers.get(theirs, '?'),
        'user_color': color,
        'user_rating': rating(mine),
        'opp_rating': rating(theirs),
        'user_result': None if result is None else result[0 if color == 'white' else 1],
        'user_accuracy': accuracy,
        'end_reason': headers.get('Termination'),
        'plies': plies,
        'move_timestamps': [],
        'url': url,
        'pgn': game.accept(exporter),
    }


def summary(record, existing):
    """What the preview table shows for one candidate game."""
    return {'id': record['id'], 'date': record.get('date'), 'opponent': record.get('opponent'), 'type': record.get('type'),
            'user_color': record['user_color'], 'user_result': record.get('user_result'), 'plies': record.get('plies'),
            'user_rating': record.get('user_rating'), 'opp_rating': record.get('opp_rating'), 'exists': record['id'] in existing}


def existing_ids(games_file):
    return {r['id'] for r in jsonio.read_jsonl(games_file) if isinstance(r, dict) and 'id' in r}


def append(records, games_file):
    """Add `records` to the library, skipping games it already has: (added, duplicates)."""
    with FILE_LOCK:
        have = existing_ids(games_file)
        fresh = []
        for record in records:
            if record['id'] not in have:
                have.add(record['id'])
                fresh.append(record)
        if fresh:
            Path(games_file).parent.mkdir(parents=True, exist_ok=True)
            with Path(games_file).open('a', encoding='utf-8') as out:
                out.writelines(json.dumps(r) + '\n' for r in fresh)
    return len(fresh), len(records) - len(fresh)


def migrate_ids(data_dir):
    """Rewrite games.jsonl and analysis.jsonl once if they hold numeric ids (chess.com games were
    stored with their number before every id became a string), so readers compare ids as they are."""
    for name, lock in (('games.jsonl', FILE_LOCK), ('analysis.jsonl', analyze.ANALYSIS_LOCK)):
        path = Path(data_dir) / name
        with lock:
            rows = [r for r in jsonio.read_jsonl(path) if isinstance(r, dict)]
            if all(isinstance(r['id'], str) for r in rows if 'id' in r):
                continue
            jsonio.write_atomic(path, ''.join(json.dumps({**r, 'id': str(r['id'])} if 'id' in r else r) + '\n' for r in rows))


# --- the job the import page drives ---------------------------------------------------

FETCHERS = {'chesscom': chesscom_games, 'lichess': lichess_games}


class ImportJob(jobs.BackgroundJob):
    """Fetches (in a thread) or parses games into a preview, then commits the chosen ones.

    phase: idle -> fetching -> ready -> done, or error / cancelled. The page polls status().
    """
    busy_message = 'An import is already running.'
    label = 'The import'

    def __init__(self, fetchers=None):
        super().__init__(self._fresh('idle'))
        self.fetchers = fetchers or FETCHERS
        self.candidates = {}

    @staticmethod
    def _fresh(phase, source=None, username=None):
        return {'phase': phase, 'source': source, 'username': username, 'done': 0, 'total': 0, 'label': None,
                'error': None, 'games': [], 'failed': [], 'added': 0, 'duplicates': 0}

    def status(self):  # the page follows the phase; there is no 'running'
        with self.lock:
            return {**self.state, 'games': list(self.state['games']), 'failed': list(self.state['failed'])}

    def fetch(self, source, username, since, games_file, on_success=None):
        if source not in self.fetchers:
            raise ImportProblem('Choose chess.com or Lichess.')
        if not isinstance(username, str) or not re.fullmatch(r'[A-Za-z0-9_-]{2,30}', username.strip()):
            raise ImportProblem('Enter a valid username.')
        if since is not None and not (isinstance(since, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', since)):
            raise ImportProblem('Choose a valid date range.')
        if self.busy():
            raise jobs.JobBusy(self.busy_message)
        self.candidates = {}
        self.launch(self._fresh('fetching', source, username.strip()), source, username.strip(), since, games_file, on_success)

    def _progress(self, done, total, label):
        self.update(done=done, total=total, label=label)

    def work(self, source, username, since, games_file, on_success):
        records, failed = self.fetchers[source](username, since, progress=self._progress, should_stop=lambda: self.stopping)
        if self.stopping:
            self.update(phase='cancelled')
            return
        self.load(records, failed, games_file)
        if on_success:
            on_success(source, username)

    def failed(self, exc):
        if isinstance(exc, ImportProblem):  # written for the player
            self.update(phase='error', error=str(exc))
        else:
            super().failed(exc)
            self.update(phase='error', error=f'The import failed: {exc}')

    def load(self, records, failed, games_file, source=None):
        """Put parsed games up for preview (newest first)."""
        have = existing_ids(games_file)
        unique = {}
        for record in records:
            unique.setdefault(record['id'], record)
        ordered = sorted(unique.values(), key=lambda r: (r.get('date') or '', r.get('end_time_unix') or 0), reverse=True)
        with self.lock:
            self.candidates = {r['id']: r for r in ordered}
            if source is not None:
                self.state = self._fresh('ready', source)
            self.state.update(phase='ready', games=[summary(r, have) for r in ordered], failed=failed,
                              done=self.state['total'] or len(ordered), label=None)

    def commit(self, ids, games_file):
        with self.lock:
            if self.state['phase'] != 'ready':
                raise ImportProblem('There is nothing to import. Fetch or open games first.')
            chosen = [self.candidates[i] for i in map(str, ids) if i in self.candidates]
        added, duplicates = append(chosen, games_file)
        self.update(phase='done', added=added, duplicates=duplicates)
        return self.status()

    def cancel(self):
        self.stop()
        with self.lock:
            if not self.busy():
                self.candidates = {}
                self.state = self._fresh('idle')


JOB = ImportJob()
