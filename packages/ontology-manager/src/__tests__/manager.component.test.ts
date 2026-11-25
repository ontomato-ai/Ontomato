import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, type App } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { managerRoutes } from "../routes";

const mountedApps: App[] = [];

afterEach(() => {
  mountedApps.splice(0).forEach((app) => app.unmount());
  document.body.innerHTML = "";
});

async function mountRedirects(initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      ...managerRoutes(),
      { path: "/browser/data", component: { render: () => h("p", "data-browser-panel") } },
      { path: "/browser/views", component: { render: () => h("p", "object-detail-panel") } },
      { path: "/ontology/objects", component: { render: () => h("p", "ontology-objects-panel") } },
    ],
  });
  await router.push(initialPath);
  await router.isReady();
  const app = createApp({ render: () => h(RouterView) });
  app.use(router);
  const el = document.createElement("div");
  document.body.append(el);
  app.mount(el);
  mountedApps.push(app);
  return { router, el };
}

describe("Manager legacy routes in the service router", () => {
  it("redirects legacy object view and view editor routes to the new panel destinations", async () => {
    const viewHost = await mountRedirects("/browser/views/Order?key=001");
    expect(viewHost.router.currentRoute.value.fullPath).toBe("/browser/views?selected=Order~001");

    const editorHost = await mountRedirects("/ontology/objects/Order/view");
    expect(editorHost.router.currentRoute.value.fullPath).toBe("/ontology/objects?selected=Order");

    const legacyEditHost = await mountRedirects("/views/Order?edit=true");
    expect(legacyEditHost.router.currentRoute.value.fullPath).toBe("/ontology/objects?selected=Order");

    const legacyDetailHost = await mountRedirects("/views/Order?key=002&from=workspace");
    expect(legacyDetailHost.router.currentRoute.value.fullPath).toBe(
      "/browser/views?selected=Order~002&returnTo=workspace",
    );
  });

  it("redirects legacy /browser/data/:className and /data paths to the data-browser panel with deep-link state", async () => {
    const classHost = await mountRedirects("/browser/data/Order");
    expect(classHost.router.currentRoute.value.fullPath).toBe(
      "/browser/data?selectedClass=Order&viewMode=table",
    );

    const graphModeHost = await mountRedirects("/browser/data/Order?viewMode=graph");
    expect(graphModeHost.router.currentRoute.value.fullPath).toBe(
      "/browser/data?selectedClass=Order&viewMode=graph",
    );

    const legacyDataHost = await mountRedirects("/data");
    expect(legacyDataHost.router.currentRoute.value.fullPath).toBe("/browser/data");

    const legacyDataClassHost = await mountRedirects("/data/Customer");
    expect(legacyDataClassHost.router.currentRoute.value.fullPath).toBe(
      "/browser/data?selectedClass=Customer&viewMode=table",
    );
  });
});
