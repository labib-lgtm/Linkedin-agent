"""Shared OpenRouter client for image generation.

Routes through OpenRouter's chat-completions endpoint with image modality —
this is OpenRouter's standard pattern for image-output models (gpt-image
family, Gemini 2.5 Flash Image, etc.). The response carries the PNG as a
base64 data URI on `choices[0].message.images[0].image_url.url`.

Reads creds from .env (OPENROUTER_API_KEY, OPENROUTER_IMAGE_MODEL).
Stdlib-only HTTP, structured errors, exponential backoff on transients.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_MODEL = "openai/gpt-5-image-mini"
ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"


def _load_env() -> dict[str, str]:
    env_path = PROJECT_ROOT / ".env"
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


def env(key: str, default: str | None = None) -> str:
    val = os.environ.get(key) or _ENV.get(key) or default
    if val is None:
        sys.exit(
            f"Missing env var: {key}\n"
            f"Set it in .env. For OPENROUTER_API_KEY, get one at "
            f"https://openrouter.ai/keys"
        )
    return val


def _decode_data_uri(uri: str) -> bytes:
    m = re.match(r"^data:image/[^;]+;base64,(.+)$", uri)
    if not m:
        raise RuntimeError(f"Unexpected image_url format: {uri[:60]}...")
    return base64.b64decode(m.group(1))


def _fetch_url(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def _extract_image_bytes(payload: dict) -> bytes:
    """Pull image bytes out of an OpenRouter chat-completion response.

    Tries the documented OpenRouter shape first, then a couple of fallback
    shapes seen in the wild (Anthropic-style content blocks, OpenAI image
    URL). Raises a clear error if no image is present so the caller can
    surface it cleanly.
    """
    choices = payload.get("choices") or []
    if not choices:
        raise RuntimeError(f"No choices in response: keys={list(payload.keys())}")
    msg = choices[0].get("message") or {}

    # Documented OpenRouter shape: message.images = [{type, image_url:{url}}]
    images = msg.get("images") or []
    if images:
        first = images[0]
        url = (first.get("image_url") or {}).get("url") or first.get("url")
        if not url:
            raise RuntimeError(f"image entry missing url: {first}")
        return _decode_data_uri(url) if url.startswith("data:") else _fetch_url(url)

    # Fallback A: Anthropic-style content blocks (in case OpenRouter routes
    # this model through the messages API shape internally).
    content = msg.get("content")
    if isinstance(content, list):
        for blk in content:
            t = blk.get("type")
            if t == "image_url":
                url = (blk.get("image_url") or {}).get("url")
                if url:
                    return _decode_data_uri(url) if url.startswith("data:") else _fetch_url(url)
            if t == "image":
                src = blk.get("source") or {}
                if src.get("type") == "base64" and src.get("data"):
                    return base64.b64decode(src["data"])
                if src.get("type") == "url" and src.get("url"):
                    return _fetch_url(src["url"])

    # Fallback B: text content with an embedded URL or data URI.
    if isinstance(content, str) and content:
        m = re.search(r"(data:image/[^;]+;base64,[A-Za-z0-9+/=]+)", content)
        if m:
            return _decode_data_uri(m.group(1))
        m = re.search(r"https?://\S+\.(?:png|jpg|jpeg|webp)", content)
        if m:
            return _fetch_url(m.group(0))

    raise RuntimeError(
        f"No image content in response. message keys = {list(msg.keys())}. "
        f"Confirm the model supports image output; first 200 chars of content: "
        f"{str(content)[:200]!r}"
    )


def generate_image(
    prompt: str,
    size: str | None = None,
    quality: str | None = None,     # accepted for caller compat; not sent
    model: str | None = None,
    retries: int = 3,
) -> bytes:
    """Generate an image via OpenRouter and return raw PNG bytes.

    `size` is forwarded as a top-level request-body field. OpenRouter passes
    unknown params through to the underlying model in most cases; for the
    OpenAI image family this maps to the model's native `size` argument
    (e.g. 1024x1024, 1024x1536, 1536x1024). The prompt should also encode
    the aspect as a hint, since not all routes honor the param.

    `quality` is accepted for interface parity but not sent.
    """
    body: dict = {
        "model": model or env("OPENROUTER_IMAGE_MODEL", DEFAULT_MODEL),
        "modalities": ["image", "text"],
        "messages": [{"role": "user", "content": prompt}],
    }
    if size:
        body["size"] = size
    data = json.dumps(body).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {env('OPENROUTER_API_KEY')}",
        "Content-Type": "application/json",
        # OpenRouter recommends a referer + title for routing/analytics.
        "HTTP-Referer": env("OPENROUTER_HTTP_REFERER", "https://lynxmedia.co"),
        "X-Title": env("OPENROUTER_APP_TITLE", "LinkedIn Agent"),
    }
    req = urllib.request.Request(ENDPOINT, data=data, headers=headers, method="POST")

    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
                return _extract_image_bytes(payload)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(
                f"OpenRouter image generation failed: {e.code}\n{err_body}"
            ) from e
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise
    raise RuntimeError(f"OpenRouter image generation failed after retries: {last_err}")
