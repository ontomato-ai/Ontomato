#!/usr/bin/env python3
"""Generate the external skill reference from InfoHub standard-66842053."""

import argparse
import re
from pathlib import Path


TARGET = (
    Path(__file__).resolve().parents[1]
    / "agent-skills/ontomato-app-builder/references/app-standard/references/standard.md"
)

TITLE = "# Ontomato 产品层与应用组装标准\n\n"


def render_standard(text):
    start = text.index("## 这套标准的原则")
    body = text[start:]

    # These sentences refer to internal decisions without explaining them to external readers.
    body = body.replace("这几条的细则以[平台长连接收敛设计](../工作/附属资料/平台长连接收敛设计.md)为准。", "")
    body = re.sub(r"已定的例外仍然有效（[^）]*），见[^\n]*\n", "\n", body)
    body = re.sub(r"细则见\[第一版\][^\n]*\n", "\n", body)
    body = re.sub(r"\[([^\]]+)\]\((?!https?://)[^)]+\)", r"\1", body)
    body = re.sub(r"\[([^\]]+)\]\(https?://infohub\.eloyzh\.de/[^)]+\)", r"\1", body)
    return TITLE + body.rstrip() + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Path to the InfoHub standard Markdown file")
    source = parser.parse_args().source
    TARGET.write_text(render_standard(source.read_text(encoding="utf-8")), encoding="utf-8")


if __name__ == "__main__":
    main()
