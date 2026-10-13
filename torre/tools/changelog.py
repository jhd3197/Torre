"""CHANGELOG.md at release time: stamp the Unreleased notes with the version, and write the
GitHub release's text from them.

    python -m torre.tools.changelog stamp 0.4.0 [--date 2026-10-13]
    python -m torre.tools.changelog notes 0.4.0 --assets assets.json --repo jhd3197/Torre [--previous v0.3.9]

`stamp` turns "## Unreleased" into "## 0.4.0 - <date>" under a fresh, empty Unreleased.
`notes` prints that version's section, then the downloads (from `gh release view --json assets`)
grouped by system, with the steps an unsigned installer needs.
"""
import argparse
import datetime
import json
import re
import sys
from pathlib import Path

CHANGELOG = Path(__file__).resolve().parents[2] / 'CHANGELOG.md'
UNRELEASED = re.compile(r'^## Unreleased[ \t]*\n', re.M)
EMPTY = 'Maintenance release: no changes you will notice.'


def section(text, version):
    """The body under "## <version> - <date>", or None."""
    match = re.search(r'^## ' + re.escape(version) + r' - [^\n]+\n(.*?)(?=^## |\Z)', text, re.M | re.S)
    return match.group(1).strip() if match else None


def unreleased(text):
    """(text before the Unreleased heading, its notes, the released history after them)."""
    match = UNRELEASED.search(text)
    if not match:
        raise ValueError('CHANGELOG.md has no "## Unreleased" section')
    rest = text[match.end():]
    following = re.search(r'^## ', rest, re.M)
    end = following.start() if following else len(rest)
    return text[:match.start()], rest[:end].strip(), rest[end:]


def stamp(text, version, date):
    """The changelog with the Unreleased notes moved under the version. Stamping a version that is
    already there changes nothing, so a rerun release does not take newer Unreleased notes."""
    if section(text, version) is not None:
        return text
    head, body, history = unreleased(text)
    return head + f'## Unreleased\n\n## {version} - {date}\n\n{body or EMPTY}\n\n' + history


def size(n):
    return f'{n / 1048576:.0f} MB' if n >= 1048576 else f'{max(1, round(n / 1024))} KB'


# (heading, [(file pattern, label)], what to do after downloading)
SYSTEMS = [
    ('Windows', [(r'_x64-setup\.exe$', 'Installer (x64)')],
     'The installer is not signed yet, so Windows SmartScreen may say "Windows protected your PC". '
     'Click **More info**, then **Run anyway**.'),
    ('macOS', [(r'_aarch64\.dmg$', 'Apple silicon (M1 and later)'), (r'_x64\.dmg$', 'Intel')],
     'Open the disk image and drag **Torre** into **Applications**. Apple has not notarized it yet, '
     'so macOS says it "is damaged" the first time. Run this once in Terminal, then open it normally:\n\n'
     '```bash\nxattr -cr /Applications/Torre.app\n```'),
    ('Linux', [(r'\.AppImage$', 'AppImage (x64)'), (r'\.deb$', 'Debian and Ubuntu (x64)')],
     'AppImage: `chmod +x` the file and run it. Debian or Ubuntu: `sudo apt install ./<file>.deb`.'),
]


def downloads(assets, base):
    lines = []
    for heading, kinds, after in SYSTEMS:
        rows = [f'| {label} | [`{a["name"]}`]({base}/{a["name"]}) | {size(a["size"])} |'
                for pattern, label in kinds for a in assets if re.search(pattern, a['name'])]
        if rows:
            lines += [f'**{heading}**', '', '| | File | Size |', '|---|---|---|', *rows, '', after, '']
    return lines


def notes(text, version, assets, repo, previous=None):
    body = section(text, version)
    if body is None:
        raise ValueError(f'CHANGELOG.md has no section for {version}; run `stamp` first')
    tag = f'v{version}'
    base = f'https://github.com/{repo}/releases/download/{tag}'
    lines = [body, '', '## Download', '',
             'Each installer includes Python and Stockfish: nothing else to set up, and it works offline.', '']
    lines += downloads(assets, base)
    lines += ['**Python or Docker**', '', '```bash', f'pip install torre=={version}',
              f'docker run -d --name torre -p 127.0.0.1:1886:1886 -v torre-data:/data ghcr.io/{repo.lower()}:{version}',
              '```', '']
    if any(a['name'] == 'SHA256SUMS.txt' for a in assets):
        lines += ['`SHA256SUMS.txt` has a checksum for every file: `sha256sum -c SHA256SUMS.txt` on macOS or Linux, '
                  '`certutil -hashfile <file> SHA256` on Windows.', '']
    if previous:
        lines += [f'Every commit: [{previous}...{tag}](https://github.com/{repo}/compare/{previous}...{tag})', '']
    return '\n'.join(lines).rstrip() + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    stamp_cmd = commands.add_parser('stamp', help='move the Unreleased notes under a version')
    stamp_cmd.add_argument('version')
    stamp_cmd.add_argument('--date', default=datetime.date.today().isoformat())
    notes_cmd = commands.add_parser('notes', help="print a version's release text")
    notes_cmd.add_argument('version')
    notes_cmd.add_argument('--assets', type=Path, help='`gh release view --json assets` output')
    notes_cmd.add_argument('--repo', required=True, help='owner/name')
    notes_cmd.add_argument('--previous', help='the previous release tag, for the compare link')
    args = parser.parse_args(argv)

    text = CHANGELOG.read_text(encoding='utf-8')
    try:
        if args.command == 'stamp':
            if section(text, args.version) is None and not unreleased(text)[1]:
                print('warning: no Unreleased notes; the release says it is maintenance only', file=sys.stderr)
            CHANGELOG.write_text(stamp(text, args.version, args.date), encoding='utf-8')
        else:
            assets = json.loads(args.assets.read_text(encoding='utf-8'))['assets'] if args.assets else []
            sys.stdout.write(notes(text, args.version, assets, args.repo, args.previous))
    except ValueError as exc:
        parser.exit(1, f'changelog: {exc}\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
