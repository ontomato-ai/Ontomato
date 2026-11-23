import { afterEach, expect, it, vi } from "vitest";
import { createApp, inject } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { servePageComposerKey, type PageComposerExpand } from "../../../../../packages/agent-shell-ui/src/page-composer-entry";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { installProductEmbedding } from "../../../../../packages/platform-web/src/app-host";
import {
  ignoreChanges, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * U18 ConversationEntry SDK component through the full real platform stack:
 * ConversationEntry.vue -> PanelContext.expandPageComposer -> apps-sdk bridge.ts -> platform-web app-bridge.ts
 * -> platform-web app-host.ts -> servePageComposer.
 *
 * Verifies:
 * - Preset, explicit ID and page-default targets with or without prefill expand the shown composer with the exact
 *   projection-declared `conversationEntry` and never send a message.
 * - Label resolves `labelKey` through `panel.t`, falling back to `projection.name` and generic platform copy.
 * - Missing `conversationEntry` or host refusal (no composer shown / hidden frame) surfaces visibly as `role="alert"`.
 */

const current = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain" as const,
};

function entryProjection(
  id: string,
  name: string,
  conversationEntry: ProductProjection["conversationEntry"],
  config: ProductProjection["config"] = {},
): ProductProjection {
  return {
    ...current,
    id,
    name,
    description: "",
    componentId: "@ontomato/sdk:ConversationEntry",
    inputs: {},
    outputs: {},
    config,
    data: {},
    ...(conversationEntry ? { conversationEntry } : {}),
  };
}

function hostWith(projections: Record<string, ProductProjection>) {
  return (request: Sent) => {
    const match = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (match && projections[match[1]!]) return Response.json({ projection: projections[match[1]!] });
    return nothingAt(request);
  };
}

function providedServePageComposer() {
  const app = createApp({});
  installProductEmbedding(app);
  return app.runWithContext(() => inject(servePageComposerKey)!);
}

let stopServing: (() => void) | undefined;

afterEach(() => {
  stopServing?.();
  stopServing = undefined;
  leaveFrame();
  vi.resetModules();
});

it("expands the page composer with exact projection-declared targets (preset, id, page-default) and resolves labels", async () => {
  const presetEntry = { target: { kind: "preset" as const, agentKind: "assistant-preset" }, prefill: "Review current items" };
  const idEntry = { target: { kind: "id" as const, id: "agent-42" } };
  const defaultEntry = { target: { kind: "page-default" as const }, prefill: "Help with this page" };
  const projections = {
    "entry-preset": entryProjection("entry-preset", "Preset entry", presetEntry, { labelKey: "entry.preset", type: "primary" }),
    "entry-id": entryProjection("entry-id", "Named entry", idEntry),
    "entry-default": entryProjection("entry-default", "Page assistant", defaultEntry),
  };
  const manifest = definePanel({
    state: {},
    members: {
      preset: { target: { projectionId: "entry-preset" }, inputs: {} },
      specific: { target: { projectionId: "entry-id" }, inputs: {} },
      fallback: { target: { projectionId: "entry-default" }, inputs: {} },
    },
  });
  const panel = panelRecord("panel-conv-entry", "Conversation entries", manifest);
  panel.content.messages = { en: { "entry.preset": "Start review" } };
  panel.content.html = `
    <div id="app">
      <div class="slot-preset"><Projection slot="preset" @expanded="expandedCount++"></Projection></div>
      <div class="slot-id"><Projection slot="specific" @expanded="expandedCount++"></Projection></div>
      <div class="slot-default"><Projection slot="fallback" @expanded="expandedCount++"></Projection></div>
    </div>`;
  const use = panelUse("use-conv-entry", "conv-entry-test", panel.id, "/applications/app-test/conv-entry");

  const expand = vi.fn<Parameters<PageComposerExpand>, ReturnType<PageComposerExpand>>();
  installPlatform(hostWith(projections));
  stopServing = providedServePageComposer()(expand);
  const frame = panelFrame();
  platformPanelHost("app-test", use, ignoreChanges).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(registered("app-test", use, panel), use.path, {});
  inside(frame);

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  let expandedCount = 0;
  await mountPanel({
    setup: () => ({
      get expandedCount() { return expandedCount; },
      set expandedCount(next: number) { expandedCount = next; },
    }),
  });

  await vi.waitFor(() => expect(document.querySelectorAll(".sdk-conversation-entry-btn").length).toBe(3));
  const presetBtn = document.querySelector<HTMLButtonElement>(".slot-preset .sdk-conversation-entry-btn")!;
  const idBtn = document.querySelector<HTMLButtonElement>(".slot-id .sdk-conversation-entry-btn")!;
  const defaultBtn = document.querySelector<HTMLButtonElement>(".slot-default .sdk-conversation-entry-btn")!;

  expect(presetBtn.textContent?.trim()).toBe("Start review");
  expect(presetBtn.classList.contains("primary")).toBe(true);
  expect(idBtn.textContent?.trim()).toBe("Named entry");
  expect(defaultBtn.textContent?.trim()).toBe("Page assistant");

  presetBtn.click();
  await vi.waitFor(() => expect(expand).toHaveBeenCalledTimes(1));
  expect(expand).toHaveBeenLastCalledWith(presetEntry);

  idBtn.click();
  await vi.waitFor(() => expect(expand).toHaveBeenCalledTimes(2));
  expect(expand).toHaveBeenLastCalledWith(idEntry);

  defaultBtn.click();
  await vi.waitFor(() => expect(expand).toHaveBeenCalledTimes(3));
  expect(expand).toHaveBeenLastCalledWith(defaultEntry);
  expect(expandedCount).toBe(3);
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("surfaces visible errors when conversationEntry is missing or the host has no composer", async () => {
  const declared = { target: { kind: "page-default" as const } };
  const projections = {
    "entry-valid": entryProjection("entry-valid", "Ask", declared),
    "entry-missing": entryProjection("entry-missing", "Missing", undefined),
  };
  const manifest = definePanel({
    state: {},
    members: {
      valid: { target: { projectionId: "entry-valid" }, inputs: {} },
      missing: { target: { projectionId: "entry-missing" }, inputs: {} },
    },
  });
  const panel = panelRecord("panel-conv-err", "Conversation errors", manifest);
  panel.content.html = `
    <div id="app">
      <div class="slot-valid"><Projection slot="valid" @error="errors.push($event.message)"></Projection></div>
      <div class="slot-missing"><Projection slot="missing" @error="errors.push($event.message)"></Projection></div>
    </div>`;
  const use = panelUse("use-conv-err", "conv-err-test", panel.id, "/applications/app-test/conv-err");

  installPlatform(hostWith(projections));
  providedServePageComposer();
  const frame = panelFrame();
  platformPanelHost("app-test", use, ignoreChanges).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(registered("app-test", use, panel), use.path, {});
  inside(frame);

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const errors: string[] = [];
  await mountPanel({ setup: () => ({ errors }) });

  await vi.waitFor(() => expect(document.querySelectorAll(".sdk-conversation-entry-btn").length).toBe(2));

  // Missing conversationEntry -> fails visibly without calling the host.
  document.querySelector<HTMLButtonElement>(".slot-missing .sdk-conversation-entry-btn")!.click();
  await vi.waitFor(() => expect(document.querySelector('.slot-missing [role="alert"]')?.textContent).toContain("conversationEntry"));

  // Valid entry with no composer registered on the page -> surfaces host refusal.
  document.querySelector<HTMLButtonElement>(".slot-valid .sdk-conversation-entry-btn")!.click();
  await vi.waitFor(() => expect(document.querySelector('.slot-valid [role="alert"]')?.textContent).toContain("no composer"));
  expect(errors).toHaveLength(2);
});
