"""Build what the desktop app ships next to its executable (src-tauri/runtime):

- python/: a standalone CPython with Torre installed into it. The window starts
  `python -m torre serve` from it. It is a real Python, not a frozen one, so the coach can still
  pip-install Prompture into the data folder the way it does for a pip install.
- stockfish/: Stockfish, which a pip install expects on PATH. The window puts this folder on the
  server's PATH, so a STOCKFISH_PATH or ~/.torre/engine the player set up still comes first.

    python desktop/scripts/build_runtime.py                 install this checkout (build the UI first)
    python desktop/scripts/build_runtime.py --wheel X.whl   install a built wheel (what CI does)

It builds for the machine it runs on: Windows x64, macOS (Apple silicon or Intel) or Linux x64.
"""
import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

DESKTOP = Path(__file__).resolve().parent.parent
REPO = DESKTOP.parent
TAURI = DESKTOP / 'src-tauri'
RUNTIME = TAURI / 'runtime'
CACHE = DESKTOP / '.cache'

PBS = 'https://github.com/astral-sh/python-build-standalone/releases/download/20260924/'
SF = 'https://github.com/official-stockfish/Stockfish/releases/download/sf_19/'

# python-build-standalone and Stockfish 19, pinned by release and checksum. Stockfish's universal
# builds pick the fastest instruction set the CPU has when they start.
TARGETS = {
    ('win32', 'amd64'): {
        'python': (PBS + 'cpython-3.12.14+20260924-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
                   'c5bf8edfe858c1df9891be498b5bbc8761d383df5b9790658b088fea4870433a'),
        'stockfish': (SF + 'stockfish-windows-x86-64-universal.zip',
                      '3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7'),
        'engine': 'stockfish/stockfish-windows-x86-64-universal.exe',
    },
    ('darwin', 'arm64'): {
        'python': (PBS + 'cpython-3.12.14+20260924-aarch64-apple-darwin-install_only_stripped.tar.gz',
                   'c2edb321cd32ec2b170df208db0446dccc4398db602ca27cf2079098fb1f7d9d'),
        'stockfish': (SF + 'stockfish-macos-universal.tar.gz',
                      'a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77'),
        'engine': 'stockfish/stockfish-macos-universal',
    },
    ('darwin', 'x86_64'): {
        'python': (PBS + 'cpython-3.12.14+20260924-x86_64-apple-darwin-install_only_stripped.tar.gz',
                   '7ea9761b9069c10b9a20531d568645849d604c59e9c7f11f6659f1e1790c968e'),
        'stockfish': (SF + 'stockfish-macos-universal.tar.gz',
                      'a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77'),
        'engine': 'stockfish/stockfish-macos-universal',
    },
    ('linux', 'x86_64'): {
        'python': (PBS + 'cpython-3.12.14+20260924-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz',
                   '269b2c99e4db15b242bf01832f4fea1e8f1a664f273cff519393f296e9820b41'),
        'stockfish': (SF + 'stockfish-linux-x86-64-universal.tar.gz',
                      '9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f'),
        'engine': 'stockfish/stockfish-linux-x86-64-universal',
    },
}

# Stockfish's license and authors travel with the binary.
ENGINE_NOTICES = {'stockfish/Copying.txt': 'Copying.txt', 'stockfish/AUTHORS': 'AUTHORS'}

# Parts of the standard library Torre never loads: Tk and the demos that come with it.
UNUSED = ['tcl', 'Lib/tkinter', 'Lib/idlelib', 'Lib/turtledemo', 'Lib/turtle.py',
          'DLLs/_tkinter.pyd', 'DLLs/tcl86t.dll', 'DLLs/tk86t.dll',
          'lib/tcl8.6', 'lib/tk8.6', 'lib/python3.12/tkinter', 'lib/python3.12/idlelib',
          'lib/python3.12/turtledemo', 'lib/python3.12/turtle.py']


def target():
    machine = platform.machine().lower()
    machine = {'x86_64': 'amd64'}.get(machine, machine) if sys.platform == 'win32' else machine
    if (sys.platform, machine) not in TARGETS:
        raise SystemExit(f'No standalone Python and Stockfish are pinned for {sys.platform} {machine} yet.')
    return TARGETS[sys.platform, machine]


def fetch(url, checksum):
    """The archive, from the cache when its checksum still matches."""
    archive = CACHE / url.rsplit('/', 1)[1]
    if not archive.is_file() or sha256(archive) != checksum:
        CACHE.mkdir(parents=True, exist_ok=True)
        print(f'Downloading {archive.name}')
        with urllib.request.urlopen(url) as response, open(archive, 'wb') as out:
            shutil.copyfileobj(response, out)
        if sha256(archive) != checksum:
            archive.unlink()
            raise SystemExit(f'{archive.name}: checksum mismatch')
    return archive


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def read_member(archive, member):
    if archive.suffix == '.zip':
        with zipfile.ZipFile(archive) as z:
            return z.read(member)
    with tarfile.open(archive) as tar:
        return tar.extractfile(member).read()


def build_stockfish(spec):
    folder = RUNTIME / 'stockfish'
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    archive = fetch(*spec['stockfish'])
    engine = folder / ('stockfish.exe' if sys.platform == 'win32' else 'stockfish')
    engine.write_bytes(read_member(archive, spec['engine']))
    engine.chmod(0o755)
    for member, name in ENGINE_NOTICES.items():
        (folder / name).write_bytes(read_member(archive, member))


def build_python(spec, wheel):
    """Extract Python, install Torre into it; Torre's version."""
    folder = RUNTIME / 'python'
    if folder.exists():
        shutil.rmtree(folder)
    print(f'Extracting Python into {folder.relative_to(REPO)}')
    with tarfile.open(fetch(*spec['python'])) as tar:
        tar.extractall(RUNTIME, filter='data')  # the archive holds python/...
    for name in UNUSED:
        path = folder / name
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()
    # Tauri copies resources file by file, so links (bin/python3 -> python3.12) become copies.
    for link in [p for p in folder.rglob('*') if p.is_symlink()]:
        real = link.resolve()
        link.unlink()
        if real.is_dir():
            shutil.copytree(real, link)
        else:
            shutil.copy2(real, link)

    python = folder / ('python.exe' if sys.platform == 'win32' else 'bin/python3')
    source = str(wheel.resolve() if wheel else REPO)
    leftovers = [p for p in (REPO / 'build', REPO / 'torre.egg-info') if not p.exists()]
    subprocess.run([str(python), '-m', 'pip', 'install', '--no-warn-script-location',
                    '--disable-pip-version-check', '--no-input', source], check=True)
    for path in leftovers:  # what installing the checkout wrote into it
        shutil.rmtree(path, ignore_errors=True)
    return subprocess.run([str(python), '-c', 'import torre; print(torre.__version__)'],
                          check=True, capture_output=True, text=True).stdout.strip()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--wheel', type=Path, help='a built torre wheel (default: this checkout)')
    args = parser.parse_args(argv)
    spec = target()
    if args.wheel is None and not (REPO / 'torre' / 'ui' / 'index.html').is_file():
        raise SystemExit('The interface has not been built. Run .\\dev.ps1 build first.')

    RUNTIME.mkdir(parents=True, exist_ok=True)
    build_stockfish(spec)
    version = build_python(spec, args.wheel)
    # tauri build --config src-tauri/version.json: the installer carries Torre's version.
    (TAURI / 'version.json').write_text(json.dumps({'version': version}) + '\n', encoding='utf-8')
    print(f'Runtime ready: Torre {version}')


if __name__ == '__main__':
    main()
