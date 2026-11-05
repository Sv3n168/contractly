"""Optional Cloudflare Access check: only requests with a valid Access JWT get through."""

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app import access_jwt
from app.access_jwt import AccessVerifier, is_exempt

TEAM = "example-team.cloudflareaccess.com"  # made up; real values only come from the environment
AUD = "test-aud-tag"


def _key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _jwk(private, kid):
    data = jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key(), as_dict=True)
    return {**data, "kid": kid, "alg": "RS256", "use": "sig"}


def _token(private, kid="k1", **claims):
    now = int(time.time())
    payload = {"iss": f"https://{TEAM}", "aud": [AUD], "iat": now, "nbf": now, "exp": now + 600, **claims}
    return jwt.encode(payload, private, algorithm="RS256", headers={"kid": kid})


class Certs:
    """Stands in for https://<team>/cdn-cgi/access/certs."""

    def __init__(self, *jwks):
        self.jwks = list(jwks)
        self.calls = []

    def __call__(self, url):
        self.calls.append(url)
        if self.jwks is None:
            raise OSError("unreachable")
        return {"keys": self.jwks}


@pytest.fixture()
def key():
    return _key()


def test_valid_token_passes(key):
    certs = Certs(_jwk(key, "k1"))
    v = AccessVerifier(f"https://{TEAM}/", [AUD], fetch=certs)
    assert v.verify(_token(key))
    assert certs.calls == [f"https://{TEAM}/cdn-cgi/access/certs"]
    assert v.verify(_token(key))  # keys are cached
    assert len(certs.calls) == 1


@pytest.mark.parametrize(
    "claims",
    [
        {"aud": ["other-app"]},
        {"iss": "https://other-team.cloudflareaccess.com"},
        {"exp": int(time.time()) - 3600},
        {"nbf": int(time.time()) + 3600},
    ],
)
def test_wrong_claims_are_rejected(key, claims):
    v = AccessVerifier(TEAM, [AUD], fetch=Certs(_jwk(key, "k1")))
    assert not v.verify(_token(key, **claims))


def test_missing_garbage_and_forged_tokens_are_rejected(key):
    v = AccessVerifier(TEAM, [AUD], fetch=Certs(_jwk(key, "k1")))
    assert not v.verify(None)
    assert not v.verify("")
    assert not v.verify("not.a.jwt")
    assert not v.verify(_token(_key(), kid="k1"))  # signed with another key under a known id
    assert not v.verify(
        jwt.encode({"aud": AUD}, "a-forged-hmac-secret-of-32-bytes!", algorithm="HS256", headers={"kid": "k1"})
    )


def test_rotated_key_is_loaded(key, monkeypatch):
    new = _key()
    certs = Certs(_jwk(key, "k1"))
    v = AccessVerifier(TEAM, [AUD], fetch=certs)
    assert v.verify(_token(key))
    certs.jwks = [_jwk(key, "k1"), _jwk(new, "k2")]
    # an unknown key id right after loading waits (no reload storm) …
    assert not v.verify(_token(new, kid="k2"))
    # … and is fetched once the pause is over
    later = time.monotonic() + access_jwt.UNKNOWN_KID_PAUSE + 1
    monkeypatch.setattr(access_jwt.time, "monotonic", lambda: later)
    assert v.verify(_token(new, kid="k2"))
    assert len(certs.calls) == 2


def test_unreachable_certs_deny_without_raising(key):
    certs = Certs()
    certs.jwks = None
    v = AccessVerifier(TEAM, [AUD], fetch=certs)
    assert not v.verify(_token(key))


def test_missing_config_stops_the_start():
    with pytest.raises(ValueError):
        AccessVerifier("", [AUD])
    with pytest.raises(ValueError):
        AccessVerifier(TEAM, [])


def test_exempt_paths():
    exempt = ["/healthz", "/api/calendar/", "/api/ha/*"]
    assert is_exempt("/healthz", exempt)
    assert not is_exempt("/healthz/x", exempt)
    assert is_exempt("/api/calendar/abc.ics", exempt)
    assert is_exempt("/api/ha/summary", exempt)
    assert not is_exempt("/api/contracts", exempt)


@pytest.fixture()
def guarded(app_env, monkeypatch, key):
    from app.config import settings
    from app.main import create_app

    monkeypatch.setattr(settings, "access_required", True)
    monkeypatch.setattr(settings, "access_team_domain", TEAM)
    monkeypatch.setattr(settings, "access_aud", [AUD])
    monkeypatch.setattr(settings, "access_exempt", ["/healthz"])
    monkeypatch.setattr(access_jwt, "_fetch_json", Certs(_jwk(key, "k1")))
    with TestClient(create_app(background=False), client=("127.0.0.1", 50000)) as c:
        yield c


def test_requests_without_access_get_403(guarded, key):
    for path in ("/", "/api/auth/status", "/static/css/app.css", "/sw.js"):
        r = guarded.get(path)
        assert r.status_code == 403, path
        assert r.json() == {"detail": "Zugriff verweigert"}
    # the health check stays reachable for the container
    assert guarded.get("/healthz").status_code == 200
    # a valid token from Access: the app answers as usual (its own login still required)
    headers = {"Cf-Access-Jwt-Assertion": _token(key)}
    assert guarded.get("/api/auth/status", headers=headers).json()["authenticated"] is False
    assert guarded.get("/api/meta", headers=headers).status_code == 401
    assert (
        guarded.get("/api/auth/status", headers={"Cf-Access-Jwt-Assertion": _token(key, aud=["x"])}).status_code == 403
    )


def test_off_by_default(anon_client):
    from app.config import settings

    assert settings.access_required is False
    assert anon_client.get("/api/auth/status").status_code == 200
