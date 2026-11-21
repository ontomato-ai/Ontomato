import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import { pilotPageResolver } from "../../../../../packages/platform-web/src/pilot-pages";
import { catalogFixture } from "../../../../../packages/platform-web/src/__tests__/fixtures";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, type Sent } from "./panel-frame";

/*
 * A built-in application's panel entry beside a conversation (big main's ruling, 2026-11-21: one panel route serves every
 * declared entry, whatever its prefix): `/ontology/components`, which the conversation carries as its page, is the same
 * page the platform shows full — the ontology manager's entry, as the reader's catalog lists it — so a message written
 * beside it carries its page skill.
 *
 * Real resolver, route, panel host and SDK; the catalog and the network are stand-ins.
 *
 * What this rules out: a built-in application's entry that opens full but shows nothing beside the conversation, so a
 * message about it carries no page skill.
 */

const panel = panelRecord("builtin-components", "Base components", definePanel({ state: {}, members: {}, events: {} }));
const components: ApplicationPanelUse = {
  id: "ontology-components", pageKey: "ontology-components", panelId: panel.id, path: "/ontology/components",
  access: { permissionCode: "ontology-modeling" }, names: { en: "Base components" },
};

function answer(request: Sent) {
  if (request.path === "/api/data-query/platform/applications/ontology/panel-uses")
    return Response.json({ data: { applicationId: "ontology", entry: { path: "/ontology", renderer: "ontology" }, panelUses: [components] } });
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, {}, request);
  return nothingAt(request);
}

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
});

it("shows a built-in application's entry beside the conversation as that application's page, carrying its page skill", async () => {
  const sent = installPlatform(answer);
  const resolve = pilotPageResolver(vi.fn());
  // Before the catalog is read, nothing names the address; once it lists the entry, the address is that page.
  expect(resolve(components.path)).toBeNull();
  useApplicationCatalog().applications.value = catalogFixture().map((app) => app.id === "ontology" ? { ...app, panelUses: [components] } : app);
  const page = resolve(components.path)!;
  expect(page.props).toMatchObject({ applicationId: "ontology" });

  const router = createRouter({ history: createMemoryHistory(), routes: [{ ...platformRoutes.chat, component: { render: () => null } }] });
  await router.push({ path: platformRoutes.chat.path, query: { page: components.path } });
  const skills: PageSkillContext[] = [];
  const beside = mountPlatformPage(() => h(page.component, { ...page.props, onDisplaySkill: (context: PageSkillContext) => skills.push(context) }), router);
  try {
    await vi.waitFor(() => expect(beside.element.querySelector(".panel-host-coded")).not.toBeNull());
    // The panel is read as that application's use, for its own page: the skill a message beside it reaches.
    expect(sent.some(request => request.path === `/api/product-panels/${panel.id}` && request.search.includes("applicationId=ontology"))).toBe(true);
    await vi.waitFor(() => expect(skills.length).toBeGreaterThan(0));
  } finally {
    beside.app.unmount();
  }
});
