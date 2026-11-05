"""Optional: only accept requests that came through Cloudflare Access (defense in depth).

Cloudflare Access adds the header ``Cf-Access-Jwt-Assertion`` to every request it lets through: a
JWT signed with the team's keys (``https://<team domain>/cdn-cgi/access/certs``). With the check on,
requests without a valid token – e.g. straight to the container from the LAN – get a 403.

Team domain and audience (the Access application's AUD tag) come only from the environment; the
check is off unless ``CONTRACTLY_ACCESS_REQUIRED`` is set. The app's own login stays required
either way.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
from collections.abc import Callable

import jwt

log = logging.getLogger("contractly.access")

HEADER = "cf-access-jwt-assertion"
REFRESH_SECONDS = 3600  # reload the keys at least hourly
UNKNOWN_KID_PAUSE = 60  # an unknown key id triggers a reload (rotation), at most once a minute
LEEWAY_SECONDS = 30  # clock skew between Cloudflare and this server


def _fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=5) as res:  # noqa: S310 (https URL from the config)
        return json.load(res)


class AccessVerifier:
    def __init__(
        self,
        team_domain: str,
        audiences: list[str],
        fetch: Callable[[str], dict] | None = None,
    ) -> None:
        domain = team_domain.strip().removeprefix("https://").removeprefix("http://").rstrip("/")
        if not domain or not audiences:
            raise ValueError(
                "CONTRACTLY_ACCESS_REQUIRED ist gesetzt, aber CONTRACTLY_ACCESS_TEAM_DOMAIN "
                "oder CONTRACTLY_ACCESS_AUD fehlt"
            )
        self.issuer = f"https://{domain}"
        self.certs_url = f"{self.issuer}/cdn-cgi/access/certs"
        self.audiences = audiences
        self._fetch = fetch or _fetch_json
        self._keys: dict[str, object] = {}
        self._loaded_at = 0.0
        self._lock = threading.Lock()

    def _load_keys(self) -> None:
        data = self._fetch(self.certs_url)
        keys = {}
        for entry in data.get("keys", []):
            try:
                keys[entry["kid"]] = jwt.PyJWK(entry).key
            except (KeyError, jwt.PyJWKError):
                continue
        self._keys = keys
        self._loaded_at = time.monotonic()

    def _key(self, kid: str):
        with self._lock:
            age = time.monotonic() - self._loaded_at
            stale = not self._keys or age > REFRESH_SECONDS
            rotated = kid not in self._keys and age > UNKNOWN_KID_PAUSE
            if stale or rotated:
                try:
                    self._load_keys()
                except Exception:  # keep the old keys while the certs endpoint is unreachable
                    log.warning("could not load the Cloudflare Access keys", exc_info=True)
            return self._keys.get(kid)

    def verify(self, token: str | None) -> bool:
        """True for a valid token of this team and application; never raises."""
        if not token:
            return False
        try:
            kid = jwt.get_unverified_header(token).get("kid")
            key = self._key(kid) if kid else None
            if key is None:
                log.info("access denied: unknown signing key")
                return False
            jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                audience=self.audiences,
                issuer=self.issuer,
                leeway=LEEWAY_SECONDS,
                options={"require": ["exp", "iss", "aud"]},
            )
            return True
        except jwt.PyJWTError as exc:
            log.info("access denied: %s", type(exc).__name__)
            return False


def is_exempt(path: str, exempt: list[str]) -> bool:
    """Exact paths, or prefixes for entries ending in "/" or "*"."""
    for entry in exempt:
        if entry.endswith("*"):
            if path.startswith(entry[:-1]):
                return True
        elif entry.endswith("/"):
            if path.startswith(entry):
                return True
        elif path == entry:
            return True
    return False
