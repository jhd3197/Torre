"""The base of the studio's background jobs (analysis, engine and coach installs, imports, voice
packs, Arena matches, the legends' first-run download).

A job runs one piece of work at a time on a daemon thread and keeps a state dict the UI polls.
A subclass validates its request, then calls launch(state, *args), which runs work(*args) on the
thread; while it runs, a second launch raises JobBusy (the API answers 409 with busy_message).
Callers that only mean "make sure it runs" suppress JobBusy.

The state is read and written under `lock`. status() is a deep copy with 'running' (whether the
thread is alive). An exception from work() is logged and its message lands in state['error']
(failed() says how); finished() runs last whatever happened. stop() asks the work to end at its
next stopping check.
"""
import copy
import logging
import threading


class JobBusy(Exception):
    """A job was started while it is still running."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class BackgroundJob:
    busy_message = 'This is already running.'
    label = 'The background job'  # how the log names it (the log is the subclass's module's)

    def __init__(self, state=None):
        self.lock = threading.Lock()
        self.thread = None
        self.state = state if state is not None else {}
        self._stop = threading.Event()

    def busy(self):
        thread = self.thread
        return thread is not None and thread.is_alive()

    def status(self):
        with self.lock:
            state = copy.deepcopy(self.state)
        state['running'] = self.busy()
        return state

    def update(self, **changes):
        with self.lock:
            self.state.update(changes)

    def launch(self, state, *args):
        """Start work(*args) with a fresh `state`; JobBusy while the last run is still going."""
        with self.lock:
            if self.busy():
                raise JobBusy(self.busy_message)
            self._stop.clear()
            self.state = state
            self.thread = threading.Thread(target=self.execute, args=args, daemon=True)
            self.thread.start()

    def execute(self, *args):
        """work(*args), then failed() if it raised, then finished(): what the thread runs (tests call it directly)."""
        try:
            self.work(*args)
        except Exception as exc:  # surfaced to the UI through status()
            self.failed(exc)
        finally:
            self.finished()

    def work(self, *args):
        raise NotImplementedError

    def failed(self, exc):
        logging.getLogger(type(self).__module__).error('%s failed', self.label, exc_info=exc)
        self.update(error=str(exc) or type(exc).__name__)

    def finished(self):
        """Runs on the job's thread after work(), whether it ended, failed or was stopped."""

    def stop(self):
        self._stop.set()

    @property
    def stopping(self):
        return self._stop.is_set()

    def join(self, timeout=None):
        thread = self.thread
        if thread is not None:
            thread.join(timeout)

    def shutdown(self, timeout=5):
        """Ask the work to stop and wait for it a little (the server is closing)."""
        self._stop.set()
        self.join(timeout)
