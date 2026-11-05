import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { collectPptConversation, type PptConversationTurn } from "../ppt-conversation";
import { PptArtifactStore } from "../ppt-artifacts";
import { buildPptDeck } from "../ppt-generator";

vi.mock("../../../../product/installed", () => ({workbenchProduct: () => ({serviceDisplayName: "Test"})}));
vi.mock("../chart-renderer", () => ({renderChartHtmlToDataUrl: vi.fn()}));
vi.mock("../ppt-summarizer", () => ({summarizeReportForPpt: vi.fn()}));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "ppt-test-"));
afterAll(() => fs.rm(root, {recursive: true, force: true}));

const turn = (seq: number): PptConversationTurn => ({requestSeq: seq, userMessage: `Question ${seq}`, evidenceRefs: [], charts: [], finalAnswer: `Answer ${seq}`});
const outline = { title: "Conversation", subtitle: "Summary", slides: [{title: "Overview", takeaway: "Revenue increased", bullets: ["Revenue 42"], sourceSectionIds: ["first"], visual: "chart" as const}] };
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

describe("conversation PPT", () => {
  it("collects all historical turns, tables and charts without tool results or thinking", () => {
    const first = turn(1);
    first.messages = [
      {role: "assistant", content: [{type: "thinking", text: "private reasoning"}, {type: "text", text: "Early explanation"}]},
      {role: "toolResult", toolCallId: "t", toolName: "internal", content: [{type: "text", text: "secret credential"}]},
    ];
    first.evidenceRefs = [{questionId: "q", question: "Revenue", threadId: "thread", requestSeq: 1, sourceKind: "analysis_sub_question", sourceRef: "q"}];
    first.charts = [{chartId: "c", title: "Revenue chart", chartType: "bar", sourceSubQuestion: "Revenue", scopeId: "q", skillId: "echarts", dataCount: 1, html: "<canvas></canvas>", evidenceSummary: "Chart explanation"}];
    const {sections, warnings} = collectPptConversation([turn(40), first], () => ({question: "Revenue", entries: [{index: 0, title: "Results", dataCount: 1, data: [{year: 2026, revenue: 42}]}]}));
    const json = JSON.stringify(sections);
    expect(sections[0].id).toBe("turn-1");
    for (const text of ["Answer 1", "Answer 40", "Early explanation", "Chart explanation", "<canvas>"]) expect(json).toContain(text);
    expect(json).not.toContain("private reasoning");
    expect(json).not.toContain("secret credential");
    expect(sections.find(section => section.tables)?.tables?.[0]).toEqual({columns: ["year", "revenue"], rows: [[2026, 42]]});
    expect(warnings).toEqual([]);
  });

  it("returns warnings for missing query data while retaining the conversation", () => {
    const source = turn(1);
    source.evidenceRefs = [{questionId: "missing", question: "Revenue", threadId: "thread", requestSeq: 1, sourceKind: "analysis_sub_question", sourceRef: "missing"}];
    const result = collectPptConversation([source], () => undefined);
    expect(result.warnings).toHaveLength(1);
    expect(result.sections[0].content).toContain("Answer 1");
  });

  it("keeps partial query status in the source and the real PPTX warning slide", async () => {
    const source = turn(1);
    source.evidenceRefs = [{questionId: "q", question: "Revenue", threadId: "thread", requestSeq: 1, sourceKind: "analysis_sub_question", sourceRef: "q"}];
    const marker = {truncated: true as const, rowLimit: 100000, truncationHint: "Only the processed portion is included."};
    const {sections} = collectPptConversation([source], () => ({question: "Revenue", entries: [{index: 0, title: "Results", dataCount: 0, data: [], ...marker}]}));
    expect(sections.find(section => section.tables)).toMatchObject(marker);
    const {buffer, warnings} = await buildPptDeck("Partial", sections, {...outline, slides: []});
    expect(warnings.join(" ")).toContain(marker.truncationHint);
    const xml = new AdmZip(buffer).getEntries().filter(entry => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName)).map(entry => entry.getData().toString()).join("\n");
    expect(xml).toContain("Incomplete source data");
    expect(xml).toContain(marker.truncationHint);
  });

  it("writes a real PPTX with every chart, paginated native tables and failure warnings", async () => {
    const render = vi.fn(async (html: string) => {if (html.includes("broken")) throw new Error("bad chart"); return png;});
    const {buffer, warnings} = await buildPptDeck("Conversation", [{id: "first", heading: "Results", content: "Explanation\n```html\n<canvas>first</canvas>\n```\n```html\n<canvas>second</canvas>\n```\n```html\n<canvas>broken</canvas>\n```", tables: [{columns: ["year", "revenue"], rows: Array.from({length: 35}, (_, index) => [index, 42])}]}], outline, {}, undefined, render);
    const zip = new AdmZip(buffer);
    const xml = zip.getEntries().filter(entry => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName)).map(entry => entry.getData().toString()).join("\n");
    expect(zip.getEntry("[Content_Types].xml")).not.toBeNull();
    expect(render).toHaveBeenCalledTimes(3);
    expect(warnings).toHaveLength(1);
    expect(xml).toContain("Export warnings");
    expect(xml).toContain("Chart unavailable");
    expect(xml.match(/<a:tbl>/g)!.length).toBeGreaterThanOrEqual(2);
    expect(xml).toContain("<a:t>34</a:t>");
    expect(zip.getEntries().filter(entry => /ppt\/media\/.*\.png$/.test(entry.entryName)).length).toBeGreaterThan(0);
  });

  it("generates text-only presentations using the existing default illustrations", async () => {
    const {buffer, warnings} = await buildPptDeck("Text", [{id: "text", content: "Explanation"}], {...outline, slides: [{...outline.slides[0], visual: "insight", sourceSectionIds: ["text"]}]});
    expect(new AdmZip(buffer).getEntry("ppt/slides/slide2.xml")?.getData().toString()).toContain("Revenue increased");
    expect(warnings).toEqual([]);
  });

  it("restricts files to the originating domain and user and rejects traversal", async () => {
    const store = new PptArtifactStore(root);
    const owner = {domainId: "domain", userId: "user"};
    const file = await store.save(owner, "Example", Buffer.from("pptx"));
    const id = file.url.split("/").at(-1)!;
    expect((await store.read(id, owner))?.buffer.toString()).toBe("pptx");
    expect(await store.read(id, {...owner, userId: "someone-else"})).toBeNull();
    expect(await store.read(id, {...owner, domainId: "other-domain"})).toBeNull();
    expect(await store.read("../escape", owner)).toBeNull();
  });
});
