import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import ShellSidebar from "../components/ShellSidebar.vue";
import { shellContextKey, type ShellContext } from "../context";
import type { ShellLabels, ShellWorkbenchDeclaration } from "../types";

const workbench: ShellWorkbenchDeclaration = {
  id: "business",
  label: "Agent Platform",
  features: [
    { id: "dashboards", label: "Dashboards", icon: "dashboard", availability: "page" },
    { id: "ontology-service", label: "Ontology Service", icon: "ontology", availability: "link", href: "/ontology-manager/" },
  ],
};

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

async function render(labels: Partial<ShellLabels>) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp({
    render: () =>
      h(ShellSidebar, {
        workbench,
        agents: [],
        agentId: null,
        sessions: [],
        sessionsState: "ready",
        hasMore: false,
        sessionId: null,
        featureId: null,
      }),
  });
  app.provide(shellContextKey, { labels: ref(labels as ShellLabels) } as unknown as ShellContext);
  app.mount(root);
  await nextTick();
  return root;
}

/** Link features leave the conversation for another application: always a new tab, marked as such. */
describe("navigation links", () => {
  it("open their page in a new tab with an external-link mark", async () => {
    const root = await render({ opensInNewTab: "Opens in a new tab" });
    const link = [...root.querySelectorAll<HTMLAnchorElement>("a.nav-item")].find((a) => a.textContent?.includes("Ontology Service"));
    expect(link?.getAttribute("href")).toBe("/ontology-manager/");
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toContain("noopener");
    const mark = link?.querySelector(".external-mark");
    expect(mark?.getAttribute("aria-label")).toBe("Opens in a new tab");
    // Page features stay in the workbench and carry no mark.
    const page = [...root.querySelectorAll("button.nav-item")].find((b) => b.textContent?.includes("Dashboards"));
    expect(page?.querySelector(".external-mark")).toBeNull();
  });

  it("keep the mark decorative when the host gives it no name", async () => {
    const root = await render({});
    expect(root.querySelector(".external-mark")?.getAttribute("aria-hidden")).toBe("true");
  });
});
