"""Write a structured poll.md for a `poll` format angle.

The agent supplies the question + options it wrote (per the rules in
05_visual_asset.md and the brand voice). This tool just enforces the file
structure: question first, 3-4 options, the comment-for-option-C engagement
prompt at the bottom. LinkedIn caps poll options at 4.

Run:
  python3 tools/gen_poll_options.py \
      --angle-id 2026-W18-A09 \
      --question "Which one wastes more spend on Amazon: bad keywords or bad creative?" \
      --option "Bad keywords" --option "Bad creative" \
      --option "Both equally — comment which" \
      --comment-prompt "Vote, then comment which one bit you hardest last quarter."

Or supply via files (recommended for anything with quotes / long copy):
  python3 tools/gen_poll_options.py \
      --angle-id 2026-W18-A09 \
      --question-file /tmp/q.txt \
      --options-file /tmp/opts.txt \
      --comment-prompt-file /tmp/cp.txt
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ASSETS_ROOT = PROJECT_ROOT / "temp" / "outputs" / "assets"


def _resolve_text(text: str | None, path: str | None, label: str) -> str:
    if text is not None and path is not None:
        sys.exit(f"Pass either --{label} or --{label}-file, not both.")
    if path:
        p = Path(path)
        if not p.exists():
            sys.exit(f"File not found: {p}")
        return p.read_text().strip()
    return (text or "").strip()


def _resolve_options(options: list[str] | None, path: str | None) -> list[str]:
    if options and path:
        sys.exit("Pass either --option (repeated) or --options-file, not both.")
    if path:
        p = Path(path)
        if not p.exists():
            sys.exit(f"File not found: {p}")
        return [ln.strip() for ln in p.read_text().splitlines() if ln.strip()]
    return [o.strip() for o in (options or []) if o.strip()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--question", default=None)
    ap.add_argument("--question-file", default=None)
    ap.add_argument("--option", action="append", default=None,
                    help="Repeatable. Use 3-4 options total.")
    ap.add_argument("--options-file", default=None,
                    help="One option per line. Use 3-4 options total.")
    ap.add_argument("--comment-prompt", default=None,
                    help="The 'comment for option C' style engagement prompt.")
    ap.add_argument("--comment-prompt-file", default=None)
    ap.add_argument("--out", default=None,
                    help="Output path (default: temp/outputs/assets/<angle_id>/poll.md)")
    args = ap.parse_args()

    question = _resolve_text(args.question, args.question_file, "question")
    options = _resolve_options(args.option, args.options_file)
    comment_prompt = _resolve_text(args.comment_prompt, args.comment_prompt_file, "comment-prompt")

    if not question:
        sys.exit("Missing question. Use --question or --question-file.")
    if len(options) < 3:
        sys.exit(f"Need at least 3 options (got {len(options)}). LinkedIn polls support 2-4.")
    if len(options) > 4:
        sys.exit(f"Too many options ({len(options)}). LinkedIn polls cap at 4.")
    if not comment_prompt:
        sys.exit("Missing comment-prompt. Use --comment-prompt or --comment-prompt-file.")

    out_path = Path(args.out) if args.out else (ASSETS_ROOT / args.angle_id / "poll.md")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    lines = [
        f"# Poll — {args.angle_id}",
        "",
        "## Question",
        question,
        "",
        "## Options",
    ]
    for i, opt in enumerate(options):
        lines.append(f"{i + 1}. {opt}")
    lines += [
        "",
        "## Comment prompt (post immediately as the first comment under the poll)",
        comment_prompt,
        "",
    ]

    out_path.write_text("\n".join(lines))
    print(f"OK — wrote poll to {out_path} ({len(options)} options)")


if __name__ == "__main__":
    main()
