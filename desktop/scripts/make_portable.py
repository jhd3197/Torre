"""Zip the built Torre.exe with its Python and Stockfish into the portable copy for Windows.

Run after `npm run build` on Windows:

    python scripts/make_portable.py            # writes dist/Torre_<version>_x64-portable.zip

The zip holds one Torre folder: Torre.exe, python/, stockfish/ and portable.txt. That file is
what makes the copy portable: Torre then keeps your games, its log and the window's own storage
in home/ next to Torre.exe (src-tauri/src/main.rs), so the folder can move to another computer or
a USB stick with everything in it. It needs Microsoft Edge WebView2, which Windows 11 includes;
the installer would set it up, the zip cannot.
"""
import argparse
import json
import sys
import zipfile
from pathlib import Path

DESKTOP = Path(__file__).resolve().parent.parent
TAURI = DESKTOP / 'src-tauri'

NOTE = """\
Torre, the portable copy.

Your games and settings are kept in the home folder next to Torre.exe, so you can move this
whole folder, or carry it on a USB stick, and everything comes along.

Delete this file to use the same folder as an installed Torre (.torre in your user folder).

Torre needs Microsoft Edge WebView2, which Windows 11 and most Windows 10 computers have. If
Torre does not open, install it from https://developer.microsoft.com/microsoft-edge/webview2/
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--exe', type=Path, default=TAURI / 'target' / 'release' / 'Torre.exe')
    parser.add_argument('--runtime', type=Path, default=TAURI / 'runtime')
    parser.add_argument('--out-dir', type=Path, default=DESKTOP / 'dist')
    args = parser.parse_args()

    version = json.loads((TAURI / 'version.json').read_text(encoding='utf-8'))['version']
    for needed in (args.exe, args.runtime / 'python' / 'python.exe', args.runtime / 'stockfish'):
        if not needed.exists():
            sys.exit(f'{needed} is missing: run scripts/build_runtime.py and npm run build on Windows first.')

    args.out_dir.mkdir(parents=True, exist_ok=True)
    out = args.out_dir / f'Torre_{version}_x64-portable.zip'
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.write(args.exe, 'Torre/Torre.exe')
        archive.writestr('Torre/portable.txt', NOTE.replace('\n', '\r\n'))
        for folder in ('python', 'stockfish'):
            for path in sorted((args.runtime / folder).rglob('*')):
                if path.is_file():
                    archive.write(path, f'Torre/{folder}/{path.relative_to(args.runtime / folder).as_posix()}')
    print(f'{out} ({out.stat().st_size / 1_048_576:.0f} MB)')


if __name__ == '__main__':
    main()
