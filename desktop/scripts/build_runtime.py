"""Build what the desktop app ships next to Torre.exe (src-tauri/runtime):

- python/: a standalone CPython with Torre installed into it. The window starts
  `python -m torre serve` from it. It is a real Python, not a frozen one, so the coach can still
  pip-install Prompture into the data folder the way it does for a pip install.
- stockfish/: Stockfish, which a pip install expects on PATH. The window puts this folder on the
  server's PATH, so a STOCKFISH_PATH or ~/.torre/engine the player set up still comes first.

    python desktop/scripts/build_runtime.py                 install this checkout (build the UI first)
    python desktop/scripts/build_runtime.py --wheel X.whl   install a built wheel (what CI does)
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
import zipfile
import urllib.request
from pathlib import Path

DESKTOP = Path(__file__).resolve().parent.parent
REPO = DESKTOP.parent
TAURI = DESKTOP / 'src-tauri'
RUNTIME = TAURI / 'runtime' / 'python'
STOCKFISH_DIR = TAURI / 'runtime' / 'stockfish'
CACHE = DESKTOP / '.cache'

# python-build-standalone, pinned by release and checksum.
PYTHON = {
    'win32': {
        'url': 'https://github.com/astral-sh/python-build-standalone/releases/download/20260924/'
               'cpython-3.12.14+20260924-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
        'sha256': 'c5bf8edfe858c1df9891be498b5bbc8761d383df5b9790658b088fea4870433a',
        'exe': 'python.exe',
    },
}

# Stockfish's universal build picks the fastest instruction set the CPU has when it starts.
STOCKFISH = {
    'win32': {
        'url': 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/'
               'stockfish-windows-x86-64-universal.zip',
        'sha256': '3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7',
        'members': {'stockfish/stockfish-windows-x86-64-universal.exe': 'stockfish.exe',
                    'stockfish/Copying.txt': 'Copying.txt', 'stockfish/AUTHORS': 'AUTHORS'},
    },
}

# Parts of the standard library Torre never loads: Tk and the demos that come with it.
UNUSED = ['tcl', 'Lib/tkinter', 'Lib/idlelib', 'Lib/turtledemo', 'Lib/turtle.py',
          'DLLs/_tkinter.pyd', 'DLLs/tcl86t.dll', 'DLLs/tk86t.dll']


def fetch(spec):
    """The archive, from the cache when its checksum still matches."""
    archive = CACHE / spec['url'].rsplit('/', 1)[1]
    if not archive.is_file() or sha256(archive) != spec['sha256']:
        CACHE.mkdir(parents=True, exist_ok=True)
        print(f'Downloading {archive.name}')
        with urllib.request.urlopen(spec['url']) as response, open(archive, 'wb') as out:
            shutil.copyfileobj(response, out)
        if sha256(archive) != spec['sha256']:
            archive.unlink()
            raise SystemExit(f'{archive.name}: checksum mismatch')
    return archive


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--wheel', type=Path, help='a built torre wheel (default: this checkout)')
    args = parser.parse_args(argv)

    spec = PYTHON.get(sys.platform)
    if spec is None or sys.platform not in STOCKFISH:
        raise SystemExit(f'No standalone Python is pinned for {sys.platform} yet.')
    if args.wheel is None and not (REPO / 'torre' / 'ui' / 'index.html').is_file():
        raise SystemExit('The interface has not been built. Run .\\dev.ps1 build first.')

    archive = fetch(spec)
    if RUNTIME.exists():
        shutil.rmtree(RUNTIME)
    RUNTIME.parent.mkdir(parents=True, exist_ok=True)
    print(f'Extracting into {RUNTIME.relative_to(REPO)}')
    with tarfile.open(archive) as tar:
        tar.extractall(RUNTIME.parent, filter='data')  # the archive holds python/...
    for name in UNUSED:
        target = RUNTIME / name
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()

    engine = STOCKFISH[sys.platform]
    archive = fetch(engine)
    if STOCKFISH_DIR.exists():
        shutil.rmtree(STOCKFISH_DIR)
    STOCKFISH_DIR.mkdir(parents=True)
    with zipfile.ZipFile(archive) as z:
        for member, name in engine['members'].items():
            (STOCKFISH_DIR / name).write_bytes(z.read(member))

    python = RUNTIME / spec['exe']
    source = str(args.wheel.resolve() if args.wheel else REPO)
    leftovers = [p for p in (REPO / 'build', REPO / 'torre.egg-info') if not p.exists()]
    subprocess.run([str(python), '-m', 'pip', 'install', '--no-warn-script-location',
                    '--disable-pip-version-check', '--no-input', source], check=True)
    for path in leftovers:  # what installing the checkout wrote into it
        shutil.rmtree(path, ignore_errors=True)
    version = subprocess.run([str(python), '-c', 'import torre; print(torre.__version__)'],
                             check=True, capture_output=True, text=True).stdout.strip()

    # tauri build --config src-tauri/version.json: the installer carries Torre's version.
    (TAURI / 'version.json').write_text(json.dumps({'version': version}) + '\n', encoding='utf-8')
    print(f'Runtime ready: Torre {version}')


if __name__ == '__main__':
    main()
