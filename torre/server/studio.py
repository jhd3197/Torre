"""Local, board-first chess studio. Run: .venv/Scripts/python -m torre.server.studio"""
import argparse
import json
import logging
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from torre import paths

ROOT = paths.REPO
# Vela packages bundle python-chess here so the app needs no pip install.
if (ROOT / 'vendor').is_dir():
    sys.path.insert(0, str(ROOT / 'vendor'))

import chess.engine
from torre.server import access
from torre.server import api_board
from torre.server import api_coach
from torre.server import api_engines
from torre.server import api_games
from torre.server import api_training
from torre.server import appdata
from torre.server import applog
from torre.server import hosts
from torre.analysis import engines
from torre.games import importer
from torre.server import jobs
from torre.games import masters
from torre import translations
from torre.server.routes import MEDIA_TYPES, ApiError, BadRequest, Request, Response, Routes

log = logging.getLogger('studio')
http_log = logging.getLogger('studio.http')

# Behind a proxy such as Vela, the Origin is the proxy's, so POSTs rely on the
# custom header (which forces a CORS preflight this server never grants).
PROXIED = False
# Host names answered beyond IPs and local-only names (see hosts.py).
ALLOWED_HOSTS = []
UI_DIR = paths.UI  # built by `npm run build` in web/
STATIC_TYPES = MEDIA_TYPES
# Uploaded PGN collections can be large; everything else is small.
BODY_LIMITS = {'/api/import/files': 30_000_000}
BODY_LIMIT = 1_000_000
CHUNK_LINE = 65_537  # longest chunk-size line read from a chunked body
SERVER_ERROR = 'Something went wrong on the server. The details are in the log.'

ROUTES = Routes()
for area in (api_games, api_coach, api_engines, api_board, api_training):
    ROUTES.include(area.ROUTES)


def use_data_dir(path):
    appdata.use_data_dir(path)


def app_page(path):
    """index.html for an app route, with a relative <base> pointing at the app root.

    Behind a proxy that strips a prefix (Vela serves /apps/chess/... as /...),
    only the browser knows the prefix. A relative base such as "../../" for
    /games/123/11 resolves to the app root either way, so assets, API calls and
    the router's basename all work without configuration.
    """
    index = UI_DIR / 'index.html'
    if not index.is_file():
        return None
    depth = path.count('/') - 1
    base = '../' * depth if depth > 0 else './'
    html = index.read_text(encoding='utf-8')
    return html.replace('<head>', f'<head><base href="{base}">', 1).encode()


def static_file(path):
    """The built frontend file for a URL path, or None. Never leaves UI_DIR."""
    if path in ('/', '/index.html'):
        return None  # served by app_page, with its <base>
    target = (UI_DIR / path.lstrip('/')).resolve()
    if UI_DIR.resolve() not in target.parents or not target.is_file() or target.suffix not in STATIC_TYPES:
        return None
    return target


class Handler(BaseHTTPRequestHandler):
    """Routes requests through ROUTES. A client's mistake (ApiError, a busy background job, or a
    ValueError from the domain modules, whose messages are written for the reader) is answered
    with its status and message; anything else is a bug, answered with a generic 500 and logged
    with its traceback."""

    @property
    def lang(self):
        """The reader's language, from the app's X-Lang header (English by default)."""
        return translations.language(self.headers.get('X-Lang'))

    def log_message(self, format, *args):
        # One line per request is noise at the default level; turn DEBUG on to see them.
        http_log.debug('%s %s', self.address_string(), format % args)

    def log_error(self, format, *args):
        http_log.warning('%s %s', self.address_string(), format % args)

    def send(self, body, status=200, content_type='application/json; charset=utf-8', cache='no-store'):
        if isinstance(body, dict) and isinstance(body.get('error'), str):
            body = {**body, 'error': translations.message(body['error'], self.lang)}
        # Bytes are sent as they are (a .json file from disk is already JSON); anything else is encoded.
        data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode()
        self.responded = True
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', cache)
        self.end_headers()
        self.wfile.write(data)

    def reply(self, result):
        """Send what a route handler returned: a Response, a (body, status) pair, or a body."""
        if isinstance(result, Response):
            self.responded = True
            self.send_response(result.status)
            for key, value in result.headers:
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(result.data)
        elif isinstance(result, tuple):
            self.send(*result)
        else:
            self.send(result)

    def answer(self, method, path, payload=None):
        """Run the route for a request; None when no route takes it."""
        found = ROUTES.match(method, path)
        if found is None:
            return None
        handler, params = found
        access.check(handler)
        return handler(Request(method, path, parse_qs(urlparse(self.path).query), payload, self.lang, params))

    def fail(self, method, path, exc):
        """Answer a request that raised `exc`."""
        if getattr(self, 'responded', False):  # the answer was already on its way: the browser went away
            http_log.debug('%s %s: %r after the response started', method, path, exc)
            return
        if isinstance(exc, ApiError):
            status, message = exc.status, exc.message
        elif isinstance(exc, jobs.JobBusy):  # a background job asked to start while it runs
            status, message = 409, exc.message
        elif isinstance(exc, (ValueError, engines.InstallError)):  # the domain modules' validation messages
            status, message = 400, str(exc)
        elif isinstance(exc, chess.engine.EngineError) or (method == 'POST' and isinstance(exc, OSError)):
            log.warning('%s %s: the engine failed', method, path, exc_info=exc)
            status, message = 503, 'Stockfish could not complete this request: ' + str(exc)
        else:
            log.error('%s %s failed', method, path, exc_info=exc)
            status, message = 500, SERVER_ERROR
        self.send({'error': message}, status)

    def refused(self, method):
        """(message, status) for a request no route may see, else None. The one gate in front of
        every route: a request must name this machine (hosts.py), and a POST must come from the
        app itself, as JSON."""
        host = self.headers.get('Host', '')
        if not hosts.allowed(host, ALLOWED_HOSTS):
            log.warning('Refused a request for host %r; start with --allow-host to accept it.', host)
            return 'This host name is not allowed. Start Torre with --allow-host to accept it.', 400
        if method != 'POST':
            return None
        # Keep this loopback application inaccessible to cross-origin form submissions.
        origin = self.headers.get('Origin')
        if not PROXIED and origin and origin not in ('http://' + host, 'https://' + host):
            return 'Cross-origin requests are not allowed.', 403
        if self.headers.get('X-Chess-Studio') != '1':
            return 'Cross-origin requests are not allowed.', 403
        if not self.headers.get('Content-Type', '').startswith('application/json'):
            return 'Expected JSON', 415
        return None

    def do_GET(self):
        self.responded = False
        if refusal := self.refused('GET'):
            return self.send({'error': refusal[0]}, refusal[1])
        path = urlparse(self.path).path
        try:
            result = self.answer('GET', path)
            if result is not None:
                return self.reply(result)
            target = static_file(path)
            if target is not None:
                # Vite puts a content hash in every /assets/ name, so they never change.
                cache = 'public, max-age=31536000, immutable' if path.startswith('/assets/') else 'no-store'
                return self.send(target.read_bytes(), content_type=STATIC_TYPES[target.suffix], cache=cache)
            if path.startswith(('/api/', '/assets/')) or Path(path).suffix:
                return self.send({'error': 'Not found'}, 404)
            # Every other path is a page of the app (/games/123/11, /train, ...).
            page = app_page(path)
            if page is None:
                return self.send({'error': 'The interface has not been built. Run npm run build in web/.'}, 503)
            self.send(page, content_type='text/html; charset=utf-8')
        except Exception as exc:
            self.fail('GET', path, exc)

    def read_body(self, limit):
        """Read a Content-Length or chunked body (Vela's proxy streams chunked)."""
        try:
            if 'chunked' not in self.headers.get('Transfer-Encoding', '').lower():
                length = int(self.headers.get('Content-Length', 0))
                return self.rfile.read(length) if length <= limit else None
            body = b''
            while True:
                size = int(self.rfile.readline(CHUNK_LINE).split(b';', 1)[0].strip() or b'0', 16)
                if size == 0:
                    while self.rfile.readline(CHUNK_LINE).strip():
                        pass
                    return body
                if len(body) + size > limit:
                    return None
                body += self.rfile.read(size)
                self.rfile.readline(CHUNK_LINE)
        except ValueError:
            raise BadRequest('The request body could not be read.') from None

    def do_POST(self):
        self.responded = False
        if refusal := self.refused('POST'):
            return self.send({'error': refusal[0]}, refusal[1])
        path = urlparse(self.path).path
        try:
            body = self.read_body(BODY_LIMITS.get(path, BODY_LIMIT))
            if body is None:
                return self.send({'error': 'Request too large'}, 413)
            try:
                payload = json.loads(body)
            except ValueError:
                raise BadRequest('The request body is not valid JSON.') from None
            if not isinstance(payload, dict):
                raise BadRequest('The request body must be a JSON object.')
            result = self.answer('POST', path, payload)
            self.reply(result if result is not None else ({'error': 'Not found'}, 404))
        except Exception as exc:
            self.fail('POST', path, exc)




def main(argv=None):
    global PROXIED, ALLOWED_HOSTS
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default=os.environ.get('TORRE_HOST', '127.0.0.1'),
                        help='address to listen on (default: TORRE_HOST or 127.0.0.1; 0.0.0.0 in a container)')
    parser.add_argument('--port', type=int, default=1886)  # first World Championship, Steinitz–Zukertort
    parser.add_argument('--open-browser', action='store_true')
    parser.add_argument('--data-dir', default=str(paths.DATA),
                        help='folder holding games.jsonl and analysis.jsonl')
    parser.add_argument('--proxied', action='store_true',
                        help='served behind a same-origin proxy such as Vela')
    parser.add_argument('--allow-host', action='append', default=[], metavar='NAME',
                        help='also answer requests for this host name (".example.com" allows its subdomains)')
    args = parser.parse_args(argv)
    use_data_dir(args.data_dir)
    log_file = applog.setup(appdata.DATA_DIR)
    importer.migrate_ids(appdata.DATA_DIR)  # numeric ids from older imports become strings, once
    PROXIED = args.proxied
    ALLOWED_HOSTS = args.allow_host + hosts.from_env()
    masters.start_fill()  # a fresh install fetches the legends' games in the background
    api_games.auto_analyze()  # games imported but never analyzed (or analyzed by an older scoring) catch up now
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    log.info('Torre is ready at http://%s:%s (log: %s)', args.host, args.port, log_file)
    if args.open_browser:
        threading.Timer(.5, lambda: webbrowser.open(f'http://127.0.0.1:{args.port}')).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        api_games.ANALYSIS_JOB.shutdown()
        engines.POOL.close_all()


if __name__ == '__main__':
    main()
