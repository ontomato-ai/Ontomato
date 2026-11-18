import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
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
 * to the conversation as a state report.
 */

afterEach(leaveFrame);

describe("a draft at a panel application's page beside the conversation", () => {
  it("opens in the panel's form, and the page's selection goes to the conversation", { timeout: 20000 }, async () => {
    const scenario = draftScenario();
    const sent = installPlatform(scenario.answer);
    const router = createRouter({ history: createMemoryHistory(), routes: [{ ...platformRoutes.chat, component: { render: () => null } }] });
    await router.push({ path: platformRoutes.chat.path, query: { page: scenario.address } });
    await router.isReady();
    const updates: DisplayPageAddressInput[] = [];
    const navigate = vi.fn();
    const resolved = pilotPageResolver(navigate)(scenario.address)!;
    expect(resolved.id).toBe("panel-application");
    const { app: page } = mountPlatformPage(() => h(resolved.component, {
      ...resolved.props,
      onDisplayAddress: (update: DisplayPageAddressInput) => updates.push(update),
    }), router);
    const element = await panelHostFrame();
    const message = hostMessageOf(element.getAttribute("srcdoc")!);
    expect(new URL(message.url, "http://page.invalid").searchParams.get("draftRunId")).toBe("run-1");

    writeFrameDocument(message);
    inside(element.contentWindow!);
    const { context } = await mountPanel(panelOf("form"));

    await vi.waitFor(() => expect(document.querySelector(".sdk-owner-form-changed")?.textContent).toContain("caseSetId"), {
      timeout: 5000,
    });
    expect(document.querySelector('[data-field="caseSetId"]')?.textContent).toContain("Smoke (8)");
    expect(sent.filter((request) => request.method === "PUT")).toEqual([]);
    // The panel reports the draft's object as its selection and keeps the draft link in the reported address.
    await vi.waitFor(() => {
      expect(updates.at(-1)?.kind).toBe("state");
      expect(panelAddressState(updates.at(-1)!.address)).toEqual({
        selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id },
      });
    });
    expect(new URL(updates.at(-1)!.address, "http://page.invalid").searchParams.get("draftRunId")).toBe("run-1");
    expect(navigate).not.toHaveBeenCalled();
    expect(router.currentRoute.value.query.page).toBe(scenario.address);
    const discard = document.querySelector<HTMLButtonElement>(".sdk-owner-form-actions button")!;
    expect(discard.textContent?.trim()).toBe("Discard");
    discard.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".sdk-owner-form-changed")).toBeNull();
      expect(context.draft.value).toBeNull();
      expect(context.instance.dirty()).toBe(false);
    });
    expect(sent.filter((request) => request.method === "PUT")).toEqual([]);
    page.unmount();
  });
});
