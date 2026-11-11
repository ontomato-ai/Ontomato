import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { platformLayoutRoute } from "../layout-route";
import { platformRoutes } from "@ontomato/platform-shell/routes";

describe("platform root landing", () => {
  it("redirects the root to the home even with an empty-path manager frame", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [platformLayoutRoute([
        { ...platformRoutes.chat, component: RouterView },
        { path: "", component: RouterView, children: [
          { path: "/ontology/objects", component: RouterView },
        ] },
      ])],
    });
    await router.push("/");
    expect(router.currentRoute.value.path).toBe("/home");
    await router.push("/ontology/objects");
    expect(router.currentRoute.value.path).toBe("/ontology/objects");
  });
});
