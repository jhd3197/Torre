"""Where Torre's files are.

The app's own files ship inside the package: its content (lessons, puzzles, catalogs) and the
built interface (ui/, written by `npm run build` in web/). What Torre writes (your games, engines,
the legends' games) goes to its home: the checkout itself when it runs from source, ~/.torre once
installed with pip, or TORRE_HOME. The data folder is <home>/data unless CHESS_STUDIO_DATA says
otherwise (and the studio's --data-dir overrides both).
"""
import os
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent
REPO = PACKAGE.parent
CONTENT = PACKAGE / 'content'  # catalogs, grading, the opening book, Spanish text
LESSONS = CONTENT / 'lessons'
PUZZLES = CONTENT / 'puzzles'
UI = PACKAGE / 'ui'  # the built interface

# A source checkout has web/ next to the package; an installed package does not.
SOURCE = (REPO / 'web' / 'package.json').is_file()
HOME = Path(os.environ.get('TORRE_HOME') or (REPO if SOURCE else Path.home() / '.torre')).expanduser()
DATA = Path(os.environ.get('CHESS_STUDIO_DATA') or HOME / 'data').expanduser()

# The interface's text, which the coach also speaks: the source files, or the copy the build ships.
LOCALES = REPO / 'web' / 'src' / 'i18n' / 'locales' if SOURCE else UI / 'locales'
