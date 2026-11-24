#!/usr/bin/env python3
"""Generate the external skill reference from the Product Layer and Application Composition Standard."""

import argparse
import re
from pathlib import Path


TARGET = (
    Path(__file__).resolve().parents[1]
    / "agent-skills/ontomato-app-builder/references/app-standard/references/standard.md"
)

TITLE = "# Ontomato 产品层与应用组装标准\n\n"


def render_standard(text):
    start = text.index("## 一、原则")
    body = text[start:]
    if "\n## 来历\n" in body:
        body = body[: body.index("\n## 来历\n")]

    # Remove internal-only cross-references to implementation rules/detail annexes and internal URLs.
    body = re.sub(r"（(?:已定的例外见)?细则[^）]*）", "", body)
    body = body.replace("每条的细节见《细则》对应的节。", "")
    body = body.replace("由哪个入口检查、识别哪些写法见细则九。", "")
    body = body.replace("声明的结构见细则一。", "")
    body = body.replace("按细则七办理；", "遵循平台自带面板规则；")
    body = body.replace("，以《[智能体应用范式](智能体应用范式.md)》为准。", "，由平台按本轮会话与权限规则判定。")
    body = re.sub(r"\[([^\]]+)\]\(https?://infohub\.eloyzh\.de/[^)]+\)", r"\1", body)
    body = re.sub(r"\[([^\]]+)\]\(https?://git\.uino\.com/[^)]+\)", r"\1", body)
    body = re.sub(r"\[([^\]]+)\]\((?!https?://)[^)]+\)", r"\1", body)
    body = re.sub(r"\n{3,}", "\n\n", body)
    return TITLE + body.rstrip() + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Path to the standard Markdown file")
    source = parser.parse_args().source
    TARGET.write_text(render_standard(source.read_text(encoding="utf-8")), encoding="utf-8")


if __name__ == "__main__":
    main()
