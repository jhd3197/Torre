"""Replace em dashes in lesson wording with plain punctuation.

    python -m scripts.clean_wording           # show every change
    python -m scripts.clean_wording --write   # apply them

Em dashes read as machine-written, so lesson text uses ordinary punctuation:
- a pair of dashes around an aside becomes a pair of commas;
- a dash before "and", "but", "so", "or", "then", "which", "because"... becomes a comma;
- otherwise a dash after a move ("18...Nb3 — the knight goes deep") becomes a colon;
- any other dash, which introduces what explains the first part, becomes a colon.
Only the text inside JSON string values changes; the files keep their formatting.
"""
import json
import re
import sys
from pathlib import Path
from torre import paths

ROOT = Path(__file__).resolve().parents[1]
LESSONS = paths.LESSONS
DASH = re.compile(r'\s*—\s*')
JOINERS = {'and', 'but', 'so', 'or', 'then', 'which', 'because', 'while', 'yet', 'though', 'although', 'until',
           'unless', 'before', 'after', 'when', 'where', 'as', 'not', 'even', 'just', 'well'}
# A move in game notation at the end of the text before the dash: "18...Nb3", "6.bxc3", "33.Qxf6+", "51...Ke6?"
MOVE_BEFORE = re.compile(r'(\d+\.(\.\.)?\s*)?([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?|O-O(-O)?)[+#]?[!?]{0,2}$')


# Where the rules read awkwardly, the exact wording to use instead.
OVERRIDES = {
    "fork master: great job today!": "fork master. Great job today!",
    "Block it: with the move": "Block it with the move",
    "And a last question, where": "And a last question: where",
    "mastered the back rank, well done!": "mastered the back rank. Well done!",
    "Slide your bishop to c4: don't worry": "Slide your bishop to c4. Don't worry",
    "Petrosian removes it: at a price.": "Petrosian removes it, at a price.",
}


def clean(text: str) -> str:
    fixed = _clean(text)
    for old, new in OVERRIDES.items():
        fixed = fixed.replace(old, new)
    return fixed


def _clean(text: str) -> str:
    parts = DASH.split(text)
    if len(parts) == 1:
        return text
    if len(parts) == 3 and not parts[2][:1].isupper():
        # "the rook, a strong piece, slides": an aside between two dashes.
        return f'{parts[0]}, {parts[1]}, {parts[2]}'
    out = parts[0]
    for after in parts[1:]:
        first = re.match(r"[A-Za-z']+", after)
        word = first.group(0).lower() if first else ''
        if word in JOINERS:
            out = f'{out}, {after}'
        elif MOVE_BEFORE.search(out.strip()):
            out = f'{out}: {after}'
        else:
            out = f'{out}: {after}'
    return out


def strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from strings(value)


def main():
    write = '--write' in sys.argv
    changed = 0
    for path in sorted(LESSONS.glob('*.json')):
        raw = path.read_text(encoding='utf-8')
        new_raw = raw
        for text in set(strings(json.loads(raw))):
            if '—' not in text:
                continue
            fixed = clean(text)
            old_json = json.dumps(text, ensure_ascii=False)[1:-1]
            new_json = json.dumps(fixed, ensure_ascii=False)[1:-1]
            if old_json not in new_raw:
                print(f'  ! {path.name}: could not locate a string, fix by hand: {text[:60]}')
                continue
            new_raw = new_raw.replace(old_json, new_json)
            changed += 1
            if not write:
                print(f'{path.stem}:\n  - {text}\n  + {fixed}')
        if write and new_raw != raw:
            json.loads(new_raw)  # still valid JSON
            path.write_text(new_raw, encoding='utf-8', newline='')
    print(f'\n{changed} strings {"rewritten" if write else "to rewrite"}.')


if __name__ == '__main__':
    main()
