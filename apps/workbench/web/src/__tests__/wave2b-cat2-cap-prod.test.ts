import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../../../..");
const ontologyPanels = resolve(repoRoot, "packages/ontology-manager/resources/builtin-panels");
const schedulePanels = resolve(repoRoot, "packages/platform-schedules/resources/builtin-panels");

function readMembers(filePath: string) {
  const doc = JSON.parse(readFileSync(filePath, "utf8")) as { manifest: { members: Record<string, Record<string, unknown>> } };
  return doc.manifest.members;
}

describe("Wave 2B Cat-2 B-block wiring contracts", () => {
  it("MV-08: wires minContainerWidth responsive thresholds on metric-views catalog columns", () => {
    const members = readMembers(resolve(ontologyPanels, "metric-views/panel.json"));
    const columns = ((members.list?.config as { columns?: Array<{ key: string; minContainerWidth?: number }> })?.columns) ?? [];
    const byKey = new Map(columns.map((column) => [column.key, column.minContainerWidth]));
    expect(byKey.get("label")).toBeUndefined();
    expect(byKey.get("function")).toBe(901);
    expect(byKey.get("origin")).toBe(901);
    expect(byKey.get("status")).toBeUndefined();
    expect(byKey.get("createdBy")).toBe(901);
    expect(byKey.get("reviewedBy")).toBe(901);
    expect(byKey.get("modified")).toBe(901);
  });

  it("AC-07: declares Python syntax highlighting on action-detail AnnotatedCode member", () => {
    const members = readMembers(resolve(ontologyPanels, "action-detail/panel.json"));
    expect(members.explanation?.component).toBe("AnnotatedCode");
    expect((members.explanation?.config as Record<string, unknown>)?.language).toBe("python");
  });

  it("AC-14: wires minContainerWidth responsive thresholds on actions catalog columns", () => {
    const members = readMembers(resolve(ontologyPanels, "actions/panel.json"));
    const columns = ((members.catalog?.config as { columns?: Array<{ key: string; minContainerWidth?: number }> })?.columns) ?? [];
    const byKey = new Map(columns.map((column) => [column.key, column.minContainerWidth]));
    expect(byKey.get("label")).toBeUndefined();
    expect(byKey.get("function")).toBe(901);
    expect(byKey.get("origin")).toBe(901);
    expect(byKey.get("status")).toBeUndefined();
    expect(byKey.get("createdBy")).toBe(901);
    expect(byKey.get("reviewedBy")).toBe(901);
    expect(byKey.get("updatedAt")).toBe(901);
  });

  it("SC-02: schedules appFilter uses SegmentedControl with maxVisible=6 overflow menu", () => {
    const members = readMembers(resolve(schedulePanels, "schedules/panel.json"));
    expect(members.appFilter?.component).toBe("SegmentedControl");
    expect((members.appFilter?.config as Record<string, unknown>)?.maxVisible).toBe(6);
  });

  it("SC-04, SC-12, SC-13: schedules panel wires ScheduledTaskSummaryList cards, multi-row runDetail, and declarative reread", () => {
    const members = readMembers(resolve(schedulePanels, "schedules/panel.json"));
    const html = readFileSync(resolve(schedulePanels, "schedules/panel.html"), "utf8");
    const mjs = readFileSync(resolve(schedulePanels, "schedules/panel.mjs"), "utf8");

    expect(members.tasks?.component).toBe("ScheduledTaskSummaryList");
    expect((members.tasks?.config as Record<string, unknown>)?.presentation).toBe("cards");
    expect((members.tasks?.operations as Record<string, unknown>)?.setEnabled).toBeDefined();

    expect((members.history?.config as Record<string, unknown>)?.rowExpandMode).toBe("multiple");
    expect(members.runDetail?.component).toBe("ObjectSummary");
    expect((((members.runDetail?.data as Record<string, unknown>)?.record as Record<string, unknown>)?.params as Record<string, unknown>)?.runId).toEqual({ fromSlot: true });
    expect(html).toContain('slot="runDetail"');
    expect(html).toContain(':inputs="{ runId: rowRef.primaryKey }"');

    expect(mjs).not.toContain("setInterval");
  });

  it("AG-09: wires refreshable option reload on agent-detail model, MCP tools, and execution identity pickers", () => {
    const members = readMembers(resolve(ontologyPanels, "agent-detail/panel.json"));
    for (const slot of ["model", "tools", "executor"] as const) {
      expect(members[slot]?.component).toBe("ReferencePicker");
      expect((members[slot]?.config as Record<string, unknown>)?.refreshable).toBe(true);
    }
  });

  it.each([
    ["PJ-06", "projection-detail"],
    ["PN-03", "panel-detail"],
    ["AP-08", "application-detail"],
  ] as const)("%s: wires ProductAssetGraph referenceGraph and click navigation in %s", (_code, dir) => {
    const members = readMembers(resolve(ontologyPanels, dir, "panel.json"));
    const html = readFileSync(resolve(ontologyPanels, dir, "panel.html"), "utf8");
    const mjs = readFileSync(resolve(ontologyPanels, dir, "panel.mjs"), "utf8");

    expect(members.referenceGraph?.component).toBe("ProductAssetGraph");
    expect((members.referenceGraph?.data as Record<string, unknown>)?.graph).toBe("referenceGraph");
    expect(html).toContain('slot="referenceGraph"');
    expect(html).toContain('@open="onOpenAssetGraph"');
    expect(mjs).toContain("onOpenAssetGraph");
  });
});
