import { afterEach, expect, it, vi } from "vitest";
import { defineComponent, h, type Ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { parseApplicationPanelAddress } from "@ontomato/contracts/panel-host";
import { provideApplicationFrame } from "@ontomato/platform-shell";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, panelUse, projections, type Sent } from "./panel-frame";

/*
 * An application's own frame (product-layer standard, part one; design §三, big main's rulings 2026-11-21): the frame
 * panel Java names stands in the application's area, the platform's layout gives way, and the entry's page — the
 * platform's header with the content — stands where the frame's <current-entry> is. The frame's shared term rides in
 * the address's `frame` segment and reaches the content through the entry's `{frameState}` input; going to another entry
 * keeps the same frame.
 *
 * What this rules out: a frame that cannot hold the entry's page, or holds a second instance of it; a page header lost
 * when the application draws its own frame; a shared value that does not reach the content or the address; a frame
 * rebuilt on every entry.
 */

const app = "app-framed";
const at = (path: string) => `/applications/${app}/${path}`;
const content = panelRecord("panel-framed-content", "Term", definePanel({
  state: { term: { type: { kind: "scalar", type: "string" }, deepLink: true, external: true } },
  members: {}, commands: {},
}));
content.content = { ...content.content, module: `import { h } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";
await mountPanel({ setup() {
  const { instance } = usePanelContext();
  return () => h("output", { class: "term" }, String(instance.state.values.value.term ?? ""));
} });
` };
const frame = panelRecord("panel-framed-frame", "Frame", definePanel({
  state: { term: { type: { kind: "scalar", type: "string" }, deepLink: true, external: true, default: "A" } },
  members: { content: { target: { fromPlatform: "currentEntry", candidates: { rule: "applicationEntry" } } } },
  commands: {},
}));
frame.content = {
  ...frame.content,
  html: `<div id="app"><nav class="frame-menu"><span class="current">{{ current?.pageKey }}</span>
    <button class="term-b" @click="setB">B</button></nav><current-entry member="content"></current-entry></div>`,
  module: `import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";
await mountPanel({ setup() {
  const { currentEntry, instance } = usePanelContext();
  return { current: currentEntry, setB: () => instance.state.set("term", "B") };
} });
`,
};
const uses = ["spring", "autumn"].map((name) => ({
  ...panelUse(`use-${name}`, `framed-${name}`, content.id, at(name)), names: { en: name }, inputs: { term: { frameState: "term" } },
}));

async function answer(request: Sent) {
  // Node answers the frame for the entry with no page skill: the frame is no page of its own.
  if (request.path === `/api/product-panels/${frame.id}/snapshot`) {
    const { pageSkillContext: _none, ...snapshot } = await (await panelSnapshot(frame, projections, request)).json();
    return Response.json(snapshot);
  }
  if (request.path === `/api/data-query/platform/applications/${app}/panel-uses`)
    return Response.json({ data: { applicationId: app, entry: { path: `/applications/${app}`, renderer: "panels" }, panelUses: uses, framePanelId: frame.id } });
  for (const panel of [content, frame]) {
    if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
    if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, projections, request);
  }
  return nothingAt(request);
}

afterEach(() => leaveFrame());

it("holds the entry's page, header and content, in the frame; shares the frame's term through the address; keeps the frame across entries", async () => {
  const sent = installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath(.*)?", component: PanelApplicationRoute,
    props: route => ({ applicationId: String(route.params.applicationId) }),
  }] });
  await router.push(at("spring"));
  let framed!: Readonly<Ref<boolean>>;
  const { app: mounted, element } = mountPlatformPage(() => h(defineComponent({
    setup() {
      framed = provideApplicationFrame();
      return () => h(RouterView);
    },
  })), router);
  try {
    const frameRoot = await vi.waitFor(() => {
      const found = element.querySelector<HTMLElement>(".panel-application-frame .frame-menu");
      if (!found) throw new Error("The frame is not drawn yet");
      return found.closest<HTMLElement>(".panel-application-frame")!;
    });
    expect(framed.value).toBe(true);
    // The frame read its record as the entry's frame.
    expect(sent.some((request) => request.path === `/api/product-panels/${frame.id}` && request.search.includes("source=frame"))).toBe(true);
    // The entry's page is inside the frame: the platform's header, then the content, with the frame's default term.
    await vi.waitFor(() => expect(frameRoot.querySelector(".panel-entry-unit .page-title")?.textContent).toBe("spring"));
    await vi.waitFor(() => expect(frameRoot.querySelector(".panel-entry-unit .term")?.textContent).toBe("A"));
    expect(frameRoot.querySelector(".current")?.textContent).toBe("framed-spring");

    // The frame changes the shared term: the content follows, and the address carries it as the frame's.
    frameRoot.querySelector<HTMLButtonElement>(".term-b")!.click();
    await vi.waitFor(() => expect(parseApplicationPanelAddress(router.currentRoute.value.fullPath).frame).toEqual({ term: "B" }));
    await vi.waitFor(() => expect(frameRoot.querySelector(".panel-entry-unit .term")?.textContent).toBe("B"));

    // Another entry: the same frame, its entry and the shared term kept.
    await router.push(`${at("autumn")}?frame=${encodeURIComponent(JSON.stringify({ term: "B" }))}`);
    await vi.waitFor(() => expect(frameRoot.querySelector(".current")?.textContent).toBe("framed-autumn"));
    expect(element.querySelector(".panel-application-frame")).toBe(frameRoot);
    await vi.waitFor(() => expect(frameRoot.querySelector(".panel-entry-unit .page-title")?.textContent).toBe("autumn"));

    // An entry opened at its bare address — the frame's own menu, a link — keeps the frame's term, and its address says so.
    await router.push(at("spring"));
    await vi.waitFor(() => expect(frameRoot.querySelector(".current")?.textContent).toBe("framed-spring"));
    await vi.waitFor(() => expect(parseApplicationPanelAddress(router.currentRoute.value.fullPath).frame).toEqual({ term: "B" }));
    expect(frameRoot.querySelector(".panel-entry-unit .term")?.textContent).toBe("B");
  } finally {
    mounted.unmount();
  }
});
