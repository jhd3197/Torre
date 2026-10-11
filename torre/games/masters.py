"""Legend bots: players built from a master's own games (games/masters/<id>.pgn).

A legend opens with the moves that player actually chose. Every position reached in
the first BOOK_PLIES of their games, with them to move, maps to the moves they played
there and how often; a legend picks among those weighted by that count. Once a game
leaves the positions they ever reached, an engine carries on at their peak rating.

The PGNs come from download_masters.py (PGN Mentor's player files) in games/masters/,
or from the Arena's download button, which saves them in data/masters/pgn/. Summaries
come from the headers alone, which is quick; the opening book is built on first use
and cached in data/masters/<id>.json until the PGN changes.
"""
import contextlib
import json
import logging
import os
import random
import re
import threading
import time
import unicodedata
from collections import Counter
from pathlib import Path

import chess

from torre.games import download_masters
from torre.server import jobs
from torre import paths
log = logging.getLogger(__name__)

ROOT = paths.REPO
PGN_DIR = ROOT / 'games' / 'masters'
DATA_DIR = Path(os.environ.get('CHESS_STUDIO_DATA', str(ROOT / 'data')))
BOOK_PLIES = 40          # the book covers each game's first 20 moves
BOOK_VERSION = 1         # bump when the cache format changes
UNRATED_ELO = 2500       # strength after the book for players from before ratings
MAX_ELO = 3190           # Stockfish's UCI_Elo ceiling

# How the champions download_masters.py fetches are known; the file's own spelling otherwise.
NAMES = {'Philidor': 'François-André Philidor', 'DeLaBourdonnais': 'Louis de la Bourdonnais', 'Anderssen': 'Adolf Anderssen',
         'Morphy': 'Paul Morphy', 'Steinitz': 'Wilhelm Steinitz', 'Chigorin': 'Mikhail Chigorin', 'Pillsbury': 'Harry Pillsbury',
         'Lasker': 'Emanuel Lasker', 'Rubinstein': 'Akiba Rubinstein', 'Capablanca': 'José Raúl Capablanca',
         'Alekhine': 'Alexander Alekhine', 'Nimzowitsch': 'Aron Nimzowitsch', 'Reti': 'Richard Réti', 'Euwe': 'Max Euwe',
         'Botvinnik': 'Mikhail Botvinnik', 'Smyslov': 'Vasily Smyslov', 'Tal': 'Mikhail Tal', 'Petrosian': 'Tigran Petrosian',
         'Spassky': 'Boris Spassky', 'Fischer': 'Bobby Fischer', 'Karpov': 'Anatoly Karpov', 'Korchnoi': 'Viktor Korchnoi',
         'Kasparov': 'Garry Kasparov', 'Kramnik': 'Vladimir Kramnik', 'Anand': 'Viswanathan Anand', 'Carlsen': 'Magnus Carlsen',
         'PolgarJ': 'Judit Polgar', 'Marshall': 'Frank Marshall', 'Tartakower': 'Savielly Tartakower', 'Keres': 'Paul Keres',
         'Bronstein': 'David Bronstein', 'Najdorf': 'Miguel Najdorf', 'Larsen': 'Bent Larsen',
         'Gaprindashvili': 'Nona Gaprindashvili', 'Chiburdanidze': 'Maia Chiburdanidze', 'PolgarS': 'Susan Polgar',
         'Topalov': 'Veselin Topalov', 'Hou': 'Hou Yifan', 'Ding': 'Ding Liren', 'Gukesh': 'Gukesh Dommaraju',
         'Nakamura': 'Hikaru Nakamura', 'Caruana': 'Fabiano Caruana', 'Nepomniachtchi': 'Ian Nepomniachtchi',
         'Aronian': 'Levon Aronian', 'Firouzja': 'Alireza Firouzja', 'So': 'Wesley So'}

_HEADER = re.compile(r'^\[(\w+)\s+"(.*)"\]\s*$')
_COMMENT = re.compile(r'\{[^}]*\}|;[^\n]*')
_VARIATION = re.compile(r'\([^()]*\)')
_NOISE = re.compile(r'\$\d+|\d+\.(?:\.\.)?|1-0|0-1|1/2-1/2|\*')
_LOCK = threading.Lock()
_summaries = {}  # id -> (pgn mtime, summary)
_books = {}      # id -> (pgn mtime, book)


class MasterError(ValueError):
    """No such master, or their PGN cannot be read."""


def _fold(text):
    """Lowercase ASCII, so 'Polgár' and 'Polgar' match."""
    return unicodedata.normalize('NFKD', text or '').encode('ascii', 'ignore').decode().lower()


def _surname(name):
    return re.split(r'[,\s.]+', _fold(name).strip(), maxsplit=1)[0]


def _display(name):
    """'Carlsen,Magnus' -> 'Magnus Carlsen'."""
    if ',' in name:
        last, first = (part.strip() for part in name.split(',', 1))
        return f'{first} {last}'.strip()
    return name.strip()


def _pretty_id(master_id):
    """'PolgarJ' -> 'Polgar J', for a master whose file has no names to go by."""
    return re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', master_id)


def use_data_dir(path):
    """Point downloads and book caches at another data folder (studio's --data-dir)."""
    global DATA_DIR
    with _LOCK:
        DATA_DIR = Path(path)
        _books.clear()


def _folders():
    return [PGN_DIR, DATA_DIR / 'masters' / 'pgn']


def _valid_id(master_id):
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,40}', str(master_id or '')):
        raise MasterError(f'Unknown master: {master_id}.')
    return str(master_id)


def path_for(master_id):
    master_id = _valid_id(master_id)
    for folder in _folders():
        if (folder / f'{master_id}.pgn').is_file():
            return folder / f'{master_id}.pgn'
    raise MasterError(f'Unknown master: {master_id}.')


def _games(text):
    """(headers, movetext) for every game in a PGN file."""
    headers, moves = {}, []
    for line in text.splitlines():
        match = _HEADER.match(line)
        if match:
            if moves:
                yield headers, ' '.join(moves)
                headers, moves = {}, []
            headers[match.group(1)] = match.group(2)
        elif line.strip() and headers:
            moves.append(line)
    if headers:
        yield headers, ' '.join(moves)


def _who(headers, surname):
    """'white' or 'black' for the master's side, or None when both or neither match."""
    white, black = _surname(headers.get('White')) == surname, _surname(headers.get('Black')) == surname
    return 'white' if white and not black else 'black' if black and not white else None


def _identity(text):
    """The master's surname key and display name: the most common player in the file."""
    names = Counter()
    for headers, _ in _games(text):
        names[headers.get('White', '')] += 1
        names[headers.get('Black', '')] += 1
    names.pop('', None)
    if not names:
        return None, None
    surname = _surname(names.most_common(1)[0][0])
    # The commonest spelling with a full first name reads best ('Carlsen,Magnus' over 'Carlsen,M').
    variants = [n for n in names if _surname(n) == surname]
    full = [n for n in variants if re.fullmatch(r"[^\W\d_][\w' -]*,\s*[^\W\d_]{2,}[\w' .-]*", n)]
    return surname, _display(max(full or variants, key=lambda n: names[n]))


def _year(headers):
    found = re.match(r'(\d{4})', headers.get('Date', ''))
    return int(found.group(1)) if found else None


def summary(master_id):
    """Who the master is and how their games went, from the headers alone (cached by mtime)."""
    path = path_for(master_id)
    mtime = path.stat().st_mtime_ns
    with _LOCK:
        cached = _summaries.get(master_id)
        if cached and cached[0] == mtime:
            return cached[1]
    text = path.read_text(encoding='utf-8', errors='replace')
    surname, name = _identity(text)
    games, record, elos, years = 0, Counter(), [], []
    for headers, _ in _games(text):
        side = _who(headers, surname) if surname else None
        if side is None:
            continue
        games += 1
        result = headers.get('Result')
        if result in ('1-0', '0-1'):
            record['win' if (result == '1-0') == (side == 'white') else 'loss'] += 1
        elif result == '1/2-1/2':
            record['draw'] += 1
        elo = headers.get('WhiteElo' if side == 'white' else 'BlackElo', '')
        if elo.isdigit() and 1000 < int(elo) < 3000:
            elos.append(int(elo))
        if _year(headers):
            years.append(_year(headers))
    peak = max(elos) if elos else None
    data = {'id': master_id, 'name': NAMES.get(master_id) or name or _pretty_id(master_id), 'games': games,
            'wins': record['win'], 'draws': record['draw'], 'losses': record['loss'],
            'peak': peak, 'elo': min(peak or UNRATED_ELO, MAX_ELO), 'rated': peak is not None,
            'years': [min(years), max(years)] if years else None}
    with _LOCK:
        _summaries[master_id] = (mtime, data)
    return data


def available():
    """A summary for every master PGN on disk, best known first."""
    found, seen = [], set()
    for path in sorted(p for folder in _folders() if folder.is_dir() for p in folder.glob('*.pgn')):
        if path.stem in seen:
            continue
        seen.add(path.stem)
        try:
            info = summary(path.stem)
        except (MasterError, OSError):
            continue
        if info['games']:
            found.append(info)
    return sorted(found, key=lambda m: -m['games'])


def position_key(board):
    """A position independent of how it was reached (move counters left out)."""
    return ' '.join(board.fen().split()[:4])


def _build(master_id, path):
    text = path.read_text(encoding='utf-8', errors='replace')
    surname, _ = _identity(text)
    book, games = {}, []
    first_white, first_black = Counter(), Counter()
    for headers, movetext in _games(text):
        side = _who(headers, surname) if surname else None
        if side is None:
            continue
        index = len(games)
        opponent = headers.get('Black' if side == 'white' else 'White', '')
        games.append([_display(opponent), _year(headers), headers.get('Result', '*'), headers.get('Event', '')])
        board = chess.Board()
        movetext = _COMMENT.sub(' ', movetext)
        while '(' in movetext:  # variations, innermost first: the main line is all the book needs
            stripped = _VARIATION.sub(' ', movetext)
            if stripped == movetext:
                break
            movetext = stripped
        tokens = _NOISE.sub(' ', movetext).split()
        for ply, token in enumerate(tokens[:BOOK_PLIES]):
            try:
                move = board.parse_san(token)
            except ValueError:
                break
            if (board.turn == chess.WHITE) == (side == 'white'):
                entry = book.setdefault(position_key(board), {})
                count, _ = entry.get(move.uci(), (0, index))
                entry[move.uci()] = [count + 1, index]  # the latest game that played it
                if ply == 0:
                    first_white[board.san(move)] += 1
                elif ply == 1:
                    first_black[(board.peek().uci(), board.san(move))] += 1
            board.push(move)
    total_white = sum(first_white.values()) or 1
    replies = {}
    for (theirs, ours), count in first_black.most_common():
        replies.setdefault(theirs, []).append([ours, count])
    openings = {'white': [[san, round(100 * n / total_white)] for san, n in first_white.most_common(4)],
                'black': {uci: [[san, n] for san, n in moves[:3]] for uci, moves in replies.items() if uci in ('e2e4', 'd2d4', 'c2c4', 'g1f3')}}
    return {'version': BOOK_VERSION, 'id': master_id, 'book': book, 'games': games, 'openings': openings}


def book(master_id):
    """The master's opening book, built from their PGN on first use and cached on disk."""
    path = path_for(master_id)
    mtime = path.stat().st_mtime_ns
    with _LOCK:
        cached = _books.get(master_id)
        if cached and cached[0] == mtime:
            return cached[1]
        cache = DATA_DIR / 'masters' / f'{master_id}.json'
        data = None
        try:
            stored = json.loads(cache.read_text(encoding='utf-8'))
            if stored.get('version') == BOOK_VERSION and stored.get('mtime') == mtime:
                data = stored
        except (OSError, ValueError):
            pass
        if data is None:
            data = {**_build(master_id, path), 'mtime': mtime}
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
        _books[master_id] = (mtime, data)
        return data


def profile(master_id):
    """The summary plus what the book knows: favourite first moves and how many positions it covers."""
    data = book(master_id)
    return {**summary(master_id), 'openings': data['openings'], 'positions': len(data['book'])}


def book_move(data, board, rng=random):
    """A move the master played from this position, chosen in proportion to how often,
    with how often and one game they played it in; None once the book has no answer."""
    entry = data['book'].get(position_key(board))
    if not entry:
        return None
    moves = [(chess.Move.from_uci(uci), count, index) for uci, (count, index) in entry.items()]
    moves = [m for m in moves if m[0] in board.legal_moves]
    if not moves:
        return None
    move, count, index = rng.choices(moves, weights=[m[1] for m in moves])[0]
    opponent, year, result, event = data['games'][index]
    return {'move': move, 'count': count, 'total': sum(m[1] for m in moves),
            'game': {'opponent': opponent, 'year': year, 'result': result, 'event': event}}


def download(master_id):
    """Fetch one champion's file from PGN Mentor (download_masters.py's source) into data/masters/pgn/."""
    master_id = _valid_id(master_id)
    if master_id not in download_masters.CHAMPIONS:
        raise MasterError(f'Unknown master: {master_id}.')
    try:
        data = download_masters.fetch(master_id)
    except Exception as exc:
        raise MasterError(f'Could not download {master_id} from PGN Mentor: {exc}')
    folder = DATA_DIR / 'masters' / 'pgn'
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f'{master_id}.pgn').write_bytes(data)
    return summary(master_id)


def missing():
    """The champions download_masters.py knows that are not on disk yet, with their names."""
    have = {m['id'] for m in available()}
    return [{'id': c, 'name': NAMES.get(c, _pretty_id(c))} for c in download_masters.CHAMPIONS if c not in have]


class FillJob(jobs.BackgroundJob):
    """The first-run fill: a fresh install has no PGNs, so the studio fetches every missing legend
    in the background, one at a time. A failure skips that one (it can be retried by hand)."""
    busy_message = "The legends' games are already downloading."
    label = "Downloading the legends' games"

    def __init__(self):
        super().__init__({'running': False, 'done': 0, 'total': 0, 'current': None, 'failed': []})

    def start(self, pause=download_masters.PAUSE):
        self.launch({'running': True, 'done': 0, 'total': 0, 'current': None, 'failed': []}, pause)

    def work(self, pause):
        todo = [m['id'] for m in missing()]
        self.update(total=len(todo))
        for i, master_id in enumerate(todo):
            if self.stopping:
                break
            if i:
                time.sleep(pause)
            self.update(current=master_id)
            try:
                download(master_id)
            except MasterError as exc:
                log.warning('%s', exc)
                with self.lock:
                    self.state['failed'].append(master_id)
            with self.lock:
                self.state['done'] += 1

    def failed(self, exc):  # the status has no error field: the legends can be downloaded by hand
        log.error('%s failed', self.label, exc_info=exc)

    def finished(self):
        self.update(current=None)


FILL = FillJob()


def fill_status():
    return FILL.status()


def start_fill():
    """Fill in the background, unless CHESS_NO_LEGEND_DOWNLOAD is set, nothing is missing, or it already runs."""
    if os.environ.get('CHESS_NO_LEGEND_DOWNLOAD') or not missing():
        return
    with contextlib.suppress(jobs.JobBusy):
        FILL.start()
