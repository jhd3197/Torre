"""The gate in front of every route: Host names (DNS rebinding), the POST checks, and @admin.

Every route is fired through a live server with a request the gate must refuse; the route table
is swapped for one that fails the test if routing is ever reached, so a refusal is proven to
happen before any handler runs, whatever that handler does.
"""
import http.client
import os
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest import mock

from torre.server import access
from torre.server import hosts
from torre.server import studio
from torre.server.routes import Routes


# Routes that change what every player on a hosted server shares (see access.py). A route marked
# or unmarked @admin fails test_admin_routes_are_the_reviewed_ones until this list agrees.
ADMIN_ROUTES = {
    ('POST', '/api/engines/install'),
    ('POST', '/api/engines/models/install'),
    ('POST', '/api/engines/uninstall'),
    ('POST', '/api/engines/models/uninstall'),
    ('POST', '/api/engines/custom'),  # runs the program at any path on the server
    ('POST', '/api/engines/custom/delete'),
    ('POST', '/api/coach/install'),  # pip-installs into the server's Python
}


def every_route():
    """(method, a concrete path) for each route in the studio's table."""
    table = studio.ROUTES
    found = list(table._exact)
    for method, pattern, _ in table._patterns:
        found.append((method, pattern.pattern.split('(', 1)[0] + 'x'))
    return found


class HostTests(unittest.TestCase):
    def test_names_no_one_can_register_are_answered(self):
        for host in ('127.0.0.1:1886', 'localhost:1886', '[::1]:1886', '192.168.1.20', 'chessbox',
                     'pi.local', 'nas.lan', 'torre.home.arpa', 'box.internal', 'app.localhost'):
            self.assertTrue(hosts.allowed(host), host)

    def test_public_names_need_allowing(self):
        for host in ('evil.example:1886', 'localhost.evil.example', '', ':1886'):
            self.assertFalse(hosts.allowed(host), host)
        self.assertTrue(hosts.allowed('chess.example.com', ['chess.example.com']))
        self.assertTrue(hosts.allowed('a.example.com:443', ['.example.com']))
        self.assertFalse(hosts.allowed('example.com.evil.test', ['.example.com']))

    def test_a_star_answers_every_name(self):
        self.assertTrue(hosts.allowed('chess.example.com', ['*']))
        self.assertTrue(hosts.allowed('torre.panel.example.org:443', ['other.example', '*']))
        self.assertFalse(hosts.allowed('', ['*']))


class GateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), studio.Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def status(self, method, path, headers, body=None):
        # A refused POST is answered before its body is read, so only requests that get through send one.
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        try:
            conn.request(method, path, body=body, headers=headers)
            return conn.getresponse().status
        finally:
            conn.close()

    def app_headers(self, method):
        base = {'Host': f'127.0.0.1:{self.port}'}
        if method == 'POST':
            base.update({'Content-Type': 'application/json', 'X-Chess-Studio': '1',
                         'Origin': f'http://127.0.0.1:{self.port}'})
        return base

    def refused_everywhere(self, change, status):
        """Every route, with `change` applied to the app's own headers, is refused with `status`."""
        unreachable = mock.Mock(side_effect=AssertionError('the gate let the request through'))
        with mock.patch.object(studio.ROUTES, 'match', unreachable):
            for method, path in every_route():
                with self.subTest(method=method, path=path):
                    headers = change(method, self.app_headers(method))
                    if headers is None:
                        continue
                    self.assertEqual(self.status(method, path, headers), status)
        unreachable.assert_not_called()

    def test_routes_only_use_methods_the_gate_covers(self):
        self.assertTrue(every_route())
        self.assertEqual({method for method, _ in every_route()}, {'GET', 'POST'})

    def test_a_rebound_domain_reaches_no_route(self):
        def rebound(method, headers):
            headers['Host'] = f'evil.example:{self.port}'
            if method == 'POST':
                headers['Origin'] = f'http://evil.example:{self.port}'  # same-origin after rebinding
            return headers
        self.refused_everywhere(rebound, 400)

    def test_a_rebound_domain_is_refused_behind_a_proxy_too(self):
        with mock.patch.object(studio, 'PROXIED', True):
            self.refused_everywhere(lambda m, h: {**h, 'Host': 'evil.example'}, 400)

    def test_an_allowed_proxy_domain_is_answered(self):
        with mock.patch.object(studio, 'ALLOWED_HOSTS', ['chess.example.com']), \
                mock.patch.object(studio, 'PROXIED', True):
            self.assertEqual(self.status('GET', '/api/nothing-here', {'Host': 'chess.example.com'}), 404)

    def test_a_post_from_another_origin_reaches_no_route(self):
        self.refused_everywhere(
            lambda m, h: {**h, 'Origin': 'http://evil.example'} if m == 'POST' else None, 403)

    def test_a_post_without_the_app_header_reaches_no_route(self):
        self.refused_everywhere(
            lambda m, h: {k: v for k, v in h.items() if k != 'X-Chess-Studio'} if m == 'POST' else None, 403)

    def test_a_form_post_reaches_no_route(self):
        self.refused_everywhere(
            lambda m, h: {**h, 'Content-Type': 'text/plain'} if m == 'POST' else None, 415)

    def test_the_app_itself_gets_through(self):
        empty = Routes()
        with mock.patch.object(studio, 'ROUTES', empty):
            self.assertEqual(self.status('POST', '/api/nothing-here', self.app_headers('POST'), b'{}'), 404)
            self.assertEqual(self.status('GET', '/api/nothing-here', self.app_headers('GET')), 404)

    def test_the_app_behind_https_gets_through(self):
        # A TLS proxy keeps the Host but the browser's Origin says https.
        headers = {**self.app_headers('POST'), 'Origin': f'https://127.0.0.1:{self.port}'}
        with mock.patch.object(studio, 'ROUTES', Routes()):
            self.assertEqual(self.status('POST', '/api/nothing-here', headers, b'{}'), 404)


class AdminTests(unittest.TestCase):
    def marked(self):
        table = studio.ROUTES
        found = {key for key, handler in table._exact.items() if access.of(handler) == access.ADMIN}
        return found | {(m, p.pattern) for m, p, handler in table._patterns if access.of(handler) == access.ADMIN}

    def test_admin_routes_are_the_reviewed_ones(self):
        self.assertEqual(self.marked(), ADMIN_ROUTES)

    def as_studio(self, **env):
        names = ('TORRE_HOSTED', access.ADMIN_ENV)
        clean = {k: v for k, v in os.environ.items() if k not in names}
        return mock.patch.dict(os.environ, {**clean, **env}, clear=True)

    def test_only_a_hosted_studio_without_an_admin_is_refused(self):
        handler = access.admin(mock.Mock(return_value={}))
        for env, allowed in (({}, True), ({'TORRE_HOSTED': '1'}, False),
                             ({'TORRE_HOSTED': '1', access.ADMIN_ENV: '1'}, True)):
            with self.subTest(env=env), self.as_studio(**env):
                if allowed:
                    access.check(handler)
                else:
                    self.assertRaises(access.Forbidden, access.check, handler)
                access.check(mock.Mock(spec=[]))  # an unmarked route is always the player's

    def test_a_hosted_player_gets_403_before_the_handler_runs(self):
        handler = mock.Mock(return_value={'ok': True})
        table = Routes()
        table.post('/api/machine')(access.admin(handler))
        server = ThreadingHTTPServer(('127.0.0.1', 0), studio.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        port = server.server_address[1]
        headers = {'Host': f'127.0.0.1:{port}', 'Content-Type': 'application/json', 'X-Chess-Studio': '1'}
        try:
            for env, status in (({'TORRE_HOSTED': '1'}, 403), ({'TORRE_HOSTED': '1', access.ADMIN_ENV: '1'}, 200)):
                with self.subTest(env=env), self.as_studio(**env), mock.patch.object(studio, 'ROUTES', table):
                    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
                    conn.request('POST', '/api/machine', body=b'{}', headers=headers)
                    self.assertEqual(conn.getresponse().status, status)
                    conn.close()
            handler.assert_called_once()
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
