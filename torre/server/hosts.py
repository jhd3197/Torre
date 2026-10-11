"""Which Host headers the studio answers, the guard against DNS rebinding.

A page on an attacker's domain that re-points that domain to 127.0.0.1 becomes same-origin
with the studio: its POSTs pass the Origin check and may set X-Chess-Studio, so it could read
the archive, replace the AI key or register any program on this machine as an engine. Its
requests still carry the attacker's name in Host, so the studio only answers names nobody can
register publicly: IP addresses, single labels, localhost and private suffixes (.local, .lan,
.home.arpa, .internal). Any other name, such as a proxy's domain, must be allowed with
--allow-host or TORRE_ALLOWED_HOSTS (comma separated; ".example.com" allows its subdomains).
"*" answers every name: for a server, where the rebinding page has nothing to gain over
requesting the server's own address, and its proxy decides which domains reach it.
"""
import ipaddress
import os

LOCAL_SUFFIXES = ('.localhost', '.local', '.lan', '.home.arpa', '.internal')
HOSTS_ENV = 'TORRE_ALLOWED_HOSTS'


def name(header):
    """The name in a Host header, without its port or IPv6 brackets."""
    header = header.strip().lower()
    if header.startswith('['):
        return header[1:header.find(']')] if ']' in header else header[1:]
    return header.rsplit(':', 1)[0] if header.count(':') == 1 else header


def from_env():
    return [h.strip() for h in os.environ.get(HOSTS_ENV, '').split(',') if h.strip()]


def allowed(header, extra=()):
    host = name(header).rstrip('.')
    if not host:
        return False
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    if '.' not in host or host.endswith(LOCAL_SUFFIXES):
        return True
    for entry in extra:
        entry = entry.strip().lower().rstrip('.')
        if entry == '*':
            return True
        if entry and (host == entry or (entry.startswith('.') and host.endswith(entry))):
            return True
    return False
