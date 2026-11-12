import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { platformLayoutRoute } from "../layout-route";
import { platformRoutes } from "@ontomato/platform-shell/routes";

describe("platform root landing", () => {
  it("redirects the root to the personal workspace even with an empty-path manager frame", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [platformLayoutRoute([
        { ...platformRoutes.chat, component: RouterView },
        { ...platformRoutes.personalWorkspace, component: RouterView },
        { path: "", component: RouterView, children: [
          { path: "/ontology/objects", component: RouterView },
        ] },
      ])],
    });
    await router.push("/");
    expect(router.currentRoute.value.path).toBe("/workspace");
    await router.push("/agents/chat?sessionId=existing");
    expect(router.currentRoute.value.fullPath).toBe("/agents/chat?sessionId=existing");
    await router.push("/ontology/objects");
    expect(router.currentRoute.value.path).toBe("/ontology/objects");
  });
  it("uses the workspace as the login return destination when entering from the root", async () => {
    let authenticated = false;
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: "/login", component: RouterView },
      platformLayoutRoute([
        { ...platformRoutes.personalWorkspace, component: RouterView, meta: { workbench: true } },
        { ...platformRoutes.chat, component: RouterView, meta: { workbench: true } },
      ]),
    ] });
    router.beforeEach(to => {
      if (!authenticated && to.meta.workbench) return { path: "/login", query: { redirect: to.fullPath } };
    });
    await router.push("/");
    expect(router.currentRoute.value.fullPath).toBe("/login?redirect=/workspace");
    const redirect = String(router.currentRoute.value.query.redirect);
    authenticated = true;
    await router.push(redirect);
    expect(router.currentRoute.value.path).toBe("/workspace");
  });
});
