"""What Torre's AI runs on: Prompture (whether it is there, installing it), Prompture Desk, and
what the models have cost.

Prompture is optional. INSTALL pip-installs it from the app: into the virtualenv the studio runs
in, or into <data>/pylib for a plain Python such as Vela's (use_data_dir puts that folder on the
import path at startup).

Prompture Desk is Prompture's desktop app: when it is open, its companion service answers on
this computer, and Torre says so. Usage comes from Prompture's ledger, which every Prompture app
on this computer writes to.
"""
import importlib
import importlib.metadata
import importlib.util
import subprocess
import sys
from pathlib import Path

from torre.server import jobs

PACKAGE = 'prompture>=1.13'
PYLIB = 'pylib'  # Prompture's install folder in the data folder when the studio runs outside a virtualenv
INSTALL_TIMEOUT_S = 900
DATA_DIR = Path('data')  # the data folder in use, set by use_data_dir

MISSING_PROMPTURE = 'Prompture is not installed. Install it in Settings > AI.'
NO_MODEL = 'No AI model is chosen. Pick one in Settings > AI.'


def use_data_dir(data_dir):
    """Remember the data folder, put <data>/pylib on the import path when an earlier install put
    Prompture there, and move keys kept in the data folder into Prompture's shared store."""
    global DATA_DIR
    DATA_DIR = Path(data_dir)
    pylib = str(Path(data_dir) / PYLIB)
    if Path(pylib).is_dir() and pylib not in sys.path:
        sys.path.insert(0, pylib)
        importlib.invalidate_caches()
    from torre.ai import keys
    keys.migrate(data_dir)


def prompture_installed():
    return importlib.util.find_spec('prompture') is not None


def prompture_version():
    try:
        return importlib.metadata.version('prompture')
    except importlib.metadata.PackageNotFoundError:
        return None


def in_virtualenv():
    return sys.prefix != sys.base_prefix


class InstallJob(jobs.BackgroundJob):
    """pip-installs Prompture, one install at a time."""
    busy_message = 'Prompture is already being installed.'
    label = 'Installing Prompture'

    def __init__(self):
        super().__init__({'running': False, 'error': None, 'done': False})

    def start(self, data_dir):
        self.launch({'running': True, 'error': None, 'done': False}, data_dir)

    def command(self, data_dir):
        cmd = [sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--upgrade', PACKAGE]
        return cmd if in_virtualenv() else cmd + ['--target', str(Path(data_dir) / PYLIB)]

    def _run(self, cmd):
        """Run a command without a console window; (returncode, the last lines it printed). Tests replace this."""
        flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=INSTALL_TIMEOUT_S, creationflags=flags)
        return done.returncode, '\n'.join((done.stderr or done.stdout or '').strip().splitlines()[-3:])

    def work(self, data_dir):
        if importlib.util.find_spec('pip') is None:
            self._run([sys.executable, '-m', 'ensurepip', '--default-pip'])
        code, tail = self._run(self.command(data_dir))
        if code:
            raise RuntimeError(tail or f'pip exited with code {code}')
        use_data_dir(data_dir)
        importlib.invalidate_caches()
        if not prompture_installed():
            raise RuntimeError('Prompture was installed but cannot be imported. Restart the app.')
        self.update(done=True)


INSTALL = InstallJob()


def desk():
    """{'running', 'version'}: whether Prompture Desk's companion answers on this computer. Tests replace this."""
    try:
        from prompture.companion.server import running_instance
        state = running_instance(timeout=0.5)
    except Exception:  # no Prompture, or one without the companion
        return {'running': False, 'version': None}
    return {'running': bool(state), 'version': (state or {}).get('version')}


def usage(limit=8):
    """The models used most through Prompture on this computer, by any app: [{model, calls, tokens,
    cost, last_used}], costliest first. Empty without Prompture's ledger. Tests replace this."""
    try:
        from prompture.infra.ledger import _get_ledger
        rows = _get_ledger().get_all_stats()
    except Exception:
        return []
    by_model = {}
    for r in rows:  # one row per model and key: add the keys up
        if not r.get('model_name'):
            continue
        row = by_model.setdefault(r['model_name'], {'model': r['model_name'], 'calls': 0, 'tokens': 0, 'cost': 0.0, 'last_used': ''})
        row['calls'] += int(r.get('use_count') or 0)
        row['tokens'] += int(r.get('total_tokens') or 0)
        row['cost'] += float(r.get('total_cost') or 0.0)
        row['last_used'] = max(row['last_used'], str(r.get('last_used') or ''))
    out = sorted(by_model.values(), key=lambda r: (-r['cost'], -r['calls']))
    return [{**r, 'cost': round(r['cost'], 4)} for r in out[:limit]]
