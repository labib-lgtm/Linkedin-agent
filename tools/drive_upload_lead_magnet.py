"""Upload a lead-magnet PDF to Google Drive, set permissive sharing, return URL.

The URL ends up on the angle's `lead_magnet_url` field in Supabase and is
what the engagement-loop DM at T+3h sends to the commenter.

Reuses the same OAuth user that's cached at ~/.config/gspread/ (from the
prior gspread setup) for the Drive scopes — gspread.oauth() requests both
Sheets and Drive scopes by default, so the token already has what Drive
needs. If the token lacks Drive scopes, delete it and re-run.

Drive layout:
  My Drive/
    lynx-lead-magnets/        <- folder name configurable via env LYNX_DRIVE_FOLDER
      A08-pre-pause-checklist.pdf
      A09-...

Run:
  python3 tools/drive_upload_lead_magnet.py --angle-id 2026-W18-A08
  python3 tools/drive_upload_lead_magnet.py --angle-id 2026-W18-A08 \\
      --pdf-path temp/outputs/assets/2026-W18-A08/lead_magnet.pdf
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FOLDER_NAME = "lynx-lead-magnets"


def _build_drive_service():
    """Build a Drive v3 client using the gspread-cached OAuth token."""
    try:
        import gspread
        from googleapiclient.discovery import build
    except ImportError:
        sys.exit(
            "Missing deps. Run: pip3 install --user -r tools/requirements.txt"
        )

    # gspread.oauth() returns a Client whose .auth is a Credentials object
    # with both Sheets and Drive scopes by default.
    from sheets_client import client as sheets_oauth_client
    sheets_client_obj = sheets_oauth_client()
    creds = getattr(sheets_client_obj, "auth", None) or getattr(sheets_client_obj, "session", None)
    # gspread v6 stores the underlying Credentials at sheets_client_obj.session.credentials
    if creds is None or not hasattr(creds, "token"):
        creds = getattr(sheets_client_obj.session, "credentials", None)
    if creds is None:
        sys.exit(
            "Could not locate OAuth credentials on the gspread client. "
            "Try deleting GOOGLE_OAUTH_TOKEN_PATH and re-running so the OAuth "
            "flow re-grants Drive scopes."
        )

    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _find_or_create_folder(svc, name: str) -> str:
    """Return the folder ID. Creates it under My Drive root if missing."""
    q = (
        f"mimeType='application/vnd.google-apps.folder' "
        f"and name='{name}' and trashed=false"
    )
    res = svc.files().list(q=q, fields="files(id, name)", spaces="drive").execute()
    items = res.get("files", [])
    if items:
        return items[0]["id"]
    folder = svc.files().create(
        body={"name": name, "mimeType": "application/vnd.google-apps.folder"},
        fields="id",
    ).execute()
    return folder["id"]


def _upload_pdf(svc, pdf_path: Path, folder_id: str, dest_name: str) -> dict:
    from googleapiclient.http import MediaFileUpload
    media = MediaFileUpload(
        str(pdf_path), mimetype="application/pdf", resumable=False,
    )
    file = svc.files().create(
        body={"name": dest_name, "parents": [folder_id]},
        media_body=media,
        fields="id, name, webViewLink",
    ).execute()
    return file


def _set_anyone_reader(svc, file_id: str) -> None:
    svc.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"},
        fields="id",
    ).execute()


def _writeback_url(angle_id: str, url: str) -> None:
    """Persist the Drive URL on the angle record via the canonical writer."""
    cmd = [
        sys.executable,
        str(PROJECT_ROOT / "tools" / "sheets_mark_lead_magnet_ready.py"),
        "--angle-id", angle_id,
        "--lead-magnet-url", url,
    ]
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(
            f"WARN: lead-magnet URL writeback failed (exit {e.returncode}). "
            f"Drive URL is: {url} — write it manually if needed.",
            file=sys.stderr,
        )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--pdf-path", default=None,
                    help="Default: temp/outputs/assets/<angle-id>/lead_magnet.pdf")
    ap.add_argument("--folder-name", default=os.environ.get("LYNX_DRIVE_FOLDER", DEFAULT_FOLDER_NAME))
    ap.add_argument(
        "--no-writeback",
        action="store_true",
        help="Don't write lead_magnet_url back to the angle record (just upload + print URL).",
    )
    # Legacy alias kept for any workflow doc still referencing it.
    ap.add_argument("--no-sheet-writeback", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args()

    pdf = Path(args.pdf_path) if args.pdf_path else (
        PROJECT_ROOT / "temp" / "outputs" / "assets" / args.angle_id / "lead_magnet.pdf"
    )
    if not pdf.exists():
        sys.exit(f"PDF not found: {pdf}")

    print(f"Uploading {pdf.name} to Drive folder '{args.folder_name}'...", file=sys.stderr)
    svc = _build_drive_service()
    folder_id = _find_or_create_folder(svc, args.folder_name)
    dest_name = f"{args.angle_id}-lead-magnet.pdf"
    file = _upload_pdf(svc, pdf, folder_id, dest_name)
    _set_anyone_reader(svc, file["id"])

    url = file["webViewLink"]
    print(f"  ✓ uploaded: {dest_name}", file=sys.stderr)
    print(f"  ✓ url: {url}", file=sys.stderr)

    if not (args.no_writeback or args.no_sheet_writeback):
        _writeback_url(args.angle_id, url)

    print(url)


if __name__ == "__main__":
    main()
