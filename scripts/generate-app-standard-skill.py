#!/usr/bin/env python3
"""Generate the external skill reference from InfoHub standard-66842053."""

import argparse
import re
from pathlib import Path


TARGET = (
    Path(__file__).resolve().parents[1]
    / "agent-skills/ontomato-app-builder/references/app-standard/references/standard.md"
)

INTRO = ("# Ontomato 产品层与应用组装标准（第二版，2026-11-20）\n\n"
        "本标准规定产品层的五类对象各是什么、怎样一层层组成、怎样发布成应用，以及贯穿各类的规则。"
        "这是平台的标准：已有系统按它来改，不承诺外部自定义格式原样兼容。\n\n"
        "文中说的“本体”分事实、能力、治理、产品四层：事实是类、对象和关系；能力是指标、函数、动作、流程；治理是权限和规则；产品就是本标准讲的这五类对象。\n\n")
STATUS = ("## 六、平台现在做到哪了（2026-11-20）\n\n"
        "标准是目标，平台正在分批实现。下表说的是“现在照着写，能不能在平台上跑起来”。\n\n"
        "| 标准里的 | 现在 |\n| --- | --- |\n"
        "| 不带代码的面板直接渲染 | 已在测试环境跑通第一张（定时任务），正在过性能验收；对客户本体里的类、指标、动作的取数还在做 |\n"
        "| 带代码的面板在隔离框里运行 | 可用 |\n"
        "| 面板放进面板、对列表重复、位置由状态决定 | 在做 |\n"
        "| 状态按人保存、对外；入口给面板传值；外框面板 | 在做 |\n"
        "| 检查命令、登记命令和配套的构建技能 | 随平台底座的第一阶段一起给 |\n"
        "| 第三方组件包、应用主题、代码批准 | 第二阶段 |\n"
        "| 一张面板一个技能 | 在做 |\n\n"
        "所以现在能做的是照标准把应用拆清楚、把业务逻辑归到能力层、把要自己做的界面部件列出来；写面板和登记等后续版本的技能。\n")


def render_standard(text):
    start = text.index("## 一、总的结构")
    end = text.index("## 六、和现在的实现差在哪")
    body = text[start:end]

    # These sentences refer to internal decisions without explaining them to external readers.
    body = body.replace("这几条的细则以[平台长连接收敛设计](../工作/附属资料/平台长连接收敛设计.md)为准。", "")
    body = re.sub(r"已定的例外仍然有效（[^）]*），见[^\n]*\n", "\n", body)
    body = re.sub(r"细则见\[第一版\][^\n]*\n", "\n", body)
    body = re.sub(r"\[([^\]]+)\]\((?!https?://)[^)]+\)", r"\1", body)
    body = re.sub(r"\[([^\]]+)\]\(https?://infohub\.eloyzh\.de/[^)]+\)", r"\1", body)
    return INTRO + body.rstrip("\n") + "\n\n" + STATUS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Path to the InfoHub standard Markdown file")
    source = parser.parse_args().source
    TARGET.write_text(render_standard(source.read_text(encoding="utf-8")), encoding="utf-8")


if __name__ == "__main__":
    main()
