"""Build a Vela app package: dist/chess-<version>.zip (plus a .sha256).

  .venv/Scripts/python -m torre.tools.release_vela [--stockfish PATH]

The package bundles python-chess and fsrs under vendor/ so Vela only needs Python.
Stockfish is large, so it is included only when --stockfish is given;
otherwise the app finds it via STOCKFISH_PATH or `stockfish` on PATH.
"""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path

import chess
import fsrs
import typing_extensions
from torre import paths

ROOT = paths.REPO
STAMP = (2026, 1, 1, 0, 0, 0)


def add(archive, source, name, mode=0o100644):
    info = zipfile.ZipInfo(name, STAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = mode << 16
    archive.writestr(info, source.read_bytes())


def runtime_modules(root=ROOT):
    """Every Python file of the torre package: the app is the package, its tests live outside it."""
    package = root / 'torre'
    return {f'torre/{f.relative_to(package).as_posix()}': f for f in sorted(package.rglob('*.py'))
            if '__pycache__' not in f.parts}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--stockfish', type=Path, help='engine binary to bundle as engine/<name>')
    args = parser.parse_args()

    manifest = json.loads((ROOT / 'vela-app/app.json').read_text(encoding='utf-8'))
    files = {'app.json': ROOT / 'vela-app/app.json', 'icon.svg': ROOT / 'vela-app/icon.svg'}
    files.update(runtime_modules())
    files.update({f'torre/content/{f.relative_to(paths.CONTENT).as_posix()}': f for f in paths.CONTENT.rglob('*.json')})
    ui = ROOT / 'studio' / 'ui'
    if not (ui / 'index.html').is_file():
        raise SystemExit('studio/ui is missing. Build the interface first: cd web && npm run build')
    files.update({f'studio/ui/{f.relative_to(ui).as_posix()}': f for f in ui.rglob('*') if f.is_file()})
    chess_pkg = Path(chess.__file__).parent
    files.update({f'vendor/chess/{f.relative_to(chess_pkg).as_posix()}': f
                  for f in chess_pkg.rglob('*') if f.is_file() and '__pycache__' not in f.parts})
    # python-chess is GPL-3.0; ship its license with the vendored copy.
    files.update({f'vendor/python-chess-{f.name}': f for f in chess_pkg.parent.glob('chess-*.dist-info/licenses/*')})
    # fsrs (MIT) schedules drills; typing_extensions (PSF) is its only dependency.
    fsrs_pkg = Path(fsrs.__file__).parent
    files.update({f'vendor/fsrs/{f.relative_to(fsrs_pkg).as_posix()}': f
                  for f in fsrs_pkg.rglob('*') if f.is_file() and '__pycache__' not in f.parts})
    files['vendor/typing_extensions.py'] = Path(typing_extensions.__file__)
    for dist in ('fsrs-*.dist-info', 'typing_extensions-*.dist-info'):
        files.update({f'vendor/{dist.split("-")[0]}-{f.name}': f for f in chess_pkg.parent.glob(f'{dist}/licenses/*')})

    output = ROOT / 'dist' / f"{manifest['id']}-{manifest['version']}.zip"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files):
            add(archive, files[name], name)
        if args.stockfish:
            add(archive, args.stockfish, f'engine/{args.stockfish.name}', 0o100755)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.sha256').write_text(digest + '\n', encoding='utf-8')
    print(f'{output}\nSHA256 {digest}')


if __name__ == '__main__':
    main()
