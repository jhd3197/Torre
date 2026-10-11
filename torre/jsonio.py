"""JSON files on disk: atomic writes, and reads parsed once until the file changes.

write_atomic / write_json replace a file in one step (a temporary file in the same folder, then
os.replace), so a crash mid-write leaves the old file whole instead of a truncated one.

cached(path, build) runs build(path) once per version of the file, a version being its
(mtime_ns, size); read_jsonl is the cached reader for the JSONL archives. A cached value is
shared by every caller: treat it as read-only.
"""
import contextlib
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path


# On Windows a file another thread has open cannot be replaced for a moment; try again briefly.
REPLACE_TRIES = 20
REPLACE_WAIT = .05


def _replace(source, target):
    for attempt in range(REPLACE_TRIES):
        try:
            os.replace(source, target)
            return
        except PermissionError:
            if sys.platform != 'win32' or attempt == REPLACE_TRIES - 1:
                raise
            time.sleep(REPLACE_WAIT)


def write_atomic(path, text, encoding='utf-8'):
    """Replace `path` with `text` all at once."""
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding=encoding) as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        try:  # mkstemp makes the file private; keep the permissions a plain write would have
            os.chmod(temporary, os.stat(path).st_mode & 0o777)
        except FileNotFoundError:
            os.chmod(temporary, 0o644)
        _replace(temporary, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temporary)
        raise


def write_json(path, data, trailing_newline=False, **dumps):
    """Replace `path` with `data` as JSON (json.dumps keyword arguments pass through)."""
    write_atomic(path, json.dumps(data, **dumps) + ('\n' if trailing_newline else ''))


def read_dict(path):
    """A JSON object from `path`, or {} when the file is missing, unreadable or not an object."""
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def stamp(path):
    """(mtime_ns, size) of a file, or None when it does not exist."""
    try:
        info = os.stat(path)
    except (FileNotFoundError, NotADirectoryError):
        return None
    return info.st_mtime_ns, info.st_size


_values = {}  # key -> (stamp, value)
_guard = threading.Lock()
_locks = {}


def memo(key, version, build):
    """build(), remembered under `key` until `version` changes. Two threads missing at once
    build it once."""
    with _guard:
        hit = _values.get(key)
        if hit is not None and hit[0] == version:
            return hit[1]
        lock = _locks.setdefault(key, threading.Lock())
    with lock:
        with _guard:
            hit = _values.get(key)
        if hit is not None and hit[0] == version:
            return hit[1]
        value = build()
        with _guard:
            _values[key] = (version, value)
        return value


def cached(path, build):
    """build(path), parsed again only when the file changes (or appears, or goes)."""
    return memo((os.fspath(path), build), stamp(path), lambda: build(path))


def _parse_jsonl(path):
    rows = []
    try:
        with open(path, encoding='utf-8') as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # a line cut short by a crash
    except FileNotFoundError:
        pass
    return rows


def read_jsonl(path):
    """Every record of a JSONL file ([] when it is missing); lines that do not parse are skipped."""
    return cached(path, _parse_jsonl)


def _parse_records(path):
    return [row for row in read_jsonl(path) if isinstance(row, dict)]


def read_records(path):
    """The JSON objects of a JSONL file (other rows skipped), cached like read_jsonl."""
    return cached(path, _parse_records)


def forget():
    """Drop every cached read (tests that rewrite files within one clock tick)."""
    with _guard:
        _values.clear()
