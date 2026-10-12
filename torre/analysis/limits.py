"""Resource limits for a shared host, read from the environment.

A desktop install leaves these unset and gets every core. A server that runs many
studios side by side (one per hosted player) sets them so no single studio takes the
machine:

  TORRE_ENGINE_THREADS   most search threads an engine may use, and the studio's total
  TORRE_ENGINE_HASH_MB   most hash memory (MB) an engine may use
  TORRE_BACKGROUND_ANALYSIS=0   no automatic analysis of new games; "Analyze all" still works

They are read on every call, so tests (and a restarted job) see the current value.
"""
import os


def _positive_int(name):
    try:
        value = int(os.environ.get(name, '').strip())
    except ValueError:
        return None
    return value if value > 0 else None


def engine_threads():
    """The thread cap from TORRE_ENGINE_THREADS, or None for no cap."""
    return _positive_int('TORRE_ENGINE_THREADS')


def engine_hash_mb():
    """The hash cap in MB from TORRE_ENGINE_HASH_MB, or None for no cap."""
    return _positive_int('TORRE_ENGINE_HASH_MB')


def background_analysis():
    """False when TORRE_BACKGROUND_ANALYSIS turns the automatic analysis job off."""
    return os.environ.get('TORRE_BACKGROUND_ANALYSIS', '').strip().lower() not in ('0', 'false', 'no', 'off')


def total_threads():
    """Threads the whole studio may search with at once."""
    return engine_threads() or os.cpu_count() or 2


def cap(options):
    """A copy of UCI `options` with Threads and Hash held to the caps; other keys untouched."""
    capped = dict(options)
    for key, limit in (('Threads', engine_threads()), ('Hash', engine_hash_mb())):
        if limit and key in capped:
            try:
                capped[key] = min(int(capped[key]), limit)
            except (TypeError, ValueError):
                pass
    return capped
