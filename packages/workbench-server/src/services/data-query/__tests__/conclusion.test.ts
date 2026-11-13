import { beforeAll, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { Dataset } from "../adapter";
import { streamConclusion } from "../conclusion";

vi.mock("../../../config/model-factory", () => ({
  createModel: async () => ({
    stream: async () => (async function* () { yield { content: "Incorrect total: 999999" }; })(),
  }),
}));

beforeAll(() => {
  configureI18n({
    defaultLocale: "en",
    languageSwitchEnabled: false,
    appTextLocale: "en",
    packs: { en: { messages: en, ...enLocaleMeta } },
  });
});

it.each([
  [{ item: "A", amount: "120.50" }, { item: "B", amount: "80.25" }],
  [{ side: "inside", amount: 20 }, { side: "outside", amount: 30 }, { side: "total", amount: 50 }],
  [{ company: "A", ratio: 0.8 }, { company: "B", ratio: 0.6 }],
])("keeps executed values in their table without inventing numeric claims", async (...rows) => {
  const data = rows as Record<string, unknown>[];
  const dataset: Dataset = { id: "d", name: "result", description: "result", columns: [], data };
  const prefix = "Executed table with exact values and scope notes";
  let displayed = "";
  const content = await streamConclusion("Summarize the results", [dataset], prefix, (value) => { displayed = value; });

  expect(content.startsWith(prefix)).toBe(true);
  expect(content.slice(prefix.length)).not.toMatch(/\d/);
  expect(displayed).toBe(content);
  expect(dataset.data).toEqual(rows);
});

it("reports no data only for a complete empty result", async () => {
  const dataset: Dataset = { id: "d", name: "result", description: "result", columns: [], data: [] };
  const content = await streamConclusion("Find orders", [dataset], "", () => {});
  expect(content).toContain(en["query.conclusion.noDataFound"]);
});

it("does not publish a conclusion after cancellation", async () => {
  const cancellation = new AbortController();
  cancellation.abort();
  let published = false;
  await expect(streamConclusion("Find orders", [], "", () => { published = true; }, cancellation.signal)).rejects.toThrow();
  expect(published).toBe(false);
});
