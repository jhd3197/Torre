"""Logging for the studio server: the console, plus a rotating file in the data folder
(<data>/logs/torre.log) that keeps tracebacks of failed requests and background jobs."""
import logging
import logging.handlers
from pathlib import Path

FORMAT = '%(asctime)s %(levelname)-7s %(name)s: %(message)s'
FILE_BYTES = 1_000_000
FILE_BACKUPS = 3
_handlers = []


def setup(data_dir, level=logging.INFO):
    """Configure the root logger once (calling it again only moves the log file). Returns the
    log file's path, or None when it cannot be created (read-only folder)."""
    root = logging.getLogger()
    for handler in _handlers:
        root.removeHandler(handler)
        handler.close()
    _handlers.clear()
    formatter = logging.Formatter(FORMAT)
    console = logging.StreamHandler()
    console.setFormatter(formatter)
    _handlers.append(console)
    path = Path(data_dir) / 'logs' / 'torre.log'
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        to_file = logging.handlers.RotatingFileHandler(path, maxBytes=FILE_BYTES, backupCount=FILE_BACKUPS,
                                                       encoding='utf-8', delay=True)
    except OSError:
        path = None
    else:
        to_file.setFormatter(formatter)
        _handlers.append(to_file)
    for handler in _handlers:
        root.addHandler(handler)
    root.setLevel(level)
    for chatty in QUIET:  # a line per HTTP call to the coach's model, for instance
        logging.getLogger(chatty).setLevel(max(level, logging.WARNING))
    return path


QUIET = ('httpx', 'httpcore', 'urllib3', 'asyncio')
