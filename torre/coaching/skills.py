"""Skills: the one vocabulary the coach speaks, shared by games, puzzles, lessons, drills and endgames.

A skill ties together everything that trains or tests one idea:

    motif_tags     tags motifs.tags_for() puts on a mistake (the tactic you missed or allowed)
    scan_facts     achievements.scan() counts that show you played it in a game
    puzzle_themes  puzzles.THEMES slugs whose puzzles practise it
    endgames       endgames.py groups whose positions practise it

The lessons that teach a skill are the ones whose `practice` theme is one of its puzzle themes
(lessons/*.json), so lessons need no extra tagging. coach_ledger.py turns all of this into
evidence, coach_focus.py picks what to work on, coach_session.py builds the practice.
"""
import json
from pathlib import Path

from torre.learning import lessons
FAMILIES = ('safety', 'tactics', 'checkmates', 'endgames')

SKILLS = {
    'hanging-piece': {'family': 'safety', 'motif_tags': ['hangingPiece'], 'scan_facts': [],
                      'puzzle_themes': ['hanging-piece', 'trapped-piece'], 'endgames': []},
    'defence': {'family': 'safety', 'motif_tags': [], 'scan_facts': [],
                'puzzle_themes': ['defensive-move', 'quiet-move'], 'endgames': []},
    'fork': {'family': 'tactics', 'motif_tags': ['fork'], 'scan_facts': ['fork'],
             'puzzle_themes': ['fork'], 'endgames': []},
    'pin': {'family': 'tactics', 'motif_tags': [], 'scan_facts': ['pin'],
            'puzzle_themes': ['pin', 'x-ray'], 'endgames': []},
    'skewer': {'family': 'tactics', 'motif_tags': [], 'scan_facts': ['skewer'],
               'puzzle_themes': ['skewer'], 'endgames': []},
    'discovered-attack': {'family': 'tactics', 'motif_tags': [], 'scan_facts': ['discovery'],
                          'puzzle_themes': ['discovered-attack', 'double-check'], 'endgames': []},
    'deflection': {'family': 'tactics', 'motif_tags': [], 'scan_facts': [],
                   'puzzle_themes': ['deflection', 'attraction', 'capturing-defender', 'interference', 'clearance'],
                   'endgames': []},
    'sacrifice': {'family': 'tactics', 'motif_tags': [], 'scan_facts': ['sacrifice'],
                  'puzzle_themes': ['sacrifice', 'zwischenzug', 'exposed-king', 'kingside-attack'], 'endgames': []},
    'mate-in-one': {'family': 'checkmates', 'motif_tags': ['mateIn1'], 'scan_facts': ['checkmate'],
                    'puzzle_themes': ['mate-in-1'], 'endgames': []},
    'mating-attack': {'family': 'checkmates', 'motif_tags': ['mateIn2', 'mateIn3', 'mateIn4'], 'scan_facts': [],
                      'puzzle_themes': ['mate-in-2', 'mate-in-3', 'mate-in-4', 'smothered-mate', 'arabian-mate',
                                        'anastasia-mate', 'boden-mate', 'hook-mate'],
                      'endgames': ['mates']},
    'back-rank': {'family': 'checkmates', 'motif_tags': ['backRankMate'], 'scan_facts': ['back_rank'],
                  'puzzle_themes': ['back-rank-mate'], 'endgames': []},
    'promotion': {'family': 'endgames', 'motif_tags': ['promotion'], 'scan_facts': ['promotion'],
                  'puzzle_themes': ['promotion', 'underpromotion'], 'endgames': []},
    'pawn-endgame': {'family': 'endgames', 'motif_tags': [], 'scan_facts': [],
                     'puzzle_themes': ['pawn-endgame'], 'endgames': ['pawns']},
    'piece-endgame': {'family': 'endgames', 'motif_tags': [], 'scan_facts': [],
                      'puzzle_themes': ['rook-endgame', 'bishop-endgame', 'knight-endgame', 'queen-endgame'],
                      'endgames': ['rooks', 'pieces']},
}

_BY_TAG = {tag: skill for skill, s in SKILLS.items() for tag in s['motif_tags']}
_BY_THEME = {theme: skill for skill, s in SKILLS.items() for theme in s['puzzle_themes']}
_BY_FACT = {fact: skill for skill, s in SKILLS.items() for fact in s['scan_facts']}
_BY_ENDGAME = {group: skill for skill, s in SKILLS.items() for group in s['endgames']}
# Puzzle tags (the Lichess-style names in the packs) for each theme slug, filled lazily from puzzles.THEMES.
_TAG_THEME = None


def skill_for_tag(tag):
    """The skill a motif tag (motifs.MOTIFS: 'fork', 'mateIn2'...) belongs to, or None."""
    return _BY_TAG.get(tag)


def skill_for_theme(slug):
    """The skill a puzzle theme slug ('fork', 'back-rank-mate'...) trains, or None."""
    return _BY_THEME.get(slug)


def skill_for_fact(fact):
    return _BY_FACT.get(fact)


def skill_for_endgame(group):
    return _BY_ENDGAME.get(group)


def skills_for_puzzle_tags(tags):
    """Skills a puzzle's tags (its 'themes' list in a pack: 'fork', 'mateIn2', 'myGames'...) train."""
    global _TAG_THEME
    if _TAG_THEME is None:
        from torre.learning import puzzles
        _TAG_THEME = {tag: slug for slug, (tag, *_rest) in puzzles.THEMES.items()}
    found = []
    for tag in tags or []:
        skill = skill_for_theme(_TAG_THEME.get(tag, ''))
        if skill and skill not in found:
            found.append(skill)
    return found


def lesson_skills(folder=None):
    """{lesson slug: skill} for every lesson whose `practice` theme trains a skill."""
    out = {}
    for path in sorted(Path(folder or lessons.LESSONS_DIR).glob('*.json')):
        if path.name == lessons.UNITS_FILE:
            continue
        try:
            raw = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        skill = skill_for_theme(raw.get('practice')) if isinstance(raw, dict) else None
        if skill:
            out[path.stem] = skill
    return out


# The lesson categories that teach a skill head on, best first; history and opening lessons only
# touch on one, so they are a teaching block's last resort.
TEACHING_ORDER = ('tactics', 'checkmates', 'basics', 'endgames', 'strategy', 'openings', 'history')


def teaching_lessons(skill, folder=None):
    """Slugs of the lessons that teach a skill, the most direct first."""
    folder = Path(folder or lessons.LESSONS_DIR)
    found = []
    for slug, owner in lesson_skills(folder).items():
        if owner != skill:
            continue
        try:
            raw = json.loads((folder / f'{slug}.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        category = raw.get('category')
        rank = TEACHING_ORDER.index(category) if category in TEACHING_ORDER else len(TEACHING_ORDER)
        found.append((rank, slug))
    return [slug for _, slug in sorted(found)]


def practiceable(skill, theme_counts):
    """Whether there is something to practise the skill with: puzzles in the packs (`theme_counts`:
    {theme slug: number of puzzles}) or a lesson that teaches it."""
    spec = SKILLS.get(skill)
    if not spec:
        return False
    return any(theme_counts.get(t) for t in spec['puzzle_themes']) or bool(teaching_lessons(skill))
