import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

vi.mock("../../../config/application", () => ({
  config: { dataQuery: { baseUrl: "http://owner.test" } },
}));

import { createKnowledgeGovernanceReadAdapter } from "../governance-panel-reads";

const viewer = {
  token: "viewer-tk",
  apiKey: "viewer-key",
  locale: "en",
  headers: { "x-domain-id": "domain-a" },
};
const recordId = "11111111-1111-4111-8111-111111111111";

beforeAll(() => {
  configureI18n({
    defaultLocale: "en",
    appTextLocale: "en",
    languageSwitchEnabled: false,
    packs: { en: { ...enLocaleMeta, messages: en } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("forwards viewer credentials and projects governance work record, issues, and sources", async () => {
  const work = {
    revision: 3,
    work: {
      summary: "Found 1 terminology conflict",
      notes: "Reviewed all order rules",
      reviewedKnowledgeIds: ["k-1", "k-2"],
      knowledgeTotal: 5,
      issues: [
        {
          id: "iss-1",
          title: "Order cutoff mismatch",
          category: "knowledge" as const,
          status: "proposed" as const,
          problem: "Two rules state different cutoff times.",
          before: "17:00 vs 18:00",
          after: "Align cutoff to 18:00",
          basis: "Confirmed in latest fulfillment SOP",
          sourceIds: ["src-1", "src-2"],
        },
      ],
      sources: [
        {
          id: "src-1",
          kind: "knowledge" as const,
          target: "k-1",
          title: "Cutoff rule",
          excerpt: "Orders placed before 18:00 ship same day.",
        },
      ],
    },
  };

  const sent: { url: string; headers: Headers }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: Parameters<typeof fetch>[1]) => {
    sent.push({ url, headers: new Headers(init?.headers) });
    return Response.json(work);
  }));

  const reads = createKnowledgeGovernanceReadAdapter(viewer);

  const record = panelReadResultSchemas.panelRecord.parse(await reads.record(recordId));
  expect(record).toEqual({
    primaryKey: recordId,
    label: "Found 1 terminology conflict",
    fieldLabels: {
      summary: "Summary",
      revision: "Revision",
      progress: "Progress",
      issueCount: "Issues",
      sourceCount: "Sources",
      notes: "Notes",
    },
    fields: {
      summary: "Found 1 terminology conflict",
      revision: "3",
      progress: "2/5",
      issueCount: "1",
      sourceCount: "1",
      notes: "Reviewed all order rules",
    },
  });

  const issues = panelReadResultSchemas.panelRecordList.parse(await reads.issues(recordId));
  expect(issues).toEqual([
    {
      primaryKey: "iss-1",
      label: "Order cutoff mismatch",
      subtitle: "Knowledge organization · Proposed",
      fieldLabels: {
        category: "Category",
        status: "Status",
        problem: "Problem",
        before: "Current description or state",
        after: "Proposed change",
        basis: "Basis",
        sourceIds: "Sources",
      },
      fields: {
        category: "Knowledge organization",
        status: "Proposed",
        problem: "Two rules state different cutoff times.",
        before: "17:00 vs 18:00",
        after: "Align cutoff to 18:00",
        basis: "Confirmed in latest fulfillment SOP",
        sourceIds: "src-1, src-2",
      },
    },
  ]);

  const sources = panelReadResultSchemas.panelRecordList.parse(await reads.sources(recordId));
  expect(sources).toEqual([
    {
      primaryKey: "src-1",
      label: "Cutoff rule",
      subtitle: "Business knowledge",
      fieldLabels: {
        kind: "Kind",
        target: "Target",
        excerpt: "Excerpt",
      },
      fields: {
        kind: "Business knowledge",
        target: "k-1",
        excerpt: "Orders placed before 18:00 ship same day.",
      },
    },
  ]);

  expect(sent).toHaveLength(3);
  for (const call of sent) {
    expect(call.url).toBe(`http://owner.test/ontology/ai/knowledge-governance/${recordId}/work`);
    expect(call.headers.get("tk")).toBe("viewer-tk");
    expect(call.headers.get("X-API-Key")).toBe("viewer-key");
    expect(call.headers.get("Accept-Language")).toBe("en");
    expect(call.headers.get("x-domain-id")).toBe("domain-a");
  }
});

it("lists only the sources one issue cites, in the order it cites them", async () => {
  const source = (id: string, title: string) => ({ id, kind: "knowledge" as const, target: `k-${id}`, title, excerpt: `${title} text` });
  const issue = (id: string, sourceIds: string[]) => ({
    id, title: id, category: "knowledge" as const, status: "proposed" as const,
    problem: "Problem", before: "Before", after: "After", basis: "Basis", sourceIds,
  });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    revision: 1,
    work: {
      summary: "", notes: "", reviewedKnowledgeIds: [], knowledgeTotal: null,
      issues: [issue("iss-1", ["src-3", "src-1"]), issue("iss-2", [])],
      sources: [source("src-1", "Cutoff rule"), source("src-2", "Return rule"), source("src-3", "Holiday rule")],
    },
  })));
  const reads = createKnowledgeGovernanceReadAdapter(viewer);

  const cited = panelReadResultSchemas.panelRecordList.parse(await reads.issueSources(recordId, { issue: "iss-1" }));
  expect(cited.map(row => [row.primaryKey, row.label])).toEqual([["src-3", "Holiday rule"], ["src-1", "Cutoff rule"]]);
  expect(cited[0]!.fields).toEqual({ kind: "Business knowledge", target: "k-src-3", excerpt: "Holiday rule text" });
  expect(await reads.issueSources(recordId, { issue: "iss-2" })).toEqual([]);
  await expect(reads.issueSources(recordId, { issue: "iss-none" })).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
});

it("falls back to localized report title when summary is empty and omits total when knowledgeTotal is null", async () => {
  const emptyWork = {
    revision: 0,
    work: {
      summary: "",
      notes: "",
      reviewedKnowledgeIds: ["k-1"],
      knowledgeTotal: null,
      issues: [],
      sources: [],
    },
  };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(emptyWork)));

  const record = await createKnowledgeGovernanceReadAdapter(viewer).record(recordId);
  expect(record.label).toBe("Governance report");
  expect(record.fields.progress).toBe("1");
});

it("pages one governance source by offset encoded in cursor and omits nextCursor on the final page or null page", async () => {
  const source = {
    id: "src-1",
    kind: "knowledge" as const,
    target: "k-1",
    title: "Cutoff rule",
    excerpt: "Part 1",
  };
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    const parsed = new URL(url);
    const offset = Number(parsed.searchParams.get("offset"));
    if (parsed.pathname.endsWith("/sources/src-artifact")) {
      return Response.json({ source: { ...source, id: "src-artifact", kind: "artifact" }, page: null });
    }
    if (offset === 0) {
      return Response.json({
        source,
        page: {
          items: [{ id: "k-1", title: "Cutoff rule", text: "Part 1", start: 0, end: 6, totalChars: 12 }],
          totalItems: 1,
          matchedItems: 1,
          next: { index: 0, offset: 6 },
        },
      });
    }
    return Response.json({
      source,
      page: {
        items: [{ id: "k-1", title: "Cutoff rule", text: "Part 2", start: 6, end: 12, totalChars: 12 }],
        totalItems: 1,
        matchedItems: 1,
        next: null,
      },
    });
  }));

  const reads = createKnowledgeGovernanceReadAdapter(viewer);
  const page1 = panelReadResultSchemas.panelRecordQuery.parse(await reads.sourcePage(recordId, { source: "src-1" }));
  expect(page1).toEqual({
    rows: [
      {
        primaryKey: "k-1:0",
        label: "Cutoff rule",
        fieldLabels: { text: "Content", start: "Start", end: "End", totalChars: "Total characters" },
        fields: { text: "Part 1", start: "0", end: "6", totalChars: "12" },
      },
    ],
    nextCursor: "6",
  });

  const page2 = panelReadResultSchemas.panelRecordQuery.parse(
    await reads.sourcePage(recordId, { source: "src-1", cursor: "6" }),
  );
  expect(page2).toEqual({
    rows: [
      {
        primaryKey: "k-1:6",
        label: "Cutoff rule",
        fieldLabels: { text: "Content", start: "Start", end: "End", totalChars: "Total characters" },
        fields: { text: "Part 2", start: "6", end: "12", totalChars: "12" },
      },
    ],
  });
  expect(page2.nextCursor).toBeUndefined();

  const artifactPage = panelReadResultSchemas.panelRecordQuery.parse(
    await reads.sourcePage(recordId, { source: "src-artifact" }),
  );
  expect(artifactPage).toEqual({ rows: [] });

  expect(urls).toEqual([
    `http://owner.test/ontology/ai/knowledge-governance/${recordId}/sources/src-1?offset=0`,
    `http://owner.test/ontology/ai/knowledge-governance/${recordId}/sources/src-1?offset=6`,
    `http://owner.test/ontology/ai/knowledge-governance/${recordId}/sources/src-artifact?offset=0`,
  ]);
});

it("propagates Java 403/404 responses as HttpError", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    Response.json({ error: { code: "FORBIDDEN", message: "Business knowledge permission is required" } }, { status: 403 })));

  await expect(createKnowledgeGovernanceReadAdapter(viewer).record(recordId)).rejects.toMatchObject({
    status: 403,
    code: "FORBIDDEN",
    message: "Business knowledge permission is required",
  });
});
