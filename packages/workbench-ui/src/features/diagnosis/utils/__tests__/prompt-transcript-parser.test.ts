import { describe, expect, it } from "vitest";
import { parsePromptTranscript as parseWithFormat, type PromptTranscriptItem, type PromptTranscriptRound } from "../prompt-transcript-parser";
const format = { promptMarkers: { systemPrompt: "System", userPrompt: "User", reasoning: "Reasoning", llmOutput: "Output", toolCall: "Call", toolReturn: "Return", message: "Message" }, roundTitlePattern: /^##\s+Round\s+\d+$/ };
const parsePromptTranscript = (text: string) => parseWithFormat(text, format);
function section(type: string, content: string, meta = ""): string {
  const suffix = meta ? ` ${meta}` : "";
  return [
    `-----${type}${suffix} BEGIN-----`,
    "",
    content,
    "",
    `-----${type}${suffix} END-----`,
  ].join("\n");
}
function groupItems(
  round: PromptTranscriptRound,
  kind: "context" | "assistant"
): PromptTranscriptItem[] {
  return round.groups.find((group) => group.kind === kind)?.items ?? [];
}
describe("prompt transcript structure", () => {
  it("groups one assistant response and pairs multiple tools by id", () => {
    const markdown = [
      "# 2.1 ABCHarness程序员 - #1",
      "",
      "- Agent Run: run-1",
      "",
      "## Round 1",
      "",
      "status=success | model=deepseek",
      "",
      section("System", "系统规则"),
      section("User", "用户问题"),
      section("Reasoning", "先分析"),
      section("Output", "我先调用工具"),
      section(
        "Call",
        '```json\n{\n  "code": "line 1\\nline 2"\n}\n```',
        "name=query id=call-1"
      ),
      section("Return", '{"status":"Success"}', "name=query id=call-1"),
      section("Call", '```json\n{"value":2}\n```', "name=query id=call-2"),
      section("Return", '{"status":"Success"}', "name=query id=call-2"),
      "Finish Reason: tool_calls",
      "---",
    ].join("\n");

    const result = parsePromptTranscript(markdown);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const round = result.transcript.rounds[0];
    expect(groupItems(round, "context").map((item) => item.kind)).toEqual(["section", "section"]);
    const assistantItems = groupItems(round, "assistant");
    expect(assistantItems.map((item) => item.kind)).toEqual(["section", "section", "tool", "tool"]);
    const tools = assistantItems.filter((item) => item.kind === "tool");
    expect(tools[0].matchStatus).toBe("matched");
    expect(tools[1].matchStatus).toBe("matched");
    expect(tools.map((item) => item.result?.value)).toEqual([
      { kind: "fields", fields: [{ key: "status", text: "Success" }] },
      { kind: "fields", fields: [{ key: "status", text: "Success" }] },
    ]);
    expect(tools[0].call?.value).toEqual({
      kind: "fields",
      fields: [{ key: "code", text: "line 1\nline 2" }],
    });
  });
  it("keeps context replay separate from the current assistant output", () => {
    const markdown = [
      "# Agent - #1",
      "## Round 2",
      section("Reasoning", "历史思考", "context=true"),
      section("Output", "历史输出", "context=true"),
      section("Call", "```json\n{}\n```", "name=query id=old context=true"),
      section("Return", "旧结果", "name=query id=old"),
      section("Output", "本轮输出"),
    ].join("\n");

    const result = parsePromptTranscript(markdown);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const round = result.transcript.rounds[0];
    expect(groupItems(round, "assistant")[0].kind).toBe("section");
  });
  it("does not split a round when its body contains a round-like heading", () => {
    const markdown = [
      "# Agent - #1",
      "## Round 1",
      section("User", "正文示例：\n## Round 99\n仍然属于提示词"),
      section("Output", "完成"),
    ].join("\n");

    const result = parsePromptTranscript(markdown);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const context = groupItems(result.transcript.rounds[0], "context")[0];
    expect(context.kind === "section" ? context.content : "").toContain("## Round 99");
  });
  it("preserves duplicate and missing ids as ambiguous or unmatched interactions", () => {
    const markdown = [
      "# Agent - #1",
      "## Round 1",
      section("Call", "{}", "name=query id=duplicate"),
      section("Return", "first", "name=query id=duplicate"),
      section("Call", "{}", "name=query id=duplicate"),
      section("Return", "second", "name=query id=duplicate"),
      section("Call", "{}", "name=no_id"),
      section("Return", "third", "name=no_id"),
    ].join("\n");

    const result = parsePromptTranscript(markdown);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tools = groupItems(result.transcript.rounds[0], "assistant").filter(
      (item) => item.kind === "tool"
    );
    expect(tools.map((item) => item.matchStatus)).toEqual([
      "ambiguous",
      "ambiguous",
      "unmatched",
      "unmatched",
    ]);
    expect(tools.map((item) => item.result?.value)).toEqual([
      { kind: "text", text: "first" },
      { kind: "text", text: "second" },
      undefined,
      { kind: "text", text: "third" },
    ]);
  });
  it("rejects incomplete marker structures and old delimiter files", () => {
    const incomplete = ["# Agent - #1", "## Round 1", "-----User BEGIN-----", "内容"].join(
      "\n"
    );

    expect(parsePromptTranscript(incomplete)).toEqual({ ok: false, reason: "invalid" });
  });
});
