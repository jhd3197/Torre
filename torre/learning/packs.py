"""Downloadable voice packs: the coach's recorded lines, one pack per language and voice (female, male).

Packs are zips built by tools/build_packs.py and published on the GitHub release `voice-packs`,
next to packs.json, which lists them (id, language, size, sha256...). The studio downloads one on
request, checks its sha256 and unpacks it into <data dir>/packs/<id>/, where audio/<voice>/... is
served from (<voice> is "en" for the female English voice, "en-male" for the male one; see VOICES). CHESS_PACKS_URL points somewhere else: another URL, or a local folder holding
packs.json and the zips (for testing without publishing).
"""
import hashlib
import json
import logging
import os
import shutil
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

from torre.server import jobs
log = logging.getLogger(__name__)

DEFAULT_URL = 'https://github.com/jhd3197/Torre/releases/download/voice-packs/'
CATALOG_TTL = 600  # seconds the published list is trusted before asking again
CHUNK = 1 << 16

_catalog = {'at': 0.0, 'url': None, 'packs': []}
_catalog_lock = threading.Lock()


def source():
    return os.environ.get('CHESS_PACKS_URL') or DEFAULT_URL


def _open(url, name):
    """A readable stream and its size for `name` under `url` (a web address or a local folder)."""
    if '://' not in url:
        path = Path(url) / name
        return path.open('rb'), path.stat().st_size
    response = urllib.request.urlopen(url.rstrip('/') + '/' + name, timeout=30)  # nosec B310: our release URL
    return response, int(response.headers.get('Content-Length') or 0)


def available():
    """The packs published at the source; [] when it cannot be reached (offline)."""
    url = source()
    with _catalog_lock:
        if _catalog['url'] == url and time.time() - _catalog['at'] < CATALOG_TTL:
            return _catalog['packs']
    try:
        stream, _ = _open(url, 'packs.json')
        with stream:
            packs = json.loads(stream.read().decode('utf-8')).get('packs', [])
    except (OSError, ValueError):
        packs = []
    with _catalog_lock:
        _catalog.update(at=time.time(), url=url, packs=packs)
    return packs


def installed(data_dir):
    """{id: pack info} for the packs unpacked in the data folder."""
    out = {}
    folder = Path(data_dir) / 'packs'
    for info in folder.glob('*/pack.json'):
        try:
            data = json.loads(info.read_text(encoding='utf-8'))
            out[data['id']] = data
        except (OSError, ValueError, KeyError):
            continue
    return out


VOICES = ('en', 'en-male', 'es', 'es-male')


def audio_file(data_dir, voice, name):
    """The installed recording for /audio/<voice>/<name>, or None. Never leaves the pack folder."""
    if voice not in VOICES or '/' in name or '\\' in name or not name.endswith(('.mp3', '.json')):
        return None
    path = Path(data_dir) / 'packs' / f'voice-{voice}' / name
    return path if path.is_file() else None


def remove(data_dir, pack_id):
    folder = Path(data_dir) / 'packs' / pack_id
    if folder.parent != Path(data_dir) / 'packs':
        raise ValueError('Unknown pack.')
    shutil.rmtree(folder, ignore_errors=True)


class PackJob(jobs.BackgroundJob):
    """Downloads and installs one pack at a time; the UI polls status()."""
    busy_message = 'A voice pack is already downloading.'
    label = 'The voice pack download'

    def __init__(self):
        super().__init__({'running': False, 'id': None, 'done': 0, 'total': 0, 'error': None})

    def start(self, data_dir, pack_id):
        pack = next((p for p in available() if p.get('id') == pack_id), None)
        if pack is None:
            raise ValueError('That voice pack is not available right now.')
        self.launch({'running': True, 'id': pack_id, 'done': 0, 'total': pack.get('bytes', 0), 'error': None},
                    Path(data_dir), pack)

    def work(self, data_dir, pack):
        packs_dir = data_dir / 'packs'
        packs_dir.mkdir(parents=True, exist_ok=True)
        download = packs_dir / f'{pack["id"]}.zip.part'
        staging = packs_dir / f'{pack["id"]}.new'
        try:
            digest = hashlib.sha256()
            stream, size = _open(source(), pack['file'])
            self.update(total=size or pack.get('bytes', 0))
            with stream, download.open('wb') as out:
                while chunk := stream.read(CHUNK):
                    if self.stopping:  # cancelled: no error, nothing downloaded
                        self.update(done=0)
                        return
                    out.write(chunk)
                    digest.update(chunk)
                    with self.lock:
                        self.state['done'] += len(chunk)
            if digest.hexdigest() != pack['sha256']:
                raise ValueError('The download was damaged. Please try again.')
            shutil.rmtree(staging, ignore_errors=True)
            with zipfile.ZipFile(download) as archive:
                for member in archive.namelist():
                    if member.startswith(('/', '\\')) or '..' in Path(member).parts:
                        raise ValueError('The voice pack has an unsafe file name.')
                archive.extractall(staging)
            (staging / 'pack.json').write_text(json.dumps({k: pack[k] for k in pack if k != 'file'}), encoding='utf-8')
            target = packs_dir / pack['id']
            shutil.rmtree(target, ignore_errors=True)
            staging.replace(target)
        finally:
            download.unlink(missing_ok=True)
            shutil.rmtree(staging, ignore_errors=True)

    def failed(self, exc):
        log.warning('The voice pack download failed', exc_info=exc)
        # Our own ValueErrors are written for the reader; anything else is a network or disk problem.
        self.update(error=str(exc) if isinstance(exc, ValueError) else 'The download failed. Check your connection and try again.')


JOB = PackJob()


def view(data_dir):
    """Voice packs for the UI: what can be downloaded, what is installed, and the download in progress."""
    have = installed(data_dir)
    # Up to date means the very same zip (sha256), so a second fix published the same day still shows Update.
    listed = [{**p, 'installed': p['id'] in have, 'current': have.get(p['id'], {}).get('sha256') == p.get('sha256')}
              for p in available()]
    listed += [{**info, 'installed': True, 'current': True} for pid, info in have.items() if pid not in {p['id'] for p in listed}]
    return {'packs': listed, 'job': JOB.status()}
