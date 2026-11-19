import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { PANEL_HOST_CHANNEL, panelAddressState } from "@ontomato/contracts/panel-host";
import { KNOWLEDGE_GOVERNANCE_RECORD, SKILL } from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * U6 child object selection through the platform's real host and bridge:
 * - Child projections bind their parent platform object type and declare a valid `collection` from
 *   `platformObjectTypes[parent].childCollections`.
 * - Child state holds `PanelChildObjectIdentity` (`{ parent: { objectType, primaryKey }, primaryKey }`), and
 *   `pageContext.selection` emits `kind: "child-object"` with parent, collection, id and readable parent+child label.
 * - Switching the parent clears the child in ONE atomic `state.setState` update, so neither `pageContext` nor the host
 *   address bridge ever observes a cross-parent `(parentB, childOfParentA)` state.
 * - Child list projections query with validated `{ parent: { objectType, primaryKey }, collection }`, support
 *   toggle-off, owner-declared `defaultPrimaryKey` with first-item fallback, and fail visibly on undeclared collections.
 */

const current = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain" as const,
};

const projection = (
  id: string,
  binding: string,
  display: Record<string, unknown>,
  inputs: ProductProjection["inputs"] = {},
): ProductProjection => ({
  ...current, id, name: id, description: "", componentId: "ObjectList",
  binding: { kind: "PlatformObjectType", id: binding }, inputs, display,
});

function hostWith(projections: Record<string, ProductProjection>) {
  return (request: Sent) => {
    const match = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (match && projections[match[1]!]) return Response.json({ projection: projections[match[1]!] });
    return nothingAt(request);
  };
}

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("clears child selection atomically when switching parent and carries child-object selection in pageContext", async () => {
  const projections = {
    "record-list": projection("record-list", KNOWLEDGE_GOVERNANCE_RECORD, {
      clears: ["selectedIssue"],
      toggleable: false,
    }),
    "issue-list": projection("issue-list", KNOWLEDGE_GOVERNANCE_RECORD, {
      parentInput: "record",
      collection: "issues",
    }, { record: { kind: "object", objectType: KNOWLEDGE_GOVERNANCE_RECORD } }),
  };
  const manifest = definePanel({
    state: {
      selectedRecord: { kind: "object", objectType: KNOWLEDGE_GOVERNANCE_RECORD, deepLink: true },
      selectedIssue: { kind: "child-object", parentType: KNOWLEDGE_GOVERNANCE_RECORD, collection: "issues", deepLink: true },
    },
    slots: {
      records: { projectionId: "record-list", inputs: {}, outputs: { selected: { state: "selectedRecord" } } },
      issues: {
        projectionId: "issue-list",
        inputs: { record: { state: "selectedRecord" } },
        outputs: { selected: { state: "selectedIssue" } },
      },
    },
    operations: [],
  });
  const panel = panelRecord("panel-governance", "Governance report", manifest);
  panel.content.html = `
    <div id="app">
      <section class="records-pane"><Projection slot="records"></Projection></section>
      <section class="issues-pane"><Projection slot="issues"></Projection></section>
    </div>`;
  const use = panelUse("use-governance", "governance-test", panel.id, "/applications/app-test/governance");

  installPlatform(hostWith(projections));
  const frame = panelFrame();
  const observedBridgeMessages: Record<string, unknown>[] = [];
  window.addEventListener("message", (event) => {
    if (event.data?.channel === PANEL_HOST_CHANNEL) observedBridgeMessages.push(event.data);
  });
  platformPanelHost("app-test", use).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(panel, use, use.path, {});
  inside(frame);

  const { registerPlatformObjectAdapter } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  const issuesByRecord: Record<string, { primaryKey: string; label: string; fields: Record<string, string> }[]> = {
    "rec-1": [
      { primaryKey: "opaque-r1-i1", label: "Issue 1A", fields: {} },
      { primaryKey: "opaque-r1-i2", label: "Issue 1B", fields: {} },
    ],
    "rec-2": [
      { primaryKey: "opaque-r2-i1", label: "Issue 2A", fields: {} },
    ],
  };
  const childQueries: unknown[] = [];
  registerPlatformObjectAdapter({
    objectType: KNOWLEDGE_GOVERNANCE_RECORD,
    query: async (q) => {
      if (q.collection === "issues") {
        childQueries.push({ parent: q.parent, collection: q.collection });
        const items = q.parent ? (issuesByRecord[q.parent.primaryKey] ?? []) : [];
        return { items, total: items.length };
      }
      const items = [
        { primaryKey: "rec-1", label: "Record 1", fields: {} },
        { primaryKey: "rec-2", label: "Record 2", fields: {} },
      ];
      return { items, total: items.length };
    },
  });

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const mounted = await mountPanel({});
  await vi.waitFor(() => expect(document.querySelectorAll(".records-pane [role='option']").length).toBe(2));

  // Select parent rec-1 -> issues list queries with PanelChildCollectionQuery ({ parent: { objectType, primaryKey }, collection }).
  document.querySelectorAll<HTMLButtonElement>(".records-pane [role='option']")[0]!.click();
  await vi.waitFor(() => expect(document.querySelectorAll(".issues-pane [role='option']").length).toBe(2));
  expect(childQueries).toEqual([
    { parent: { objectType: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "rec-1" }, collection: "issues" },
  ]);

  // Select child opaque-r1-i2 -> state holds PanelChildObjectIdentity; pageContext emits kind: "child-object".
  const issueButtons = document.querySelectorAll<HTMLButtonElement>(".issues-pane [role='option']");
  issueButtons[1]!.click();
  await nextTick();
  expect(mounted.context.instance.state.values.value).toEqual({
    selectedRecord: { className: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "rec-1" },
    selectedIssue: { parent: { objectType: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "rec-1" }, primaryKey: "opaque-r1-i2" },
  });
  expect(mounted.context.instance.pageContext.value.selection).toEqual([
    { kind: KNOWLEDGE_GOVERNANCE_RECORD, id: "rec-1", label: `Record 1 (${KNOWLEDGE_GOVERNANCE_RECORD} rec-1)` },
    {
      kind: "child-object",
      parent: { objectType: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "rec-1" },
      collection: "issues",
      id: "opaque-r1-i2",
      label: expect.stringContaining("Record 1 / Issue 1B (opaque-r1-i2)"),
    },
  ]);

  // Clicking the same issue again toggles child off while keeping parent.
  issueButtons[1]!.click();
  await nextTick();
  expect(mounted.context.instance.state.values.value.selectedIssue).toBeNull();
  expect(mounted.context.instance.state.values.value.selectedRecord).toEqual({
    className: KNOWLEDGE_GOVERNANCE_RECORD,
    primaryKey: "rec-1",
  });

  // Re-select child, then switch parent to rec-2 -> child clears in ONE atomic state update!
  issueButtons[1]!.click();
  await nextTick();
  observedBridgeMessages.length = 0;

  document.querySelectorAll<HTMLButtonElement>(".records-pane [role='option']")[1]!.click();
  await vi.waitFor(() => expect(document.querySelectorAll(".issues-pane [role='option']").length).toBe(1));
  expect(mounted.context.instance.state.values.value).toEqual({
    selectedRecord: { className: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "rec-2" },
    selectedIssue: null,
  });
  expect(childQueries[1]).toEqual({
    parent: { objectType: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "rec-2" },
    collection: "issues",
  });

  // No bridge state/context message ever combined rec-2 with rec-1's child opaque-r1-i2.
  const invalidState = observedBridgeMessages.some(
    (msg) => msg.kind === "state"
      && (msg.state as Record<string, { primaryKey?: string }>)?.selectedRecord?.primaryKey === "rec-2"
      && (msg.state as Record<string, { primaryKey?: string }>)?.selectedIssue?.primaryKey === "opaque-r1-i2",
  );
  const invalidContext = observedBridgeMessages.some((msg) => {
    if (msg.kind !== "context") return false;
    const ids = ((msg.context as { selection?: { id: string }[] })?.selection ?? []).map((item) => item.id);
    return ids.includes("rec-2") && ids.includes("opaque-r1-i2");
  });
  expect(invalidState).toBe(false);
  expect(invalidContext).toBe(false);

  // All-or-nothing validation in state.setState: invalid child value refuses whole update without mutating parent.
  expect(() => mounted.context.instance.state.setState({
    selectedRecord: { className: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "rec-1" },
    selectedIssue: { className: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "not-a-child-identity" },
  })).toThrow(TypeError);
  expect(() => mounted.context.instance.state.setState({
    selectedRecord: { className: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "rec-1" },
    selectedIssue: { parent: { objectType: SKILL, primaryKey: "skill-1" }, primaryKey: "wrong-parent-type" },
  })).toThrow(TypeError);
  expect(mounted.context.instance.state.values.value.selectedRecord).toEqual({
    className: KNOWLEDGE_GOVERNANCE_RECORD,
    primaryKey: "rec-2",
  });

  // Host address change from rec-2 + opaque-r2-i1 to rec-1 (no issue) applies in one atomic update too.
  document.querySelectorAll<HTMLButtonElement>(".issues-pane [role='option']")[0]!.click();
  await nextTick();
  expect(mounted.context.instance.state.values.value.selectedIssue).toEqual({
    parent: { objectType: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "rec-2" },
    primaryKey: "opaque-r2-i1",
  });
  observedBridgeMessages.length = 0;
  const nextAddress = `${use.path}?state=${encodeURIComponent(JSON.stringify({ selectedRecord: { className: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "rec-1" } }))}`;
  window.dispatchEvent(new MessageEvent("message", {
    source: window.parent,
    data: { channel: PANEL_HOST_CHANNEL, kind: "address", address: nextAddress },
  }));
  await vi.waitFor(() => expect(mounted.context.instance.state.values.value).toEqual({
    selectedRecord: { className: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "rec-1" },
    selectedIssue: null,
  }));
  const invalidAddressContext = observedBridgeMessages.some((msg) => {
    if (msg.kind !== "context") return false;
    const ids = ((msg.context as { selection?: { id: string }[] })?.selection ?? []).map((item) => item.id);
    return ids.includes("rec-1") && ids.includes("opaque-r2-i1");
  });
  expect(invalidAddressContext).toBe(false);
});

it("selects owner-declared defaultPrimaryKey or falls back to first child on parent switch (skill detail pattern)", async () => {
  const projections = {
    "file-list": projection("file-list", SKILL, {
      parentInput: "skill",
      collection: "files",
      fallbackToFirst: true,
      toggleable: false,
    }, { skill: { kind: "object", objectType: SKILL } }),
  };
  const manifest = definePanel({
    state: {
      selectedSkill: { kind: "object", objectType: SKILL, deepLink: true },
      selectedFile: { kind: "child-object", parentType: SKILL, collection: "files", deepLink: true },
    },
    slots: {
      files: {
        projectionId: "file-list",
        inputs: { skill: { state: "selectedSkill" } },
        outputs: { selected: { state: "selectedFile" } },
      },
    },
    operations: [],
  });
  const panel = panelRecord("panel-skill", "Skill detail", manifest);
  panel.content.html = `<div id="app"><Projection slot="files"></Projection></div>`;
  const use = panelUse("use-skill", "skill-test", panel.id, "/applications/app-test/skills");

  installPlatform(hostWith(projections));
  const frame = panelFrame();
  platformPanelHost("app-test", use).frame(frame, registered("app-test", use, panel), true);
  const initialPath = `${use.path}?state=${encodeURIComponent(JSON.stringify({ selectedSkill: { className: SKILL, primaryKey: "skill-a" } }))}`;
  writePanelDocument(panel, use, initialPath, panelAddressState(initialPath));
  inside(frame);

  vi.doMock("../../../../../packages/apps-sdk/src/panel/skill", () => ({
    skillAdapters: () => [{
      objectType: SKILL,
      query: async (q: { parent?: { objectType: string; primaryKey: string }; collection?: string }) => {
        if (q.collection === "files" && q.parent?.primaryKey === "skill-a") {
          return {
            items: [
              { primaryKey: "notes.txt", label: "notes.txt", fields: {} },
              { primaryKey: "SKILL.md", label: "SKILL.md", fields: {} },
            ],
            total: 2,
            defaultPrimaryKey: "SKILL.md",
          };
        }
        if (q.collection === "files" && q.parent?.primaryKey === "skill-b") {
          return {
            items: [
              { primaryKey: "README.md", label: "README.md", fields: {} },
              { primaryKey: "run.py", label: "run.py", fields: {} },
            ],
            total: 2,
          };
        }
        return { items: [], total: 0 };
      },
    }],
  }));

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const mounted = await mountPanel({});

  // Entering skill-a selects owner's defaultPrimaryKey (SKILL.md) with complete child identity.
  await vi.waitFor(() => expect(mounted.context.instance.state.values.value.selectedFile).toEqual({
    parent: { objectType: SKILL, primaryKey: "skill-a" },
    primaryKey: "SKILL.md",
  }));

  // Switching to skill-b atomically clears child and falls back to first file (README.md) when no defaultPrimaryKey.
  mounted.context.instance.state.setState({
    selectedSkill: { className: SKILL, primaryKey: "skill-b" },
    selectedFile: null,
  });
  await vi.waitFor(() => expect(mounted.context.instance.state.values.value.selectedFile).toEqual({
    parent: { objectType: SKILL, primaryKey: "skill-b" },
    primaryKey: "README.md",
  }));
});

it("fails visibly when a child list queries an undeclared child collection", async () => {
  const projections = {
    "bad-collection": projection("bad-collection", KNOWLEDGE_GOVERNANCE_RECORD, {
      parentInput: "record",
      collection: "files",
    }, { record: { kind: "object", objectType: KNOWLEDGE_GOVERNANCE_RECORD } }),
  };
  const manifest = definePanel({
    state: {
      selectedRecord: { kind: "object", objectType: KNOWLEDGE_GOVERNANCE_RECORD, deepLink: true },
    },
    slots: {
      bad: {
        projectionId: "bad-collection",
        inputs: { record: { state: "selectedRecord" } },
      },
    },
    operations: [],
  });
  const panel = panelRecord("panel-bad-child", "Bad child", manifest);
  panel.content.html = `<div id="app"><Projection slot="bad"></Projection></div>`;
  const use = panelUse("use-bad-child", "bad-child", panel.id, "/applications/app-test/bad-child");

  installPlatform(hostWith(projections));
  const frame = panelFrame();
  platformPanelHost("app-test", use).frame(frame, registered("app-test", use, panel), true);
  const initialPath = `${use.path}?state=${encodeURIComponent(JSON.stringify({ selectedRecord: { className: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "rec-1" } }))}`;
  writePanelDocument(panel, use, initialPath, panelAddressState(initialPath));
  inside(frame);

  const { registerPlatformObjectAdapter } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  registerPlatformObjectAdapter({
    objectType: KNOWLEDGE_GOVERNANCE_RECORD,
    query: async () => ({ items: [], total: 0 }),
  });

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  await mountPanel({});

  await vi.waitFor(() => expect(document.querySelector("[role='alert']")?.textContent).toContain("Undeclared child collection"));
});
