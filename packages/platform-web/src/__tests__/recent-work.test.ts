import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { recentWorkInputSchema } from "@ontomato/contracts/personal-workspace";
import { recentDestination } from "../recent-work";

describe("recent business destinations", () => {
  it("retains the object view primary key so the saved link reopens the same object", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/browser/views/:className", component: { template: "<div />" } }] });
    await router.push({ path: "/browser/views/Person", query: { key: "person:1", token: "secret" } });
    expect(recentDestination(router.currentRoute.value, { id: "browser", label: "Objects", prefix: "/browser", icon: "objects" })?.path).toBe("/browser/views/Person?key=person%3A1");
  });
  it("keeps resumable parameters and discards credentials and unrelated query strings", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/agents/chat", component: { template: "<div />" } }] });
    await router.push("/agents/chat?sessionId=conversation&apiKey=secret&token=secret#details");
    expect(recentDestination(router.currentRoute.value, { id: "agents", label: "Assistant", prefix: "/agents", icon: "agents" }))
      .toEqual({ appId: "agents", title: "Assistant", path: "/agents/chat?sessionId=conversation" });
  });
  it.each(["//example.com", "/%2fexample.com", "/agents/chat?token=secret", "/agents/chat#secret", "/%5cexample.com"])("rejects unsafe stored destinations: %s", path => {
    expect(recentWorkInputSchema.safeParse({ appId: "agents", title: "Assistant", path }).success).toBe(false);
  });
  it("records hosted applications at their catalog route and excludes settings", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
    await router.push("/applications/orders");
    expect(recentDestination(router.currentRoute.value, { id: "orders", label: "Orders", prefix: "/applications/orders", icon: "pages" })?.path).toBe("/applications/orders");
    await router.push("/settings/model-config");
    expect(recentDestination(router.currentRoute.value, { id: "settings", label: "Settings", prefix: "/settings", icon: "pages" })).toBeNull();
  });
});
