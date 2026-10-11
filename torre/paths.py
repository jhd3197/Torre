"""Where Torre's files are: the app's own content (inside the package) and the repository around it."""
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent
REPO = PACKAGE.parent
CONTENT = PACKAGE / 'content'  # catalogs, grading, the opening book, Spanish text
LESSONS = CONTENT / 'lessons'
PUZZLES = CONTENT / 'puzzles'
