"""Opening web addresses: http and https only.

urllib's urlopen also reads file:// and other schemes, so an address that comes from a setting,
a catalog or the environment (an engine download, OLLAMA_HOST, KOKORO_URL) could read a local file.
Every request Torre makes goes through here instead.
"""
import urllib.request
from urllib.parse import urlparse

SCHEMES = ('http', 'https')


def urlopen(url, timeout=60):
    """urllib.request.urlopen for an http(s) address or Request; ValueError for any other scheme."""
    target = url.full_url if isinstance(url, urllib.request.Request) else str(url)
    if urlparse(target).scheme not in SCHEMES:
        raise ValueError(f'Only http and https addresses can be opened, not {target!r}.')
    return urllib.request.urlopen(url, timeout=timeout)  # nosec B310 - the scheme is checked above
