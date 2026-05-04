"""Render a single image via OpenRouter from a prompt file.

Wraps openrouter_client.generate_image. Reads the AI prompt that the
linkedin-image-asset skill produced, calls OpenRouter's chat-completions
endpoint with image modality, saves the PNG. Model is picked up from .env
(OPENROUTER_IMAGE_MODEL, defaults to openai/gpt-5-image-mini).

The prompt file may contain the full skill output (PROMPT / NEGATIVE PROMPT /
POST-PROCESS / WATCH OUT blocks). We pull the PROMPT and NEGATIVE PROMPT
blocks and inline them into one chat-completion call (OpenRouter has no
separate negative-prompt field). POST-PROCESS notes are for the human
reviewer; they do not get sent to the model.

Run:
  python3 tools/gen_image_render.py \
      --prompt-file temp/outputs/assets/2026-W18-A09/prompt.md \
      --out temp/outputs/assets/2026-W18-A09/image.png
  python3 tools/gen_image_render.py --prompt-file <path> --out <path> --dry-run
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from openrouter_client import generate_image


def _extract_blocks(raw: str) -> tuple[str, str]:
    """Pull the PROMPT and NEGATIVE PROMPT blocks out of the skill output.

    The linkedin-image-asset skill writes:
        PROMPT
          <description>
          ...
        NEGATIVE PROMPT
          <list of things to avoid>
        POST-PROCESS
          <human-only notes>
        WATCH OUT: <one line>

    We grab everything between PROMPT and NEGATIVE PROMPT as the positive,
    and everything between NEGATIVE PROMPT and POST-PROCESS (or WATCH OUT, or
    EOF) as the negative.

    If those headers aren't present, treat the whole file as the positive
    prompt (lets the agent pass a plain prompt directly).
    """
    text = raw.strip()
    if "PROMPT" not in text:
        return text, ""

    def grab(start: str, ends: list[str]) -> str:
        m = re.search(rf"^\s*{re.escape(start)}\s*$", text, re.M)
        if not m:
            return ""
        s = m.end()
        end_idx = len(text)
        for e in ends:
            em = re.search(rf"^\s*{re.escape(e)}", text[s:], re.M)
            if em and (s + em.start()) < end_idx:
                end_idx = s + em.start()
        return text[s:end_idx].strip()

    positive = grab("PROMPT", ["NEGATIVE PROMPT", "POST-PROCESS", "WATCH OUT"])
    negative = grab("NEGATIVE PROMPT", ["POST-PROCESS", "WATCH OUT"])
    return positive, negative


def _compose(positive: str, negative: str) -> str:
    """Combine the positive + negative blocks into one prompt.

    OpenRouter's chat-completion image route doesn't support a separate
    negative-prompt field (unlike Stable Diffusion / Midjourney), so we
    inline the negatives as explicit "do not include" instructions.

    The render must be publish-ready (text and all elements included), so
    the renderer no longer injects an "overlay text after generation" hint.
    Project rule: no logos on any rendered asset.
    """
    out = positive.strip()
    if negative.strip():
        neg = " ".join(line.strip(" -*") for line in negative.splitlines() if line.strip())
        out = f"{out}\n\nDo NOT include any of the following: {neg}. No logos."
    else:
        out = f"{out}\n\nNo logos."
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt-file", required=True,
                    help="Path to the skill-generated prompt.md (or any text file)")
    ap.add_argument("--out", required=True, help="Output PNG path")
    ap.add_argument("--size", default=None,
                    help="Image dimensions, WxH (e.g. 1024x1536, 1024x1024). "
                         "Forwarded to the model via OpenRouter's request body. "
                         "If omitted, the model picks (typically square).")
    ap.add_argument("--quality", default=None,
                    help="Reserved for caller compat — not currently sent.")
    ap.add_argument("--model", default=None,
                    help="Override OPENROUTER_IMAGE_MODEL")
    ap.add_argument("--dry-run", action="store_true",
                    help="Print the composed prompt and exit, no API call.")
    args = ap.parse_args()

    prompt_path = Path(args.prompt_file)
    if not prompt_path.exists():
        sys.exit(f"Prompt file not found: {prompt_path}")

    raw = prompt_path.read_text()
    positive, negative = _extract_blocks(raw)
    if not positive.strip():
        sys.exit(f"Couldn't extract a prompt from {prompt_path}. "
                 f"Expected a PROMPT block or plain prompt text.")

    composed = _compose(positive, negative)

    if args.dry_run:
        print("=== COMPOSED PROMPT ===")
        print(composed)
        print(f"\n=== {len(composed)} chars ===")
        return

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Rendering image -> {out_path} ...", file=sys.stderr)
    png_bytes = generate_image(
        prompt=composed,
        size=args.size,
        quality=args.quality,
        model=args.model,
    )
    out_path.write_bytes(png_bytes)
    print(f"OK — wrote {len(png_bytes):,} bytes to {out_path}")


if __name__ == "__main__":
    main()
