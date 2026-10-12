"""Engine registry: the catalog of chess engines Torre can use, and their processes.

The catalog lives in data/engines.json, merged over the built-in list below so a
release can add engines without touching the user's file. Stockfish resolves the
way it always has (STOCKFISH_PATH, a packaged engine/, the local download, PATH);
every other engine resolves from its registry entry or engines/<id>/, which is
where install() puts binaries downloaded from the pinned releases below.
"""
import atexit
import contextlib
import copy
import hashlib
import json
import math
import os
import re
import shutil
import sys
import tempfile
import threading
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import chess
import chess.engine

from torre.analysis import limits
from torre.server import jobs
from torre import jsonio
from torre import paths
from torre import net
ROOT = paths.HOME  # engines/, engine/ and stockfish_dist/ live here
DATA_DIR = paths.DATA

STOCKFISH_MIN_ELO, STOCKFISH_MAX_ELO = 1320, 3190


class EngineNotInstalled(chess.engine.EngineError):
    """The registry knows the engine, but no binary for it is on disk."""


class InstallError(Exception):
    """An engine could not be downloaded, verified, probed or registered."""


def _download(url, archive, size, binary_relpath=None, cpu='x86-64-v3 (AVX2)'):
    """Release asset metadata for one platform. Upstream publishes no checksums, so
    downloads are verified by byte size and by probing the binary afterwards."""
    return {'url': url, 'archive': archive, 'binary_relpath': binary_relpath, 'size': size, 'sha256': None, 'cpu': cpu}


BUILTIN_ENGINES = [
    {'id': 'stockfish', 'name': 'Stockfish', 'version': None, 'type': 'nnue', 'protocol': 'uci',
     'executable': None, 'capabilities': {'limit_strength': True, 'skill_level': True, 'multipv': True},
     'strength_ccrl': 3650, 'license': 'GPL-3.0', 'repo_url': 'https://github.com/official-stockfish/Stockfish',
     'description': 'The strongest open-source engine; powers analysis and the sparring bots.',
     'custom': False, 'installed': True, 'models': [], 'download': None},
    {'id': 'reckless', 'name': 'Reckless', 'version': '0.10.0-dev', 'type': 'nnue', 'protocol': 'uci',
     'executable': None, 'capabilities': {'limit_strength': False, 'skill_level': False, 'multipv': True},
     'strength_ccrl': 3570, 'license': 'AGPL-3.0', 'repo_url': 'https://github.com/codedeliveryservice/Reckless',
     'description': 'A top NNUE engine with an aggressive search style. The download is a development build.',
     'custom': False, 'installed': False, 'models': [],
     'download': {
         'windows': _download('https://github.com/codedeliveryservice/Reckless/releases/download/v0.10.0-dev-7300f044/reckless-windows-avx2.exe', 'raw', 64721920),
         'linux': _download('https://github.com/codedeliveryservice/Reckless/releases/download/v0.10.0-dev-7300f044/reckless-linux-avx2', 'raw', 65097320),
         'macos': _download('https://github.com/codedeliveryservice/Reckless/releases/download/v0.10.0-dev-7300f044/reckless-macos', 'raw', 65406320, cpu='Apple silicon')}},
    {'id': 'plentychess', 'name': 'PlentyChess', 'version': '8.0.0', 'type': 'nnue', 'protocol': 'uci',
     'executable': None, 'capabilities': {'limit_strength': False, 'skill_level': False, 'multipv': True},
     'strength_ccrl': 3560, 'license': 'GPL-3.0', 'repo_url': 'https://github.com/Yoshie2000/PlentyChess',
     'description': 'A strong self-taught NNUE engine.',
     'custom': False, 'installed': False, 'models': [],
     'download': {
         'windows': _download('https://github.com/Yoshie2000/PlentyChess/releases/download/b-v8.0.0/PlentyChess-8.0.0-windows-avx2.exe', 'raw', 53943296),
         'linux': _download('https://github.com/Yoshie2000/PlentyChess/releases/download/b-v8.0.0/PlentyChess-8.0.0-linux-avx2', 'raw', 53608928),
         'macos': _download('https://github.com/Yoshie2000/PlentyChess/releases/download/b-v8.0.0/PlentyChess-8.0.0-macos-neon', 'raw', 53909160, cpu='Apple silicon')}},
    {'id': 'obsidian', 'name': 'Obsidian', 'version': '16.0', 'type': 'nnue', 'protocol': 'uci',
     'executable': None, 'capabilities': {'limit_strength': False, 'skill_level': False, 'multipv': True},
     'strength_ccrl': 3555, 'license': 'GPL-3.0', 'repo_url': 'https://github.com/gab8192/Obsidian',
     'description': 'A top NNUE engine known for sharp tactical play.',
     'custom': False, 'installed': False, 'models': [],
     'download': {
         'windows': _download('https://github.com/gab8192/Obsidian/releases/download/v16.0/Obsidian160-avx2.exe', 'raw', 32239104)}},
    {'id': 'stormphrax', 'name': 'Stormphrax', 'version': '8.0.0', 'type': 'nnue', 'protocol': 'uci',
     'executable': None, 'capabilities': {'limit_strength': False, 'skill_level': False, 'multipv': True},
     'strength_ccrl': 3550, 'license': 'GPL-3.0', 'repo_url': 'https://github.com/Ciekce/Stormphrax',
     'description': 'A strong NNUE engine with a clean, modern search.',
     'custom': False, 'installed': False, 'models': [],
     'download': {
         'windows': _download('https://github.com/Ciekce/Stormphrax/releases/download/v8.0.0/stormphrax-8.0.0-avx2-bmi2.exe', 'raw', 57000448),
         'linux': _download('https://github.com/Ciekce/Stormphrax/releases/download/v8.0.0/stormphrax-8.0.0-avx2-bmi2', 'raw', 56785872),
         'macos': _download('https://github.com/Ciekce/Stormphrax/releases/download/v8.0.0/stormphrax-8.0.0-apple-m1', 'raw', 57057112, cpu='Apple silicon')}},
    {'id': 'berserk', 'name': 'Berserk', 'version': '4.7.0', 'type': 'nnue', 'protocol': 'uci',
     'executable': None, 'capabilities': {'limit_strength': False, 'skill_level': False, 'multipv': True},
     'strength_ccrl': 3500, 'license': 'GPL-3.0', 'repo_url': 'https://github.com/jhonnold/berserk',
     'description': 'A strong NNUE engine in a tiny download, with its playing strength options.',
     'custom': False, 'installed': False, 'models': [],
     'download': {
         'windows': _download('https://github.com/jhonnold/berserk/releases/download/4.7.0/berserk-4.7.0-avx2.exe', 'raw', 1414899)}},
    {'id': 'lc0', 'name': 'Leela Chess Zero', 'version': '0.32.1', 'type': 'neural', 'protocol': 'uci',
     'executable': None, 'capabilities': {'limit_strength': False, 'skill_level': False, 'multipv': True},
     'strength_ccrl': 3600, 'license': 'GPL-3.0', 'repo_url': 'https://github.com/LeelaChessZero/lc0',
     'description': 'A neural-network engine; plays from learned evaluation instead of search depth. The download is the CPU build.',
     'custom': False, 'installed': False,
     'models': [
         {'id': 'maia-1100', 'name': 'Maia 1100', 'weights': 'maia-1100.pb.gz', 'installed': False,
          'uci_options': {'WeightsFile': 'maia-1100.pb.gz'}, 'go_override': {'nodes': 1},
          'rating_target': 1100, 'style': 'human',
          'download': {'url': 'https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-1100.pb.gz', 'size': 1313193, 'sha256': None}},
         {'id': 'maia-1500', 'name': 'Maia 1500', 'weights': 'maia-1500.pb.gz', 'installed': False,
          'uci_options': {'WeightsFile': 'maia-1500.pb.gz'}, 'go_override': {'nodes': 1},
          'rating_target': 1500, 'style': 'human',
          'download': {'url': 'https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-1500.pb.gz', 'size': 1258199, 'sha256': None}},
         {'id': 'maia-1900', 'name': 'Maia 1900', 'weights': 'maia-1900.pb.gz', 'installed': False,
          'uci_options': {'WeightsFile': 'maia-1900.pb.gz'}, 'go_override': {'nodes': 1},
          'rating_target': 1900, 'style': 'human',
          'download': {'url': 'https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-1900.pb.gz', 'size': 1262607, 'sha256': None}},
     ],
     'download': {
         'windows': _download('https://github.com/LeelaChessZero/lc0/releases/download/v0.32.1/lc0-v0.32.1-windows-cpu-dnnl.zip', 'zip', 24001097, binary_relpath='lc0.exe', cpu='any x86-64 (CPU build)')}},
]

REGISTRY_LOCK = threading.RLock()
_registry = None


def use_data_dir(path):
    """Point the registry at another data folder (studio's --data-dir)."""
    global DATA_DIR, _registry
    with REGISTRY_LOCK:
        _registry = None
        DATA_DIR = Path(path)


def load_registry():
    """The catalog: built-ins merged under whatever data/engines.json holds."""
    global _registry
    with REGISTRY_LOCK:
        if _registry is not None:
            return _registry
        stored, original = {}, []
        path = DATA_DIR / 'engines.json'
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
            original = [e for e in data.get('engines', []) if isinstance(e, dict)]
            stored = {e.get('id'): e for e in original}
        except (OSError, ValueError):
            pass
        merged = []
        for builtin in BUILTIN_ENGINES:
            entry = copy.deepcopy(builtin)
            override = stored.pop(builtin['id'], None)
            if override:
                # Catalog metadata follows the builtin; the stored copy only keeps
                # the install state and what the binary itself told us.
                for key in ('installed', 'executable', 'capabilities', 'version'):
                    if override.get(key):
                        entry[key] = override[key]
                stored_models = {m.get('id'): m for m in override.get('models', []) if isinstance(m, dict)}
                for model in entry.get('models', []):
                    if stored_models.get(model['id'], {}).get('installed'):
                        model['installed'] = True
            merged.append(entry)
        merged += list(stored.values())  # engines the user added
        _registry = {'engines': merged}
        if merged != original:
            save_registry()
        return _registry


def save_registry():
    with REGISTRY_LOCK:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        jsonio.write_json(DATA_DIR / 'engines.json', _registry, trailing_newline=True, indent=2)


def get(engine_id):
    """The catalog entry for `engine_id`, or None when it is not registered."""
    for entry in load_registry()['engines']:
        if entry.get('id') == engine_id:
            return entry
    return None


def resolve_engine(engine_id):
    """The binary for `engine_id`: a Path (maybe not yet existing for stockfish), else None."""
    if engine_id == 'stockfish':
        if os.environ.get('STOCKFISH_PATH'):
            return Path(os.environ['STOCKFISH_PATH'])
        for folder in (ROOT / 'engine', ROOT / 'stockfish_dist/stockfish'):
            found = sorted(folder.glob('stockfish*')) if folder.is_dir() else []
            found = [f for f in found if f.is_file() and f.suffix in ('', '.exe')]
            if found:
                return found[0]
        on_path = shutil.which('stockfish')
        return Path(on_path) if on_path else ROOT / 'engine/stockfish'
    entry = get(engine_id)
    if entry is None:
        return None
    if entry.get('executable'):
        path = Path(entry['executable'])
        path = path if path.is_absolute() else ROOT / path
        return path if path.exists() else None
    folder = ROOT / 'engines' / engine_id
    if folder.is_dir():
        found = sorted(f for f in folder.glob('*') if f.is_file() and f.suffix in ('', '.exe'))
        if found:
            return found[0]
    return None


def installed(engine_id):
    path = resolve_engine(engine_id)
    return path is not None and path.exists()


def catalog():
    """The registry with each entry's live installed status, for /api/engines."""
    return [{**entry, 'installed': installed(entry['id'])} for entry in load_registry()['engines']]


def probe(path):
    """Handshake with a binary: its name, and the strength and MultiPV options it offers."""
    engine = chess.engine.SimpleEngine.popen_uci(str(path), timeout=10)
    try:
        multipv = engine.options.get('MultiPV')
        return {'name': engine.id.get('name', Path(path).stem),
                'options': {'limit_strength': 'UCI_LimitStrength' in engine.options,
                            'skill_level': 'Skill Level' in engine.options,
                            'multipv_max': multipv.max if multipv is not None else 1}}
    finally:
        with contextlib.suppress(chess.engine.EngineError, OSError):
            engine.quit()


def _platform():
    if sys.platform.startswith('win'):
        return 'windows'
    if sys.platform == 'darwin':
        return 'macos'
    return 'linux'


def _probed_into(entry, path):
    """Update `entry`'s capabilities and version from the binary's own handshake."""
    try:
        info = probe(path)
    except (chess.engine.EngineError, OSError) as exc:
        raise InstallError(f'{entry["name"]} was installed but did not answer the UCI handshake: {exc}')
    entry['capabilities'] = {'limit_strength': info['options']['limit_strength'],
                             'skill_level': info['options']['skill_level'],
                             'multipv': info['options']['multipv_max'] > 1}
    name = info['name']
    if name.lower().startswith(entry['name'].lower()):
        version = name[len(entry['name']):].strip(' -_v')
        if version:
            entry['version'] = version


def _fetch(url, expected, report, label):
    """Download `url` to a temp file, verifying sha256 when published, else byte size.
    `expected` is the catalog's download dict; `report(phase, downloaded, total)` gets the bytes."""
    handle, temp_path = tempfile.mkstemp(suffix='.download')
    os.close(handle)
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Torre-Engine-Lab'})
        with net.urlopen(request, timeout=120) as response, open(temp_path, 'wb') as out:
            total = int(response.headers.get('Content-Length') or expected.get('size') or 0)
            downloaded = 0
            while True:
                chunk = response.read(1 << 16)
                if not chunk:
                    break
                out.write(chunk)
                downloaded += len(chunk)
                report('download', downloaded, total)
        data = Path(temp_path).read_bytes()
        if expected.get('sha256') and hashlib.sha256(data).hexdigest() != expected['sha256']:
            raise InstallError(f'The download of {label} did not match its published checksum.')
        if expected.get('size') and len(data) != expected['size']:
            raise InstallError(f'The download of {label} is {len(data)} bytes, expected {expected["size"]}.')
        return temp_path, downloaded, total
    except Exception:
        with contextlib.suppress(OSError):
            os.unlink(temp_path)
        raise


def install(engine_id, progress_cb=None):
    """Download the pinned release of `engine_id` into engines/<id>/, verify it
    (sha256 when published, else byte size), probe it, and mark it installed.
    progress_cb(phase, downloaded, total) reports 'download' bytes and the later phases."""
    def report(phase, downloaded=0, total=0):
        if progress_cb:
            progress_cb(phase, downloaded, total)

    entry = get(engine_id)
    if entry is None:
        raise InstallError(f'Unknown engine: {engine_id}.')
    if engine_id == 'stockfish':
        raise InstallError('Stockfish installs with the app.')
    download = (entry.get('download') or {}).get(_platform())
    if not download:
        raise InstallError(f'{entry["name"]} has no download for this platform; add it by path instead.')
    POOL.close(engine_id)  # a running process keeps the binary locked on Windows
    target_dir = ROOT / 'engines' / engine_id
    created = not target_dir.exists()
    temp_path = None
    try:
        temp_path, downloaded, total = _fetch(download['url'], download, report, entry['name'])
        report('extract', downloaded, total)
        target_dir.mkdir(parents=True, exist_ok=True)
        if download['archive'] == 'zip':
            with zipfile.ZipFile(temp_path) as archive:
                archive.extractall(target_dir)
            binary = target_dir / download['binary_relpath'] if download.get('binary_relpath') else None
            if binary is None or not binary.exists():
                found = sorted(target_dir.rglob('*.exe' if _platform() == 'windows' else '*'))
                binary = next((f for f in found if f.is_file()), None)
        elif download['archive'] == 'raw':
            binary = target_dir / download['url'].rsplit('/', 1)[-1]
            shutil.move(temp_path, binary)
            temp_path = None
            if _platform() != 'windows':
                binary.chmod(0o755)
        else:
            raise InstallError(f"{entry['name']} ships a {download['archive']} archive, which this app cannot extract; add it by path instead.")
        if binary is None or not binary.exists():
            raise InstallError(f'No engine binary was found in the {entry["name"]} download.')
        report('probe', downloaded, total)
        _probed_into(entry, binary)
        with REGISTRY_LOCK:
            entry['executable'] = str(binary.relative_to(ROOT)) if binary.is_relative_to(ROOT) else str(binary)
            entry['installed'] = True
            save_registry()
        report('done', downloaded, total)
        return get(engine_id)
    except Exception:
        if created:
            shutil.rmtree(target_dir, ignore_errors=True)
        raise
    finally:
        if temp_path is not None:
            with contextlib.suppress(OSError):
                os.unlink(temp_path)


def model_entry(engine_id, model_id):
    """(engine entry, model entry); model is None when the engine has no such model."""
    entry = get(engine_id)
    if entry is None:
        raise InstallError(f'Unknown engine: {engine_id}.')
    model = next((m for m in entry.get('models', []) if m.get('id') == model_id), None)
    return entry, model


def weights_path(engine_id, model):
    return ROOT / 'engines' / engine_id / 'weights' / model['weights']


def install_model(engine_id, model_id, progress_cb=None):
    """Download a model's weights into engines/<id>/weights/. The engine itself must
    be installed first. Same progress reporting as install()."""
    def report(phase, downloaded=0, total=0):
        if progress_cb:
            progress_cb(phase, downloaded, total)

    entry, model = model_entry(engine_id, model_id)
    if model is None:
        raise InstallError(f'Unknown model {model_id} for engine {engine_id}.')
    if not installed(engine_id):
        raise InstallError(f'{entry["name"]} is not installed; install it first.')
    if model.get('installed'):
        raise InstallError(f'{model["name"]} is already installed.')
    download = model.get('download')
    if not download:
        raise InstallError(f'{model["name"]} has no download; place the weights file in engines/{engine_id}/weights/ yourself.')
    folder = ROOT / 'engines' / engine_id / 'weights'
    folder.mkdir(parents=True, exist_ok=True)
    target = weights_path(engine_id, model)
    temp_path, downloaded, total = _fetch(download['url'], download, report, model['name'])
    try:
        report('extract', downloaded, total)
        shutil.move(temp_path, target)
        temp_path = None
        with REGISTRY_LOCK:
            model['installed'] = True
            save_registry()
        report('done', downloaded, total)
        return model
    finally:
        if temp_path is not None:
            with contextlib.suppress(OSError):
                os.unlink(temp_path)


def uninstall_model(engine_id, model_id):
    entry, model = model_entry(engine_id, model_id)
    if model is None:
        raise InstallError(f'Unknown model {model_id} for engine {engine_id}.')
    POOL.close(f'{engine_id}/{model_id}')
    with contextlib.suppress(OSError):
        weights_path(engine_id, model).unlink()
    with REGISTRY_LOCK:
        model['installed'] = False
        save_registry()


def uninstall(engine_id):
    """Remove a downloaded engine (engines/<id>/); Stockfish and path-added engines stay."""
    entry = get(engine_id)
    if entry is None:
        raise InstallError(f'Unknown engine: {engine_id}.')
    if engine_id == 'stockfish':
        raise InstallError('Stockfish installs with the app; it cannot be uninstalled here.')
    if entry.get('custom'):
        raise InstallError('Custom engines are removed, not uninstalled.')
    POOL.close(engine_id)  # a running process keeps the binary locked on Windows
    folder = ROOT / 'engines' / engine_id
    try:
        if folder.is_dir():
            shutil.rmtree(folder)
    except OSError as exc:
        raise InstallError(f'{entry["name"]} could not be removed: {exc}')
    with REGISTRY_LOCK:
        entry['executable'] = None
        entry['installed'] = False
        save_registry()
    return get(engine_id)


def _custom_id(name):
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-') or 'engine'
    taken = {entry['id'] for entry in load_registry()['engines']}
    candidate, suffix = slug, 2
    while candidate in taken:
        candidate, suffix = f'{slug}-{suffix}', suffix + 1
    return candidate


def add_custom_engine(name, path):
    """Register a UCI binary already on this machine, probing it first."""
    name = str(name or '').strip()
    if not name:
        raise InstallError('The engine needs a name.')
    binary = Path(str(path or '')).expanduser()
    if not binary.is_file():
        raise InstallError(f'No file at {path}.')
    entry = {'id': _custom_id(name), 'name': name, 'version': None, 'type': 'custom', 'protocol': 'uci',
             'executable': str(binary.resolve()), 'capabilities': {'limit_strength': False, 'skill_level': False, 'multipv': False},
             'strength_ccrl': None, 'license': '', 'repo_url': '', 'description': 'Added by you.',
             'custom': True, 'installed': True, 'models': [], 'download': None}
    try:
        _probed_into(entry, binary)
    except InstallError:
        raise InstallError(f'{binary.name} did not answer the UCI handshake; is it a chess engine?')
    with REGISTRY_LOCK:
        load_registry()['engines'].append(entry)
        save_registry()
    return entry


def remove_custom_engine(engine_id):
    entry = get(engine_id)
    if entry is None:
        raise InstallError(f'Unknown engine: {engine_id}.')
    if not entry.get('custom'):
        raise InstallError('Only custom engines can be removed.')
    with REGISTRY_LOCK:
        load_registry()['engines'].remove(entry)
        save_registry()


def strength_options(entry, elo):
    """UCI options that make the engine in `entry` play at `elo`, plus the chance of a
    slip: a deliberate weaker, human-looking move (engine_service.human_slip), as beginners make."""
    elo = int(elo)
    caps = entry.get('capabilities', {})
    if entry.get('id') == 'stockfish':
        if elo >= STOCKFISH_MIN_ELO:
            return {'UCI_LimitStrength': True, 'UCI_Elo': min(elo, STOCKFISH_MAX_ELO)}, 0.0
        skill = round(max(0, min(6, (elo - 250) / (STOCKFISH_MIN_ELO - 250) * 6)))
        return {'Skill Level': skill}, round(max(0.0, min(0.45, (1150 - elo) / 1600)), 3)
    if caps.get('limit_strength'):
        return {'UCI_LimitStrength': True, 'UCI_Elo': max(STOCKFISH_MIN_ELO, min(elo, STOCKFISH_MAX_ELO))}, 0.0
    if caps.get('skill_level'):
        skill = round(max(0, min(20, (elo - 250) / (STOCKFISH_MAX_ELO - 250) * 20)))
        return {'Skill Level': skill}, 0.0
    return {}, 0.0


# Node-limited strength. A fixed node budget per move weakens an engine smoothly: Skill
# Level plays deliberately worse moves in coarse steps and UCI_Elo stops at 1320, while
# every extra node buys a little more strength, the same on a fast machine as a slow one.
# The ratings are approximate, measured loosely for single-threaded Stockfish (NNUE) on a
# human, blitz-like scale: about 150 Elo per doubling of nodes. Other NNUE engines land
# near them; neural engines (Lc0) do not, a node there being far more expensive.
# The (nodes, elo) rows live in content/grading.json, which the web app reads too.
NODE_ELO_TABLE = tuple(tuple(row) for row in json.loads(
    (paths.CONTENT / 'grading.json').read_text(encoding='utf-8'))['nodeElo'])
MAX_NODES = 100_000_000
MAX_DEPTH = 99


def nodes_for_elo(elo):
    """The node budget that plays at about `elo` (log-linear between table rows, clamped to its ends)."""
    elo = float(elo)
    if elo <= NODE_ELO_TABLE[0][1]:
        return NODE_ELO_TABLE[0][0]
    for (n0, e0), (n1, e1) in zip(NODE_ELO_TABLE, NODE_ELO_TABLE[1:]):
        if elo <= e1:
            return round(n0 * (n1 / n0) ** ((elo - e0) / (e1 - e0)))
    return NODE_ELO_TABLE[-1][0]


def elo_for_nodes(nodes):
    """The approximate rating of a `nodes` budget, the inverse of nodes_for_elo."""
    nodes = float(nodes)
    if nodes <= NODE_ELO_TABLE[0][0]:
        return NODE_ELO_TABLE[0][1]
    for (n0, e0), (n1, e1) in zip(NODE_ELO_TABLE, NODE_ELO_TABLE[1:]):
        if nodes <= n1:
            return round(e0 + (e1 - e0) * math.log(nodes / n0) / math.log(n1 / n0))
    return NODE_ELO_TABLE[-1][1]


def node_limits(spec):
    """(nodes, depth) from an engine spec's optional "nodes" and "depth" caps; None when absent."""
    caps = []
    for key, top in (('nodes', MAX_NODES), ('depth', MAX_DEPTH)):
        value = spec.get(key)
        if value is not None and (not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= top):
            raise ValueError(f'"{key}" must be a whole number from 1 to {top}.')
        caps.append(value)
    return tuple(caps)


def search_limit(nodes, depth, seconds):
    """The search for one move: the node/depth caps when either is set, else `seconds` of thinking."""
    if nodes or depth:
        return chess.engine.Limit(nodes=nodes, depth=depth)
    return chess.engine.Limit(time=seconds)


# Config profiles: one saved set of UCI options per engine (Hash, Threads, MultiPV, anything
# the engine reports), kept in data/engine_profiles.json and applied every time the engine
# starts. A profile overrides the app's defaults (Threads, Hash), but a rating the caller
# asks for (a bot's strength) still wins over the profile's strength options.
STRENGTH_KEYS = frozenset({'UCI_LimitStrength', 'UCI_Elo', 'Skill Level'})
# python-chess sets these for each search itself; a profile's MultiPV is the number of analysis lines.
MANAGED_OPTIONS = frozenset({'multipv', 'ponder', 'uci_chess960', 'uci_variant'})
REFUSED_OPTIONS = frozenset({'ponder', 'uci_chess960', 'uci_variant', 'uci_analysemode'})
PROFILE_LOCK = threading.RLock()
_reported = {}  # (binary path, mtime) -> the options the binary declares


def _profiles_path():
    return DATA_DIR / 'engine_profiles.json'


def load_profiles():
    """Every saved profile: {engine_id: {'options': {...}, 'updated': iso time}}."""
    with PROFILE_LOCK:
        try:
            data = json.loads(_profiles_path().read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return {}
        profiles = data.get('profiles') if isinstance(data, dict) else None
        return {k: v for k, v in (profiles or {}).items() if isinstance(v, dict) and isinstance(v.get('options'), dict)}


def get_profile(engine_id):
    """The options saved for `engine_id`, or {}."""
    return dict((load_profiles().get(engine_id) or {}).get('options') or {})


def profile_multipv(engine_id, default=3):
    """How many analysis lines the engine's profile asks for (`default` without one)."""
    for key, value in get_profile(engine_id).items():
        if key.lower() == 'multipv' and isinstance(value, int) and not isinstance(value, bool):
            return max(1, min(value, 10))
    return default


def reported_options(engine_id):
    """The UCI options the engine's binary declares, [{name, type, default, min, max, var}],
    or None when it is not installed. A handshake the first time, then cached per binary."""
    path = resolve_engine(engine_id)
    if path is None or not path.exists():
        return None
    key = (str(path), path.stat().st_mtime_ns)
    with PROFILE_LOCK:
        if key in _reported:
            return copy.deepcopy(_reported[key])
    engine = chess.engine.SimpleEngine.popen_uci(str(path), timeout=10)
    try:
        options = [{'name': o.name, 'type': o.type, 'default': o.default, 'min': o.min, 'max': o.max,
                    'var': list(o.var or [])} for o in engine.options.values()]
    finally:
        with contextlib.suppress(chess.engine.EngineError, OSError):
            engine.quit()
    with PROFILE_LOCK:
        _reported[key] = options
    return copy.deepcopy(options)


def _check_value(option, value):
    """`value` as the reported `option` takes it; raises ValueError when it does not fit."""
    name, kind = option['name'], option['type']
    if kind == 'check':
        if isinstance(value, str) and value.lower() in ('true', 'false'):
            return value.lower() == 'true'
        if not isinstance(value, bool):
            raise ValueError(f'{name} must be true or false.')
        return value
    if kind == 'spin':
        try:
            number = int(value) if not isinstance(value, bool) and float(value) == int(float(value)) else None
        except (TypeError, ValueError):
            number = None
        if number is None:
            raise ValueError(f'{name} must be a whole number.')
        low, high = option.get('min'), option.get('max')
        if (low is not None and number < low) or (high is not None and number > high):
            raise ValueError(f'{name} must be from {low} to {high}.')
        return number
    if kind == 'combo':
        match = next((v for v in option.get('var') or [] if v.lower() == str(value).lower()), None)
        if match is None:
            raise ValueError(f'{name} must be one of {", ".join(option.get("var") or [])}.')
        return match
    if kind in ('string', 'file', 'path'):
        if isinstance(value, (dict, list)) or '\n' in str(value) or '\r' in str(value):
            raise ValueError(f'{name} must be a single line of text.')
        return str(value)
    raise ValueError(f'{name} is a button, not a setting.')


def validate_profile(engine_id, options, reported=None):
    """The profile `options` cleaned up: names as the engine spells them, values of the right
    type and range. Checked against the engine's reported options when it is installed;
    otherwise only the shape is checked. Raises ValueError."""
    if not isinstance(options, dict):
        raise ValueError('"options" must be an object of option names and values.')
    if len(options) > 64:
        raise ValueError('A profile holds at most 64 options.')
    entry = get(engine_id)
    if entry is None:
        raise ValueError(f'Unknown engine: {engine_id}.')
    known = {o['name'].lower(): o for o in (reported or [])}
    cleaned = {}
    for name, value in options.items():
        name = str(name).strip()
        if not name or len(name) > 64:
            raise ValueError('Option names must be 1 to 64 characters.')
        if name.lower() in REFUSED_OPTIONS:
            raise ValueError(f'{name} is managed by the app and cannot be part of a profile.')
        if reported is not None:
            option = known.get(name.lower())
            if option is None:
                raise ValueError(f'{entry["name"]} has no option "{name}".')
            cleaned[option['name']] = _check_value(option, value)
        elif isinstance(value, bool) or (isinstance(value, int) and abs(value) < 2 ** 31):
            cleaned[name] = value
        elif isinstance(value, str) and len(value) <= 512 and '\n' not in value and '\r' not in value:
            cleaned[name] = value
        else:
            raise ValueError(f'{name} must be true/false, a whole number or a line of text.')
    return cleaned


def _write_profiles(profiles):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    jsonio.write_json(_profiles_path(), {'profiles': profiles}, trailing_newline=True, indent=2)


def save_profile(engine_id, options):
    """Validate and store `engine_id`'s profile, then restart its pooled processes so it applies."""
    reported = reported_options(engine_id) if get(engine_id) is not None else None
    cleaned = validate_profile(engine_id, options, reported)
    with PROFILE_LOCK:
        profiles = load_profiles()
        if cleaned:
            profiles[engine_id] = {'options': cleaned, 'updated': datetime.now(timezone.utc).isoformat(timespec='seconds')}
        else:
            profiles.pop(engine_id, None)
        _write_profiles(profiles)
    POOL.close(engine_id)
    return cleaned


def delete_profile(engine_id):
    """Forget `engine_id`'s profile; True when there was one."""
    with PROFILE_LOCK:
        profiles = load_profiles()
        found = profiles.pop(engine_id, None) is not None
        if found:
            _write_profiles(profiles)
    if found:
        POOL.close(engine_id)
    return found


def session_options(engine_id, model_id, options, profile=True):
    """The options an engine process starts with: the caller's defaults, then the engine's
    saved profile, then a model's uci_options (WeightsFile becomes the absolute path of the
    installed weights, since engines do not run in that folder), then the caller's strength
    options, so a bot's rating is never undone by the profile."""
    options = options or {}
    merged = {k: v for k, v in options.items() if k not in STRENGTH_KEYS}
    if profile:
        merged.update(get_profile(engine_id))
    if model_id:
        entry = get(engine_id) or {}
        model = next((m for m in entry.get('models', []) if m.get('id') == model_id), None)
        if model is None:
            raise ValueError(f'Unknown model {model_id} for engine {engine_id}.')
        if not model.get('installed'):
            raise InstallError(f'{model["name"]} is not installed.')
        for key, value in (model.get('uci_options') or {}).items():
            merged[key] = str(weights_path(engine_id, model)) if key == 'WeightsFile' else value
    merged.update({k: v for k, v in options.items() if k in STRENGTH_KEYS})
    return merged


def _configure_supported(engine, options):
    """Set only the options the engine declares (Lc0 has no Hash, for instance) and that
    python-chess does not manage per search (MultiPV)."""
    supported = {key: value for key, value in limits.cap(options).items()
                 if key in engine.options and key.lower() not in MANAGED_OPTIONS}
    if supported:
        engine.configure(supported)


class ThreadBudget:
    """Search threads shared out among the engines working at the same moment (the background
    analysis, a review, a bot's move...), so together they stay within the machine's cores
    instead of each taking half of them. TORRE_ENGINE_THREADS shrinks it on a shared host."""

    def __init__(self, total=None):
        self.total = max(1, total or limits.total_threads())
        self._used = 0
        self._lock = threading.Lock()

    @property
    def used(self):
        with self._lock:
            return self._used

    @contextlib.contextmanager
    def reserve(self, wanted):
        """Up to `wanted` threads while the block runs: what is left of the budget, and never
        less than one (an engine always gets a thread to search with)."""
        with self._lock:
            granted = max(1, min(int(wanted or 1), self.total - self._used))
            self._used += granted
        try:
            yield granted
        finally:
            with self._lock:
                self._used -= granted


class EnginePool:
    """Long-lived engine processes, one per key: an engine id, a model as <id>/<model>, and an
    optional slot (<id>#play) for work that runs with other options, such as a bot's strength.
    A process is revived when it has died, and each key has its own lock, so different keys
    search at the same time while one process serves one caller at a time."""

    def __init__(self, budget=None):
        self._guard = threading.Lock()
        self._engines = {}
        self._applied = {}  # key -> the options the process was last configured with
        self._locks = {}
        self.budget = budget or ThreadBudget()

    @staticmethod
    def key(engine_id, model_id=None, slot=None):
        key = f'{engine_id}/{model_id}' if model_id else engine_id
        return f'{key}#{slot}' if slot else key

    def lock(self, key):
        with self._guard:
            if key not in self._locks:
                self._locks[key] = threading.Lock()
            return self._locks[key]

    def _live(self, key, engine_id):
        """The running process for `key`, started (or restarted) when needed. Hold its lock."""
        engine = self._engines.get(key)
        if engine is not None:
            try:
                engine.ping()
            except (chess.engine.EngineError, OSError):
                with contextlib.suppress(chess.engine.EngineError, OSError):
                    engine.close()
                engine = None
        if engine is None:
            path = resolve_engine(engine_id)
            if path is None or not path.exists():
                raise EngineNotInstalled(f'{engine_id} is not installed.')
            engine = chess.engine.SimpleEngine.popen_uci(str(path))
            with self._guard:
                self._engines[key] = engine
                self._applied[key] = {}
        return engine

    def _apply(self, key, engine, options):
        """Send the options that differ from what the process already runs with. Strength
        options left out go back to the engine's defaults, so a bot's rating never sticks."""
        wanted = dict(options)
        for name in STRENGTH_KEYS:
            if name not in wanted and name in engine.options:
                wanted[name] = engine.options[name].default
        applied = self._applied.setdefault(key, {})
        changed = {name: value for name, value in wanted.items() if applied.get(name) != value}
        if changed:
            _configure_supported(engine, changed)
            applied.update(changed)

    @contextlib.contextmanager
    def acquire(self, engine_id, model_id=None, slot=None, options=None, profile=True):
        """The pooled process for engine_id (with model_id, in `slot`), held for the block and
        configured with `options`, merged as session_options() does. Its Threads come out of
        the budget: fewer while other engines are busy."""
        key = self.key(engine_id, model_id, slot)
        with self.lock(key):
            engine = self._live(key, engine_id)
            wanted = session_options(engine_id, model_id, options, profile=profile)
            with self.budget.reserve(wanted.get('Threads', 1)) as threads:
                if 'Threads' in wanted:
                    wanted['Threads'] = threads
                self._apply(key, engine, wanted)
                yield engine

    @contextlib.contextmanager
    def session(self, engine_id, model_id=None, options=None, ephemeral=True, profile=True):
        """A short-lived engine process (an Arena match); the pooled one with ephemeral=False.
        profile=False leaves the engine's saved profile out (the Arena's neutral judge)."""
        if not ephemeral:
            with self.acquire(engine_id, model_id, options=options, profile=profile) as engine:
                yield engine
            return
        options = session_options(engine_id, model_id, options, profile=profile)
        path = resolve_engine(engine_id)
        if path is None or not path.exists():
            raise EngineNotInstalled(f'{engine_id} is not installed.')
        with self.budget.reserve(options.get('Threads', 1)) as threads:
            if 'Threads' in options:
                options['Threads'] = threads
            engine = chess.engine.SimpleEngine.popen_uci(str(path))
            try:
                _configure_supported(engine, options)
                yield engine
            finally:
                with contextlib.suppress(chess.engine.EngineError, OSError):
                    engine.quit()

    def _take(self, keys):
        with self._guard:
            taken = [(key, self._engines.pop(key, None)) for key in keys]
            for key in keys:
                self._applied.pop(key, None)
        return [engine for _, engine in taken if engine is not None]

    def close(self, engine_id):
        """Shut the pooled processes of an engine (its models and slots too) down, so binaries
        can be replaced or deleted."""
        with self._guard:
            keys = [key for key in self._engines
                    if key == engine_id or key.startswith((f'{engine_id}/', f'{engine_id}#'))]
        for key in keys:
            with self.lock(key):
                for engine in self._take([key]):
                    with contextlib.suppress(chess.engine.EngineError, OSError):
                        engine.quit()

    def close_all(self):
        """Shut every pooled process down (the server is stopping)."""
        with self._guard:
            keys = list(self._engines)
        for engine in self._take(keys):
            with contextlib.suppress(chess.engine.EngineError, OSError):
                engine.quit()


POOL = EnginePool()
atexit.register(POOL.close_all)  # no engine process outlives the app


class InstallJob(jobs.BackgroundJob):
    """Downloads and installs one engine or model at a time."""
    busy_message = 'Another download is already running.'
    label = 'The engine install'

    def __init__(self):
        super().__init__({'running': False, 'engine_id': None, 'model_id': None, 'phase': None,
                          'downloaded': 0, 'total': 0, 'error': None})

    def start(self, engine_id):
        entry = get(engine_id)
        if entry is None:
            raise ValueError(f'Unknown engine: {engine_id}.')
        if installed(engine_id):
            raise InstallError(f"{entry['name']} is already installed.")
        self._begin(engine_id, None, lambda: install(engine_id, progress_cb=self._progress))

    def start_model(self, engine_id, model_id):
        entry, model = model_entry(engine_id, str(model_id))
        if model is None:
            raise ValueError(f'Unknown model {model_id} for engine {engine_id}.')
        if not installed(engine_id):
            raise InstallError(f"{entry['name']} is not installed; install it first.")
        if model.get('installed'):
            raise InstallError(f"{model['name']} is already installed.")
        self._begin(engine_id, model['id'], lambda: install_model(engine_id, model['id'], progress_cb=self._progress))

    def _begin(self, engine_id, model_id, download):
        self.launch({'running': True, 'engine_id': engine_id, 'model_id': model_id, 'phase': 'download',
                     'downloaded': 0, 'total': 0, 'error': None}, download)

    def _progress(self, phase, downloaded, total):
        self.update(phase=phase, downloaded=downloaded, total=total)

    def work(self, download):
        download()


INSTALL_JOB = InstallJob()
