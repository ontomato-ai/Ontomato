import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { managerRoutes } from "../routes";

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      ...managerRoutes(),
      { path: "/browser/views", name: "panel-object-detail", component: { template: "<div>detail</div>" } },
      { path: "/ontology/objects", name: "panel-objects", component: { template: "<div>objects</div>" } },
    ],
  });
}

describe("retired object view legacy route redirects", () => {
  it("redirects /ontology/objects/:className/view to /ontology/objects?selected=:className", async () => {
    const router = createTestRouter();
    await router.push("/ontology/objects/Order/view");
    expect(router.currentRoute.value.fullPath).toBe("/ontology/objects?selected=Order");
  });

  it("redirects /views/:className?edit=true to /ontology/objects?selected=:className", async () => {
    const router = createTestRouter();
    await router.push("/views/Order?edit=true");
    expect(router.currentRoute.value.fullPath).toBe("/ontology/objects?selected=Order");
  });

  it("redirects /views/:className?key=... to /browser/views?selected=:className~:key", async () => {
    const router = createTestRouter();
    await router.push("/views/Order?key=order-1");
    expect(router.currentRoute.value.fullPath).toBe("/browser/views?selected=Order~order-1");
  });

  it("redirects /browser/views/:className?key=...&from=workspace to /browser/views?selected=...&returnTo=workspace", async () => {
    const router = createTestRouter();
    await router.push("/browser/views/Order?key=order-1&from=workspace");
    expect(router.currentRoute.value.fullPath).toBe("/browser/views?selected=Order~order-1&returnTo=workspace");
  });
});
