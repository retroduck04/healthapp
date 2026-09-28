"""Janos Health: one-time Garmin login from your own computer.

Garmin blocks password logins coming from GitHub's servers. This logs in once from your own
internet connection and copies the resulting login tokens to the clipboard. Save them on GitHub as
the secret GARMIN_TOKENS; the sync then uses (and keeps refreshing) the tokens instead of your password.
Nothing is written to this folder, so the tokens can't end up in the public repo by accident.
"""

from __future__ import annotations

import base64
import getpass
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> None:
    try:
        from garminconnect import Garmin
    except ImportError:
        sys.exit("The Garmin library isn't installed. Run: python -m pip install garminconnect")

    print("Janos Health: connect Garmin (one time)\n")
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password (hidden while you type): ")

    home = Path(tempfile.mkdtemp())
    folder = home / ".garminconnect"
    try:
        api = Garmin(email, password, prompt_mfa=lambda: input("Garmin sent you a code. Type it here: ").strip())
    except TypeError:  # older library without two-step support
        api = Garmin(email, password)
    print("\nLogging in...")
    try:
        api.login(str(folder))
    except Exception as e:  # noqa: BLE001
        shutil.rmtree(home, ignore_errors=True)
        sys.exit(f"\nLogin failed: {type(e).__name__}: {e}\nCheck the email and password and try again.")
    for holder in ("client", "garth"):  # make sure the tokens are on disk (0.3.x: client, older: garth)
        dump = getattr(getattr(api, holder, None), "dump", None)
        if callable(dump):
            try:
                dump(str(folder))
                break
            except Exception:  # noqa: BLE001
                pass

    try:
        name = api.get_full_name()
    except Exception:  # noqa: BLE001
        name = None

    files = {
        (".garminconnect/" + f.relative_to(folder).as_posix()): base64.b64encode(f.read_bytes()).decode()
        for f in folder.rglob("*")
        if f.is_file()
    }
    shutil.rmtree(home, ignore_errors=True)
    if not files:
        sys.exit("Logged in, but the library saved no tokens. Send Claude a screenshot of this window.")
    blob = base64.b64encode(json.dumps(files).encode()).decode()

    print(f"\nLogged in{f' as {name}' if name else ''}.")
    try:
        subprocess.run(["clip"], input=blob.encode("ascii"), check=True)
        print("\nThe Garmin tokens are now COPIED to your clipboard.")
    except Exception:  # noqa: BLE001  (clip only exists on Windows)
        print("\nCopy everything between the lines:\n" + "-" * 60 + f"\n{blob}\n" + "-" * 60)
    print(
        "\nNext:\n"
        "  1. Open github.com/retroduck04/healthapp/settings/secrets/actions/new\n"
        "  2. Name: GARMIN_TOKENS\n"
        "  3. Secret: press Ctrl+V\n"
        "  4. Click 'Add secret'\n"
    )


if __name__ == "__main__":
    main()
