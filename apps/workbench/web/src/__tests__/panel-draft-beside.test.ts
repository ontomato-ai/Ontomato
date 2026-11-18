import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { panelAddressState } from "@ontomato/contracts/panel-host";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { pilotPageResolver } from "../../../../../packages/platform-web/src/pilot-pages";
import { mountPanel } from "../../../../../packages/apps-sdk/src/panel/mount";
import {
  SCHEDULED_TASK,
  draftScenario,
  hostMessageOf,
  inside,
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  panelHostFrame,
  panelOf,
  task,
  writeFrameDocument,
} from "./panel-frame";

/*
 * The same draft opened beside a conversation: the conversation carries the page's address (`?page=`) and the platform's
 * registry gives the page — the one shown at that address full — with that address and the conversation's own way to
 * move. The panel reads the draft the address names, the form shows it unsaved, and the selection the draft makes goes
 * into the conversation's page parameter, not the browser's address.
 */

afterEach(leaveFrame);

describe("a draft at a panel application's page beside the conversation", () => {
  it("opens in the panel's form, and the page's selection goes to the conversation", { timeout: 20000 }, async () => {
    const scenario = draftScenario();
    const sent = installPlatform(scenario.answer);
    const router = createRouter({ history: createMemoryHistory(), routes: [{ ...platformRoutes.chat, component: { render: () => null } }] });
    await router.push({ path: platformRoutes.chat.path, query: { page: scenario.address } });
    await router.isReady();
    const pages: string[] = [];
    const resolved = pilotPageResolver((address) => pages.push(address))(scenario.address)!;
    expect(resolved.id).toBe("panel-application");
    const { app: page } = mountPlatformPage(() => h(resolved.component, resolved.props), router);
    const element = await panelHostFrame();
    const message = hostMessageOf(element.getAttribute("srcdoc")!);
    expect(new URL(message.url, "http://page.invalid").searchParams.get("draftRunId")).toBe("run-1");

    writeFrameDocument(message);
    inside(element.contentWindow!);
    await mountPanel(panelOf("form"));

    await vi.waitFor(() => expect(document.querySelector(".sdk-owner-form-changed")?.textContent).toContain("caseSetId"), {
      timeout: 5000,
    });
    expect(document.querySelector('[data-field="caseSetId"]')?.textContent).toContain("Smoke (8)");
    expect(sent.filter((request) => request.method === "PUT")).toEqual([]);
    // The draft's object is the panel's selection now, written into the conversation's page parameter with the draft's
    // link kept; the conversation stays where it is.
    await vi.waitFor(() =>
      expect(panelAddressState(pages.at(-1) ?? "")).toEqual({ selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } }),
    );
    expect(new URL(pages.at(-1)!, "http://page.invalid").searchParams.get("draftRunId")).toBe("run-1");
    expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path);
    page.unmount();
  });
});
