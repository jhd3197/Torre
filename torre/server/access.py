"""Who may call a route.

Torre on its own has one player, who may do everything. Hosted, torre.sh runs one studio per
player (TORRE_HOSTED=1), each with its own data folder, so a player's games and progress are
theirs by construction. What players share is the machine: the engine binaries, the programs a
custom engine runs, the Python packages. Routes that change those are marked @admin and answer
403 unless the gateway started this studio for an admin (TORRE_ADMIN=1). The mark sits under the
route decorator:

    @ROUTES.post('/api/engines/install')
    @admin
    def install(req): ...

Every other route belongs to the player. tests/test_access.py keeps the reviewed list of admin
routes, so marking or unmarking one is a decision the test makes you write down.
"""
import os

from torre.coaching import coach_ai
from torre.server.routes import ApiError

ADMIN_ENV = 'TORRE_ADMIN'
ADMIN, PLAYER = 'admin', 'player'


class Forbidden(ApiError):
    status = 403


def admin(handler):
    """Mark a route as changing what every player on this machine shares."""
    handler.access = ADMIN
    return handler


def of(handler):
    return getattr(handler, 'access', PLAYER)


def is_admin():
    return not coach_ai.hosted() or os.environ.get(ADMIN_ENV) == '1'


def check(handler):
    """Raise Forbidden when this studio's player may not call `handler`."""
    if of(handler) == ADMIN and not is_admin():
        raise Forbidden('Only an admin can change what is installed on this server.')
