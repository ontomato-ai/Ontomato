#!/usr/bin/env python3
"""Prepare new runtime credentials for both fresh installs and upgrades; preserve existing secrets."""
import argparse
import os
from pathlib import Path
import re
import secrets

KEY = "AGENT_RUNTIME_SERVICE_TOKEN"


def prepare(path):
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    matches = list(re.finditer(r"^" + KEY + r"=(.*)$", text, re.MULTILINE))
    if len(matches) > 1:
        raise ValueError("Duplicate " + KEY)
    value = matches[0][1].strip().strip("\"'") if matches else ""
    if value:
        # Compose embeds this value in JSON; reject ambiguous shell/JSON characters.
        if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            raise ValueError(KEY + " must contain only URL-safe characters")
        path.chmod(0o600)
        return
    line = KEY + "=" + secrets.token_urlsafe(32)
    updated = text[:matches[0].start()] + line + text[matches[0].end():] if matches else text.rstrip("\n") + "\n" + line + "\n"
    temporary = path.with_name(path.name + ".runtime.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(updated)
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("env_file", nargs="?", default=".env")
    args = parser.parse_args()
    try:
        prepare(args.env_file)
    except (OSError, ValueError) as error:
        parser.exit(1, "prepare-env: " + str(error) + "\n")
