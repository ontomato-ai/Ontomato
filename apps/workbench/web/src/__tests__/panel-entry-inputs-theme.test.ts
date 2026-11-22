import { afterEach, expect, it, vi } from "vitest";
import { defineComponent, h, type Ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { PanelThemeOverrides } from "@ontomato/contracts/panel-manifest";
import { provideApplicationTheme, providePageActions, type PlatformPageActions } from "@ontomato/platform-shell";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, panelUse, projections, type Sent } from "./panel-frame";

/*
 * An application's entries pass their content panel fixed values, and the application's theme reaches its area
 * (product-layer standard, parts one and three; design §三, §六). The same panel at two entries, each passing its own
 * term, shows each its own; the field the entry passes is the entry's, so the address never carries it. The theme Java
 * answers for the entry goes to the frame that draws the application's area at full page, and onto the content beside a
 * conversation.
 *
 * What this rules out: two entries of one panel showing the same value; an entry's value overridden by the address, or
 * written into it; an application's theme that never leaves Java's answer.
 */

const app = "app-entry-inputs";
const at = (path: string) => `/applications/${app}/${path}`;
const panel = panelRecord("panel-term", "Term", definePanel({
  state: {
    term: { type: { kind: "scalar", type: "string" }, deepLink: true, external: true },
    note: { type: { kind: "scalar", type: "string" }, deepLink: true },
  },
  members: {},
  // One command sets the term the entries fix, one does not: only the second does anything at these entries.
  commands: {
    toAutumn: { labelKey: "toAutumn", do: { set: { fields: { term: { literal: "2026 autumn" } } } } },
    clearNote: { labelKey: "clearNote", do: { set: { fields: { note: { literal: "" } } } } },
  },
}));
panel.content = { ...panel.content, messages: { en: { toAutumn: "Switch to autumn", clearNote: "Clear the note" } }, module: `import { h } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";
await mountPanel({ setup() {
  const { instance } = usePanelContext();
  return () => h("output", { class: "term" }, String(instance.state.values.value.term ?? ""));
} });
` };
const theme: PanelThemeOverrides = { light: { "--sdk-color-primary": "#0f7b6c" } };
const uses = [
  { ...panelUse("use-spring", "term-spring", panel.id, at("spring")), names: { en: "Spring" }, inputs: { term: { literal: "2026 spring" } } },
  { ...panelUse("use-autumn", "term-autumn", panel.id, at("autumn")), names: { en: "Autumn" }, inputs: { term: { literal: "2026 autumn" } } },
];

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${app}/panel-uses`)
    return Response.json({ data: { applicationId: app, entry: { path: `/applications/${app}`, renderer: "panels" }, panelUses: uses, theme } });
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, projections, request);
  return nothingAt(request);
}

afterEach(() => leaveFrame());

/** The term the shown page displays; a page kept from before stays in the document, hidden. */
const term = () => [...document.querySelectorAll<HTMLElement>(".term")]
  .find((output) => output.closest<HTMLElement>(".panel-host")!.style.display !== "none")?.textContent;

it("gives each entry's content its own fixed value, keeps it out of the address, and hands the frame the theme", async () => {
  installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath(.*)?", component: PanelApplicationRoute,
    props: route => ({ applicationId: String(route.params.applicationId) }),
  }] });
  // An address asking for another term does not move the entry's.
  await router.push(`${at("spring")}?state=${encodeURIComponent(JSON.stringify({ term: "from the address" }))}`);
  let area!: Readonly<Ref<PanelThemeOverrides | null>>;
  let header!: Readonly<Ref<PlatformPageActions | null>>;
  const { app: mounted } = mountPlatformPage(() => h(defineComponent({
    setup() {
      area = provideApplicationTheme();
      header = providePageActions();
      return () => h(RouterView);
    },
  })), router);
  try {
    await vi.waitFor(() => expect(term()).toBe("2026 spring"));
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(at("spring")));
    expect(area.value).toEqual(theme);
    // The command that would set the term the entry fixes is not offered here; the other one is.
    await vi.waitFor(() => expect(header.value?.actions?.map((action) => action.id)).toEqual(["clearNote"]));

    await router.push(at("autumn"));
    await vi.waitFor(() => expect(term()).toBe("2026 autumn"));
    expect(router.currentRoute.value.fullPath).toBe(at("autumn"));
  } finally {
    mounted.unmount();
  }
});

it("assigns the application's theme on the content beside a conversation", async () => {
  installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [] });
  const { app: mounted, element } = mountPlatformPage(() => h(PanelApplicationRoute, {
    applicationId: app, address: at("spring"), navigate: () => {},
  }), router);
  try {
    await vi.waitFor(() => expect(term()).toBe("2026 spring"));
    const content = element.querySelector<HTMLElement>(".panel-application-area")!;
    await vi.waitFor(() => expect(content.style.getPropertyValue("--sdk-color-primary")).toBe("#0f7b6c"));
    expect(content.style.getPropertyValue("--el-color-primary")).toBe("#0f7b6c");
  } finally {
    mounted.unmount();
  }
});
