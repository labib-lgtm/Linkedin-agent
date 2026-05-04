"""Shared Unipile HTTP client.

Reads creds from .env (UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_LINKEDIN_ACCOUNT_ID).
All Unipile tools import `request()` from here so auth and base URL stay in one place.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


def _load_env() -> dict[str, str]:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    out: dict[str, str] = {}
    if not env_path.exists():
        return out
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


_ENV = _load_env()


def env(key: str) -> str:
    val = os.environ.get(key) or _ENV.get(key)
    if not val:
        sys.exit(f"Missing env var: {key}")
    return val


def base_url() -> str:
    dsn = env("UNIPILE_DSN")
    return f"https://{dsn}"


def request(
    method: str,
    path: str,
    params: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
    retries: int = 3,
) -> dict[str, Any]:
    url = base_url().rstrip("/") + path
    if params:
        clean = {k: v for k, v in params.items() if v is not None}
        if clean:
            url = url + "?" + urllib.parse.urlencode(clean)

    data = None
    headers = {
        "X-API-KEY": env("UNIPILE_API_KEY"),
        "accept": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["content-type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                if not raw:
                    return {}
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"Unipile {method} {path} -> {e.code}: {err_body}") from e
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise
    raise RuntimeError(f"Unipile request failed: {last_err}")


def get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    return request("GET", path, params=params)
