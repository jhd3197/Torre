"""Torre opens http and https addresses only (torre/net.py)."""
import unittest
import urllib.request
from unittest import mock

from torre import net


class NetTests(unittest.TestCase):
    def test_other_schemes_are_refused_before_anything_is_opened(self):
        with mock.patch.object(urllib.request, 'urlopen') as opened:
            for url in ('file:///etc/passwd', 'ftp://example.com/x', 'C:/Windows/win.ini',
                        urllib.request.Request('file:///etc/passwd')):
                with self.assertRaises(ValueError):
                    net.urlopen(url)
            opened.assert_not_called()

    def test_http_and_https_go_through(self):
        with mock.patch.object(urllib.request, 'urlopen', return_value='response') as opened:
            self.assertEqual(net.urlopen('https://lichess.org/api', timeout=5), 'response')
            request = urllib.request.Request('http://127.0.0.1:11434/api/tags')
            net.urlopen(request, timeout=1.5)
        self.assertEqual(opened.call_args_list[1].args[0], request)


if __name__ == '__main__':
    unittest.main()
