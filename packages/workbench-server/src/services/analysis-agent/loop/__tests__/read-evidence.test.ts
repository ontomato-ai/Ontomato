import { expect, it, vi } from "vitest";
import { createReadEvidenceTool } from "../read-evidence";

vi.mock("../../../data-query/adapter", () => ({
  applyFieldDisplayPlan: (rows: Array<{ cups: number }>) => rows.map(row => ({ sales: String(row.cups) })),
}));

it("reads omitted middle rows from stored evidence and preserves source truncation", async () => {
  const entries = [{ index: 0, title: "Sales", data: Array.from({ length: 248 }, (_, cups) => ({ cups })), dataCount: 248 }];
  const resolve = vi.fn((id: string) => id === "q" ? { entries } : undefined);
  const tool = createReadEvidenceTool(resolve);
  const result = await tool.execute("read", { question_id: "q", offset: 100, limit: 50 });
  expect(JSON.parse(result.content[0].text!)).toMatchObject({
    totalRows: 248, returnedRows: 50, nextOffset: 150, truncated: false,
    data: Array.from({ length: 50 }, (_, n) => ({ cups: n + 100 })),
  });
  const tail = await tool.execute("read", { question_id: "q", offset: 240 });
  expect(JSON.parse(tail.content[0].text!)).toMatchObject({ returnedRows: 8, nextOffset: null });
  const partial = createReadEvidenceTool(() => ({ entries: [{ ...entries[0], truncated: true, rowLimit: 248, truncationHint: "source limit", fieldDisplayPlan: {} }] }));
  const page = await partial.execute("read", { question_id: "q", limit: 1 });
  expect(JSON.parse(page.content[0].text!)).toMatchObject({ truncated: true, rowLimit: 248, data: [{ sales: "0" }] });
});

it("rejects invalid pages and missing evidence, and honors cancellation", async () => {
  const tool = createReadEvidenceTool(() => undefined);
  await expect(tool.execute("read", { question_id: "missing" })).rejects.toThrow(/not found/);
  for (const params of [{ limit: 101 }, { offset: -1 }, { dataset_index: 1.5 }]) {
    await expect(tool.execute("read", { question_id: "q", ...params })).rejects.toThrow(/Invalid evidence page/);
  }
  const controller = new AbortController();
  controller.abort();
  await expect(tool.execute("read", { question_id: "q" }, controller.signal)).rejects.toThrow();
});
