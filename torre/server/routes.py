"""The studio's route table: (method, path) -> a small handler, the shape trainer.py started.

A handler takes a Request and returns the JSON body (sent with 200), a (body, status) pair, or
a Response for anything that is not JSON. A path is matched exactly, or, when it holds a
regular-expression group, in full against the pattern; its named groups become `req.params`.
Exact paths win over patterns, and patterns are tried in the order they were added.

Client mistakes are raised as ApiError (BadRequest, NotFound, ...): the message is the English
sentence, which is also the key translations.message() looks up for the reader's language.
"""
import re

# Content types of the files the studio serves (the built interface, voice packs).
MEDIA_TYPES = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
               '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
               '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json',
               '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4'}


class ApiError(Exception):
    """A request the server will not carry out, answered with `status` and `message`."""
    status = 400

    def __init__(self, message, status=None):
        super().__init__(message)
        self.message = message
        if status is not None:
            self.status = status


class BadRequest(ApiError):
    status = 400


class NotFound(ApiError):
    status = 404


class Conflict(ApiError):
    status = 409


class Unavailable(ApiError):
    status = 503


class Request:
    """What a handler needs from an HTTP request."""

    def __init__(self, method, path, query=None, payload=None, lang='en', params=None):
        self.method, self.path, self.lang = method, path, lang
        self.query = query or {}
        self.payload = payload if payload is not None else {}
        self.params = params or {}

    def arg(self, key, default=''):
        """A query-string value (the first, when repeated)."""
        return self.query.get(key, [default])[0]


class Response:
    """A non-JSON answer (a file, a download, a redirect), sent with exactly these headers."""

    def __init__(self, data=b'', status=200, headers=()):
        self.data, self.status, self.headers = data, status, list(headers)

    @classmethod
    def file(cls, data, content_type, cache='no-store', disposition=None):
        headers = [('Content-Type', content_type)]
        if disposition:
            headers.append(('Content-Disposition', disposition))
        headers += [('Content-Length', str(len(data))), ('Cache-Control', cache)]
        return cls(data, 200, headers)


class Routes:
    def __init__(self):
        self._exact = {}
        self._patterns = []

    def add(self, method, path, handler):
        if '(' in path:
            self._patterns.append((method, re.compile(path), handler))
        else:
            if (method, path) in self._exact:
                raise ValueError(f'{method} {path} is routed twice.')
            self._exact[(method, path)] = handler
        return handler

    def route(self, method, *paths):
        def register(handler):
            for path in paths:
                self.add(method, path, handler)
            return handler
        return register

    def get(self, *paths):
        return self.route('GET', *paths)

    def post(self, *paths):
        return self.route('POST', *paths)

    def include(self, other):
        for (method, path), handler in other._exact.items():
            self.add(method, path, handler)
        self._patterns.extend(other._patterns)
        return self

    def match(self, method, path):
        """(handler, params) for a request, or None when no route takes it."""
        handler = self._exact.get((method, path))
        if handler is not None:
            return handler, {}
        for route_method, pattern, handler in self._patterns:
            found = pattern.fullmatch(path) if route_method == method else None
            if found:
                return handler, found.groupdict()
        return None


def need(payload, key, kind=str, what=None):
    """payload[key], which must be a `kind` (a type or a tuple of types); BadRequest otherwise."""
    value = payload.get(key)
    if not isinstance(value, kind) or (kind is int and isinstance(value, bool)):
        raise BadRequest(f'"{key}" must be {what or _KINDS.get(kind, "given")}.')
    return value


_KINDS = {str: 'a string', list: 'a list', int: 'a whole number', dict: 'an object'}
