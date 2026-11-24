#!/usr/bin/env python3
"""Prepare new runtime credentials for both fresh installs and upgrades; preserve existing secrets."""
import argparse
import os
from pathlib import Path
import re
import secrets

KEYS = ("AGENT_RUNTIME_SERVICE_TOKEN", "AGENT_RUNTIME_ONTOLOGY_TOKEN", "ONTOMATO_QUERY_SERVICE_TOKEN", "ONTOMATO_QUERY_SIGNING_KEY")


def prepare(path):
    path = Path(path)
    text = path.read_text(encoding="utf-8")
    updated = text
    for key in KEYS:
        matches = list(re.finditer(r"^" + key + r"=(.*)$", updated, re.MULTILINE))
        if len(matches) > 1:
            raise ValueError("Duplicate " + key)
        value = matches[0][1].strip().strip("\"'") if matches else ""
        if value:
            if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
                raise ValueError(key + " must contain only URL-safe characters")
            continue
        line = key + "=" + secrets.token_urlsafe(32)
        updated = updated[:matches[0].start()] + line + updated[matches[0].end():] if matches else updated.rstrip("\n") + "\n" + line + "\n"
    if updated == text:
        path.chmod(0o600)
        return
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
