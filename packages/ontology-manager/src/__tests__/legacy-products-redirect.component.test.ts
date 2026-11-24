import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, type App } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { productAssetSchema } from "@ontomato/contracts/product-assets";
import { managerNavigation } from "../navigation";
import { managerStandaloneRoutes } from "../routes";
import { installObjectViewHost } from "./object-view-host";

let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function settle() {
  for (let index = 0; index < 10; index++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function asset(id: string, document: Record<string, unknown>) {
  return productAssetSchema.parse({
    id,
    name: id,
    description: "",
    ownerId: "author",
    visibility: "domain",
    revision: 1,
    editable: false,
    createdAt: "2026-11-24T00:00:00.000Z",
    updatedAt: "2026-11-24T00:00:00.000Z",
    document,
  });
}

async function mountStandalone(initialAddress: string, fetchImpl?: (url: string) => Promise<Response>) {
  if (fetchImpl) {
    vi.stubGlobal("fetch", fetchImpl);
  }
  const history = createMemoryHistory();
  const router = createRouter({
    history,
    routes: [
      ...managerStandaloneRoutes(),
      { path: "/ontology/panels", component: { template: '<div class="dest">panels</div>' } },
      { path: "/ontology/projections", component: { template: '<div class="dest">projections</div>' } },
      { path: "/ontology/applications", component: { template: '<div class="dest">applications</div>' } },
      { path: "/ontology/applications/detail", component: { template: '<div class="dest">application-detail</div>' } },
      { path: "/ontology/agents", component: { template: '<div class="dest">agents</div>' } },
      { path: "/home", component: { template: '<div class="dest">home</div>' } },
    ],
  });

  // Simulate a strict page guard: any route carrying a `meta.page` listed in navigation is denied.
  const navigation = managerNavigation();
  router.beforeEach((to) => {
    const listed = navigation.pages.find((page) => page.path === to.meta.page);
    if (listed) return "/home";
    return true;
  });

  const element = document.createElement("div");
  document.body.append(element);
  app = createApp(defineComponent({ setup: () => () => h(RouterView) }));
  installObjectViewHost(app);
  app.use(router);
  await router.push(initialAddress);
  await router.isReady();
  app.mount(element);
  await settle();
  return { router, history };
}

describe("retired /ontology/products redirect routes", () => {
  it("omits /ontology/products from manager navigation and sets no meta.page on redirect routes", () => {
    const navigation = managerNavigation();
    expect(navigation.pages.some((page) => page.path === "/ontology/products")).toBe(false);
    const productRoutes = managerStandaloneRoutes().filter((route) => route.path.startsWith("/ontology/products"));
    expect(productRoutes).toHaveLength(2);
    for (const route of productRoutes) {
      expect(route.meta?.page).toBeUndefined();
    }
  });

  it.each([
    ["/ontology/products", "/ontology/panels"],
    ["/ontology/products?kind=projection", "/ontology/projections"],
    ["/ontology/products?create=projection", "/ontology/projections"],
    ["/ontology/products?kind=metric-widget&search=revenue", "/ontology/projections?search=revenue"],
    ["/ontology/products?create=object-projection&search=orders", "/ontology/projections?search=orders"],
    ["/ontology/products?kind=application", "/ontology/applications"],
    ["/ontology/products?create=application&search=hr", "/ontology/applications?search=hr"],
    ["/ontology/products?kind=agent", "/ontology/agents"],
    ["/ontology/products?create=profile", "/ontology/agents"],
    ["/ontology/products?kind=agent-profile&search=ignored", "/ontology/agents"],
    ["/ontology/products?kind=page&search=home", "/ontology/panels?search=home"],
    ["/ontology/products?kind=widget", "/ontology/panels"],
    ["/ontology/products?kind=widget-group", "/ontology/panels"],
    ["/ontology/products?kind=navigation", "/ontology/panels"],
    ["/ontology/products?kind=unknown", "/ontology/panels"],
    ["/ontology/products?kind=unknown&search=foo", "/ontology/panels?search=foo"],
  ])("redirects directory/create address %s to %s without fetching", async (from, expected) => {
    const fetched = vi.fn();
    const { router } = await mountStandalone(from, fetched);
    expect(router.currentRoute.value.fullPath).toBe(expected);
    expect(fetched).not.toHaveBeenCalled();
  });

  it.each([
    [
      "/ontology/products/proj-1",
      asset("proj-1", { kind: "object-projection", renders: { kind: "ObjectType", id: "Order" }, renderer: "summary", fields: ["id"] }),
      "/ontology/projections?selected=proj-1",
    ],
    [
      "/ontology/products?id=proj-2",
      asset("proj-2", { kind: "metric-widget", renders: { kind: "MetricView", id: "sales" }, renderer: "number", parameters: {}, valueField: "total" }),
      "/ontology/projections?selected=proj-2",
    ],
    [
      "/ontology/products/platform-application-0123456789abcdef01234567",
      asset("platform-application-0123456789abcdef01234567", { kind: "application", applicationId: "hr-portal", children: [] }),
      "/ontology/applications/detail?selected=hr-portal",
    ],
    [
      "/ontology/products/app-custom-1",
      asset("app-custom-1", { kind: "application", applicationId: "app-custom-1", children: [] }),
      "/ontology/applications/detail?selected=app-custom-1",
    ],
    [
      "/ontology/products/default-agent-profile-11111111-1111-4111-8111-111111111111",
      asset("default-agent-profile-11111111-1111-4111-8111-111111111111", {
        kind: "agent-profile",
        agentId: "11111111-1111-4111-8111-111111111111",
        instructions: "",
        tools: [],
        contextViews: [],
      }),
      "/ontology/agents?selected=11111111-1111-4111-8111-111111111111",
    ],
    [
      "/ontology/products/page-42",
      asset("page-42", { kind: "page", children: [] }),
      "/ontology/panels?selected=page-42",
    ],
  ])("resolves single record %s to %s using its loaded document kind", async (from, loaded, expected) => {
    const { router } = await mountStandalone(from, async (url) => {
      expect(url).toContain("/product-assets/");
      return Response.json({ asset: loaded });
    });
    expect(router.currentRoute.value.fullPath).toBe(expected);
  });

  it.each([
    [403, "/ontology/products/secret-panel", "/ontology/panels?selected=secret-panel"],
    [404, "/ontology/products/missing-panel", "/ontology/panels?selected=missing-panel"],
    [403, "/ontology/products/secret-proj?kind=projection", "/ontology/projections?selected=secret-proj"],
    [404, "/ontology/products/platform-application-hr-portal", "/ontology/applications/detail?selected=hr-portal"],
    [403, "/ontology/products/default-agent-profile-agent-9", "/ontology/agents?selected=agent-9"],
    [404, "/ontology/products/platform-agent-agent-7", "/ontology/agents?selected=agent-7"],
  ])("locates %s even when GET /api/product-assets/:id responds %i -> %s", async (status, from, expected) => {
    const { router } = await mountStandalone(from, async () =>
      Response.json({ error: { message: "Denied or missing" } }, { status }),
    );
    expect(router.currentRoute.value.fullPath).toBe(expected);
  });

  it("ignores stale responses when navigating away before lookup settles", async () => {
    let releaseFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const { router } = await mountStandalone("/ontology/products/slow-proj", async (url) => {
      if (url.endsWith("/product-assets/slow-proj")) return firstResponse;
      return Response.json({ error: { message: "not found" } }, { status: 404 });
    });

    await router.push("/home");
    await settle();
    expect(router.currentRoute.value.fullPath).toBe("/home");

    releaseFirst(Response.json({
      asset: asset("slow-proj", { kind: "object-projection", renders: { kind: "ObjectType", id: "Order" }, renderer: "summary", fields: ["id"] }),
    }));
    await settle();
    expect(router.currentRoute.value.fullPath).toBe("/home");
  });
});
