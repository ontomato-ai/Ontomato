import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";

/** Component double: records the props the shell hands to the component and can emit events on its behalf. */
const host = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  emit: null as ((event: string, ...args: unknown[]) => void) | null,
}));

// The whole component is doubled (it has its own tests); this file only checks the props the shell hands over, the header
// controls it puts into the component header, how component events are handled, and the status messages used.
vi.mock("@ontomato/ontology-manager", async () => {
  const { defineComponent, h } = await import("vue");
  const OntologyManager = defineComponent({
    props: {
      apiBase: { type: String, required: true },
      credential: { type: Object, required: true },
      locale: { type: String, required: true },
      messages: { type: Object, required: true },
      theme: { type: String, required: true },
      view: { type: String, required: true },
      dataFallbacks: { type: Object, required: true },
      presentation: { type: Object, required: true },
      knowledgeTagValues: { type: Object, required: true },
    },
    emits: ["update:view", "auth-failure"],
    setup(props, { emit, slots }) {
      host.props = props;
      host.emit = emit as typeof host.emit;
      return () => h("div", { class: "manager-double" }, slots["header-actions"]?.());
    },
  });
  return { OntologyManager };
});

const { englishMessages } = await import("@ontomato/ontology-manager/i18n");
const { isolateShellPerTest } = await import("./isolation");
const { ossProfile } = await import("../profile");
const { ossPresentation } = await import("../presentation");
const { startManagerShell } = await import("../shell");

const resetShell = isolateShellPerTest();

function start(url: string, extra: Parameters<typeof startManagerShell>[1] = { credential: { type: "anonymous" } }) {
  host.props = null;
  resetShell();
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState({}, "", url);
  startManagerShell(ossProfile, extra);
}

describe("open-source standalone shell", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.lang = "en";
    window.__ONTOLOGY_MANAGER_CONFIG__ = { API_BASE: "/custom-base/api/", INITIAL_ROUTE: "" };
  });

  it("hands the host credential, fixed en with English messages, open-source data defaults and apiBase from config.js", () => {
    start("/?view=assets");
    expect(host.props).toMatchObject({
      // A relative or root-relative API_BASE resolves against the page URL, so one image serves any gateway prefix.
      apiBase: new URL("/custom-base/api", window.location.href).href,
      credential: { type: "anonymous" },
      locale: "en",
      messages: englishMessages,
      theme: "light",
      view: "/assets/metrics",
      dataFallbacks: {
        noBusinessDescription: "No business description provided",
        unnamedAsset: "Unnamed asset",
      },
    });
    expect(host.props?.knowledgeTagValues).toEqual({
      general: "General",
      business: "Business",
      tech: "Tech",
    });
    // Open-source presentation values (b6437c86): the same static object is handed to the component.
    expect(host.props?.presentation).toBe(ossPresentation);
    expect(host.props).not.toHaveProperty("embedded");
  });

  it("an old launch link loses only tk/apiKey and never becomes a credential; an old tab session is dropped", () => {
    sessionStorage.setItem("ontology_manager_token", "old-token");
    sessionStorage.setItem("ontology_manager_api_key", "old-key");
    start("/?view=data-browser&tk=t1&apiKey=k1&theme=dark#/data");
    expect(host.props?.credential).toEqual({ type: "anonymous" });
    expect(window.location.search).toBe("?view=data-browser&theme=dark");
    expect(window.location.hash).toBe("#/data");
    expect(sessionStorage.getItem("ontology_manager_token")).toBeNull();
    expect(sessionStorage.getItem("ontology_manager_api_key")).toBeNull();
  });

  it("URL theme/locale and the workbench preference keys do not drive the Manager", () => {
    localStorage.setItem("theme-preference", "dark");
    localStorage.setItem("app-locale", "zh-CN");
    start("/?theme=dark&locale=zh-CN");
    expect(host.props?.theme).toBe("light");
    expect(host.props?.locale).toBe("en");
  });

  it("the header shows the theme control and, with one locale, no language control; the theme is stored under the Manager key", async () => {
    start("/");
    expect(document.querySelector(".manager-shell-locale")).toBeNull();
    const toggle = document.querySelector<HTMLButtonElement>(".manager-shell-theme")!;
    expect(toggle.textContent).toBe("Dark Mode");
    toggle.click();
    await nextTick();
    expect(host.props?.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("ontology_manager_theme")).toBe("dark");
    expect(localStorage.getItem("theme-preference")).toBeNull();
    expect(document.querySelector(".manager-shell-theme")?.textContent).toBe("Light Mode");
  });

  it("host header actions follow the shell controls and receive the current messages", () => {
    const received: unknown[] = [];
    const Account = defineComponent({
      props: { messages: { type: Object, required: true } },
      setup(props) {
        received.push(props.messages);
        return () => h("span", { class: "account-double" });
      },
    });
    start("/", { credential: { type: "token", token: "t1" }, headerActions: Account });
    expect(host.props?.credential).toEqual({ type: "token", token: "t1" });
    expect(document.querySelector(".manager-shell-controls + .account-double")).not.toBeNull();
    expect(received).toEqual([englishMessages]);
  });

  it("component navigation replaces the hash", async () => {
    start("/");
    const length = window.history.length;
    host.emit?.("update:view", "/objects/Order");
    await nextTick();
    expect(host.props?.view).toBe("/objects/Order");
    expect(window.location.hash).toBe("#/objects/Order");
    expect(window.history.length).toBe(length);
  });

  it("without a host handler a 401 stops the component and reports it; a 402 keeps the component", async () => {
    start("/");
    host.emit?.("auth-failure", 402);
    await nextTick();
    expect(document.querySelector(".manager-double")).not.toBeNull();
    host.emit?.("auth-failure", 401);
    await nextTick();
    expect(document.querySelector(".manager-double")).toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Request failed (401)");
  });

  it("a host handler decides 401 and 402 itself", async () => {
    const failures: number[] = [];
    start("/", { credential: { type: "token", token: "t1" }, onAuthFailure: (status) => failures.push(status) });
    host.emit?.("auth-failure", 401);
    host.emit?.("auth-failure", 402);
    await nextTick();
    expect(failures).toEqual([401, 402]);
    expect(document.querySelector(".manager-double")).not.toBeNull();
  });
});
