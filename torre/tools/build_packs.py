"""Zip the recorded voice packs for download and list them in packs.json.

    python -m torre.tools.build_packs            # dist/voice/<folder>/ -> dist/packs/voice-<folder>.zip + packs.json

<folder> is narrate.pack_folder(): "en" for the female voice, "en-male" for the male one.

The studio (packs.py) reads packs.json from the `voice-packs` GitHub release, shows each pack with
its size, and checks the sha256 after downloading. Publish with `.\dev.ps1 packs publish`.
"""
import hashlib
import json
import sys
import time
import zipfile
from pathlib import Path
from torre import paths

ROOT = paths.REPO
VOICE = ROOT / 'dist' / 'voice'
OUT = ROOT / 'dist' / 'packs'
TITLES = {
    ('en', 'female'): 'Coach voice in English (female)', ('en', 'male'): 'Coach voice in English (male)',
    ('es', 'female'): 'Voz de la entrenadora en español', ('es', 'male'): 'Voz del entrenador en español',
}


def build(name):
    folder = VOICE / name
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    files = [folder / 'manifest.json'] + [folder / f'{key}.mp3' for key in manifest['lines']]
    missing = [f.name for f in files if not f.exists()]
    if missing:
        raise SystemExit(f'{name}: {len(missing)} recordings are missing; run torre narrate first.')
    lang, gender = manifest.get('lang', name), manifest.get('gender', 'female')
    target = OUT / f'voice-{name}.zip'
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_STORED) as archive:  # mp3 does not compress further
        for path in files:
            archive.write(path, path.name)
    data = target.read_bytes()
    return {'id': f'voice-{name}', 'lang': lang, 'gender': gender, 'title': TITLES.get((lang, gender), name), 'voice': manifest['voice'],
            'lines': len(manifest['lines']), 'version': time.strftime('%Y-%m-%d'), 'file': target.name,
            'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    names = sys.argv[1:] or sorted(p.name for p in VOICE.iterdir() if (p / 'manifest.json').exists())
    listed = [build(name) for name in names]
    (OUT / 'packs.json').write_text(json.dumps({'packs': listed}, ensure_ascii=False, indent=1), encoding='utf-8')
    for pack in listed:
        print(f'{pack["file"]}: {pack["lines"]} lines, {pack["bytes"] / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
