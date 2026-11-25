import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { recentWorkInputSchema } from "@ontomato/contracts/personal-workspace";
import { createRecentVisitReporter, RECENT_VISIT_SETTLE_MS, recentDestination } from "../recent-work";

describe("recent business destinations", () => {
  it("retains the object view primary key so the saved link reopens the same object", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/browser/views/:className", component: { template: "<div />" } }] });
    await router.push({ path: "/browser/views/Person", query: { key: "person:1", token: "secret" } });
    expect(recentDestination(router.currentRoute.value, { id: "browser", label: "Objects", prefix: "/browser", icon: "objects", category: "business" })?.path).toBe("/browser/views/Person?key=person%3A1");
  });
  it("keeps resumable parameters and discards credentials and unrelated query strings", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/agents/chat", component: { template: "<div />" } }] });
    await router.push("/agents/chat?sessionId=conversation&apiKey=secret&token=secret#details");
    expect(recentDestination(router.currentRoute.value, { id: "agents", label: "Assistant", prefix: "/agents", icon: "agents", category: "business" }))
      .toEqual({ appId: "agents", title: "Assistant", path: "/agents/chat?sessionId=conversation" });
  });
  it.each(["//example.com", "/%2fexample.com", "/agents/chat?token=secret", "/agents/chat#secret", "/%5cexample.com"])("rejects unsafe stored destinations: %s", path => {
    expect(recentWorkInputSchema.safeParse({ appId: "agents", title: "Assistant", path }).success).toBe(false);
  });
  it("records hosted applications at their catalog route and excludes settings", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
    await router.push("/applications/orders");
    expect(recentDestination(router.currentRoute.value, { id: "orders", label: "Orders", prefix: "/applications/orders", icon: "pages", category: "business" })?.path).toBe("/applications/orders");
    await router.push("/settings/model-config");
    expect(recentDestination(router.currentRoute.value, { id: "settings", label: "Settings", prefix: "/settings", icon: "pages", category: "admin" })).toBeNull();
  });

  it("skips the bare root of a panel application and reports a redirect-and-state chain only once with the final destination", async () => {
    vi.useFakeTimers();
    try {
      const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
      const app = { id: "app-relations", label: "Relations", prefix: "/applications/app-relations", icon: "pages", category: "business" as const };
      const sent: string[] = [];
      const reporter = createRecentVisitReporter((payload) => sent.push(payload));

      // Step 1: bare panel application root redirects immediately and must not be recorded.
      await router.push("/applications/app-relations");
      const rootDest = recentDestination(router.currentRoute.value, app, { panelApplication: true });
      expect(rootDest).toBeNull();
      reporter.schedule(rootDest ? JSON.stringify(rootDest) : null);

      // Step 2: lands on first entry.
      await router.replace("/applications/app-relations/relations");
      const firstEntry = recentDestination(router.currentRoute.value, app, { panelApplication: true });
      expect(firstEntry?.path).toBe("/applications/app-relations/relations");
      reporter.schedule(JSON.stringify(firstEntry));

      // Step 3: panel writes its default selection shortly after landing.
      vi.advanceTimersByTime(50);
      await router.replace("/applications/app-relations/relations?selected=rel-1");
      const settled = recentDestination(router.currentRoute.value, app, { panelApplication: true });
      expect(settled?.path).toBe("/applications/app-relations/relations?selected=rel-1");
      reporter.schedule(JSON.stringify(settled));

      expect(sent).toHaveLength(0);
      vi.advanceTimersByTime(RECENT_VISIT_SETTLE_MS);
      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0]!)).toEqual({
        appId: "app-relations",
        title: "Relations",
        path: "/applications/app-relations/relations?selected=rel-1",
      });

      // Re-scheduling the same settled destination does not send a duplicate POST.
      reporter.schedule(JSON.stringify(settled));
      vi.advanceTimersByTime(RECENT_VISIT_SETTLE_MS);
      expect(sent).toHaveLength(1);
      reporter.cancel();
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});
