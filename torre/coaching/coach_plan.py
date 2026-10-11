"""Coach tasks backed by real activity counters, without model calls or duplicate XP awards."""
import hashlib
import threading
from pathlib import Path

from torre.learning import lessons
from torre.learning import puzzles
from torre import jsonio
LOCK = threading.Lock()
GOALS = {'puzzles': 5, 'lessons': 1, 'openings': 3, 'play': 1}


def activity(data_dir):
    root = Path(data_dir)
    games = {r['id'] for r in jsonio.read_records(root / 'played.jsonl') if r.get('id') is not None}
    return {'puzzles': jsonio.read_dict(root / 'puzzles.json').get('puzzles', {}),
            'lessons': jsonio.read_dict(root / 'lessons.json').get('lessons', {}),
            'openings': jsonio.read_dict(root / 'openings.json').get('cards', {}), 'games': games,
            'packs': puzzles.load_packs()}


def count(task, state):
    kind, target = task['kind'], task['target']
    if kind == 'puzzles':
        ids = {p['id'] for p in state['packs'].get('themes', {}).get(target, [])} if target and target != puzzles.MISSED else None
        return sum(int(entry.get('solved', 0)) for key, entry in state['puzzles'].items() if (ids is None or key in ids) and (target != puzzles.MISSED or entry.get('first') == 'missed'))
    if kind == 'lessons':
        return sum(bool(entry.get('completed')) for key, entry in state['lessons'].items() if not target or key == target)
    if kind == 'openings':
        return sum(max(0, int(entry.get('reviews', 0)) - int(entry.get('lapses', 0))) for entry in state['openings'].values())
    return len(state['games'])


def focus_areas(skill_ids, available_themes, lang='en'):
    """Focus areas for the coach's focus skills (coach_focus.py): puzzles of each skill's theme."""
    from torre.coaching import coach_lessons
    from torre.coaching import skills
    lines = coach_lessons.Lines(lang)
    areas = []
    for skill in skill_ids:
        theme = next((t for t in skills.SKILLS.get(skill, {}).get('puzzle_themes', []) if t in available_themes), '')
        areas.append({'drill': {'kind': 'puzzles', 'target': theme}, 'title': lines.skill(skill, 'title'),
                      'why': lines.skill(skill, 'idea')})
    return areas


def view(data_dir, advice, brief, lang='en', focus_skills=None):
    """Keep task baselines across visits, translations, and reanalysis; report actual progress.
    With the coach's focus skills, the tasks practise those; otherwise the AI advice's drills."""
    state = activity(data_dir)
    known_lessons = {p.stem for p in Path(lessons.LESSONS_DIR).glob('*.json') if p.name != lessons.UNITS_FILE}
    available_themes = {key for key, pack in state['packs'].get('themes', {}).items() if pack}
    focus = focus_areas(focus_skills, available_themes, lang) if focus_skills else (advice or {}).get('focus') or []
    if not focus:
        weak = ((brief.get('puzzles') or {}).get('weakest_themes') or [{}])[0].get('theme', '')
        pending = (brief.get('lessons') or {}).get('not_done_by_category') or {}
        lesson = next((slug for group in pending.values() for slug in group if slug in known_lessons), '')
        focus = [{'drill': {'kind': 'puzzles', 'target': weak}}, {'drill': {'kind': 'lessons', 'target': lesson}}]
    path = Path(data_dir) / 'coach-tasks.json'
    with LOCK:
        stored = jsonio.read_dict(path)
        changed = False
        result = []
        seen = set()
        for area in focus[:3]:
            drill = area.get('drill') or {}
            kind = drill.get('kind') if drill.get('kind') in GOALS else 'puzzles'
            target = drill.get('target') or ''
            if kind == 'puzzles' and target not in available_themes | {puzzles.MISSED}:
                target = ''  # mixed puzzles are always a real destination
            if kind == 'lessons' and target not in known_lessons:
                target = ''
            if kind in ('openings', 'play'):
                target = ''  # free-form AI text is never treated as a route or selector
            if kind == 'puzzles' and not available_themes:
                continue
            if kind == 'lessons' and not known_lessons:
                continue
            task_id = hashlib.sha256(f'{kind}:{target}'.encode()).hexdigest()[:16]
            if task_id in seen:
                continue
            seen.add(task_id)
            task = {'id': task_id, 'kind': kind, 'target': target, 'goal': GOALS[kind]}
            value = count(task, state)
            if task_id not in stored:
                stored[task_id] = {'baseline': value}
                # A previously completed specific lesson remains completed.
                if kind == 'lessons' and target and value:
                    stored[task_id]['baseline'] = 0
                changed = True
            progress = min(task['goal'], max(0, value - stored[task_id]['baseline']))
            result.append({**task, 'progress': progress, 'done': progress >= task['goal'],
                           'title': area.get('title') or '', 'why': area.get('why') or ''})
        if changed:
            path.parent.mkdir(parents=True, exist_ok=True)
            jsonio.write_json(path, stored, indent=1)
    return result
