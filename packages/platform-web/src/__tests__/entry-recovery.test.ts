import { afterEach, describe, expect, it, vi } from "vitest";
import { entryRecoveryPlugin } from "../entry-recovery";

const trackedCleanup: Array<() => void> = [];

function installRecoveryScript() {
  const plugin = entryRecoveryPlugin();
  const hook = plugin.transformIndexHtml!;
  const handler = typeof hook === "function" ? hook : "handler" in hook ? hook.handler : hook.transform;
  const result = handler.call(
    {} as never,
    '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
    { path: "/index.html", filename: "index.html" },
  );
  const scriptTag = Array.isArray(result)
    ? result[0]
    : result && typeof result === "object" && "tags" in result
      ? result.tags?.[0]
      : undefined;
  expect(scriptTag?.tag).toBe("script");
  expect(typeof scriptTag?.children).toBe("string");

  // Track listeners registered by the inline script so multi-step reload simulations stay isolated.
  const origAdd = window.addEventListener.bind(window);
  const added: Array<[string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]> = [];
  window.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    added.push([type, listener, options]);
    return origAdd(type, listener, options);
  }) as typeof window.addEventListener;

  try {
    document.documentElement.innerHTML = '<head></head><body><div id="app"></div></body>';
    window.eval(String(scriptTag!.children));
  } finally {
    window.addEventListener = origAdd;
  }

  const cleanup = () => {
    for (const [type, listener, options] of added) {
      window.removeEventListener(type, listener, options);
    }
  };
  trackedCleanup.push(cleanup);
  return cleanup;
}

function dispatchResourceError(el: HTMLElement, attrs?: Record<string, string>) {
  document.head.appendChild(el);
  if (attrs) {
    vi.spyOn(el, "getAttribute").mockImplementation((name) => attrs[name] ?? null);
  }
  el.dispatchEvent(new Event("error"));
}

afterEach(() => {
  while (trackedCleanup.length > 0) {
    trackedCleanup.pop()?.();
  }
  sessionStorage.clear();
  document.documentElement.innerHTML = "";
  vi.restoreAllMocks();
});

describe("stale entry script recovery", () => {
  it("fetches latest index.html with cache bypass and reloads once when entry module script fails", async () => {
    const reloadSpy = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response('<!doctype html><script type="module" src="./assets/index-new.js"></script>', { status: 200 }),
    );

    installRecoveryScript();

    const script = document.createElement("script");
    script.type = "module";
    dispatchResourceError(script, { src: "./assets/index-old.js" });

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ cache: "reload", credentials: "same-origin" });
  });

  it("recovers once when entry index-*.js returns 200 but a static import chunk fails (502/404) leaving #app empty", async () => {
    const reloadSpy = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response('<!doctype html><script type="module" src="./assets/index-200.js"></script>', { status: 200 }),
    );

    // Case A: static chunk preload error or module graph failure triggers on window load with empty #app.
    const cleanupFirst = installRecoveryScript();
    window.dispatchEvent(new Event("load"));

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
    cleanupFirst();

    // Case B: after the single reload, #app is still empty on load -> show visible notice instead of looping.
    fetchSpy.mockClear();
    reloadSpy.mockClear();
    installRecoveryScript();
    window.dispatchEvent(new Event("load"));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(document.querySelector("#app")?.textContent).toContain("页面版本已更新，请刷新");
  });

  it("shows a visible update notice instead of looping when entry still fails after the retry", async () => {
    const reloadSpy = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response('<!doctype html><script type="module" src="./assets/index-new.js"></script>', { status: 200 }),
    );

    const cleanupFirst = installRecoveryScript();
    const first = document.createElement("script");
    first.type = "module";
    dispatchResourceError(first, { src: "./assets/index-old.js" });

    await vi.waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    cleanupFirst();

    fetchSpy.mockClear();
    reloadSpy.mockClear();
    installRecoveryScript();
    const second = document.createElement("script");
    second.type = "module";
    dispatchResourceError(second, { src: "./assets/index-new.js" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(document.querySelector("#app")?.textContent).toContain("页面版本已更新，请刷新");
  });

  it("shows the update notice immediately when fetching latest index.html fails (502 or network error)", async () => {
    const reloadSpy = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("bad gateway", { status: 502 }));

    const cleanupFirst = installRecoveryScript();
    const script = document.createElement("script");
    script.type = "module";
    dispatchResourceError(script, { src: "./assets/index-old.js" });

    await vi.waitFor(() => {
      expect(document.querySelector("#app")?.textContent).toContain("页面版本已更新，请刷新");
    });
    expect(reloadSpy).not.toHaveBeenCalled();
    cleanupFirst();

    sessionStorage.clear();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    installRecoveryScript();
    const script2 = document.createElement("script");
    script2.type = "module";
    dispatchResourceError(script2, { src: "./assets/index-old.js" });

    await vi.waitFor(() => {
      expect(document.querySelector("#app")?.textContent).toContain("页面版本已更新，请刷新");
    });
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("ignores non-entry resources and errors after the app has already mounted", async () => {
    const reloadSpy = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    installRecoveryScript();

    const img = document.createElement("img");
    dispatchResourceError(img, { src: "./assets/missing.png" });

    const root = document.getElementById("app")!;
    root.innerHTML = "<main>mounted</main>";
    const laterScript = document.createElement("script");
    laterScript.type = "module";
    dispatchResourceError(laterScript, { src: "./assets/chunk-123.js" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(root.textContent).toBe("mounted");
  });

  it("clears the retry marker once a page finishes loading cleanly", async () => {
    const reloadSpy = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response('<!doctype html><script type="module" src="./assets/index-new.js"></script>', { status: 200 }),
    );

    const cleanupFirst = installRecoveryScript();
    const first = document.createElement("script");
    first.type = "module";
    dispatchResourceError(first, { src: "./assets/index-old.js" });
    await vi.waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    cleanupFirst();

    // Next load succeeds: mount #app and dispatch window load.
    const cleanupSecond = installRecoveryScript();
    document.getElementById("app")!.innerHTML = "<main>ok</main>";
    window.dispatchEvent(new Event("load"));
    cleanupSecond();

    // Subsequent deployment failure in the same tab can auto-recover again.
    fetchSpy.mockClear();
    reloadSpy.mockClear();
    installRecoveryScript();
    const next = document.createElement("script");
    next.type = "module";
    dispatchResourceError(next, { src: "./assets/index-next.js" });
    await vi.waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
  });

  it("also recovers on stale entry stylesheet/modulepreload errors and supports manual refresh from the prompt", async () => {
    const reloadSpy = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response('<!doctype html><link rel="stylesheet" href="./assets/index-new.css">', { status: 200 }),
    );

    const cleanupFirst = installRecoveryScript();
    const css = document.createElement("link");
    dispatchResourceError(css, { rel: "stylesheet", href: "./assets/index-old.css" });

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
    cleanupFirst();

    reloadSpy.mockClear();
    installRecoveryScript();
    const preload = document.createElement("link");
    preload.setAttribute("rel", "modulepreload");
    preload.setAttribute("href", "./assets/index-old.js");
    dispatchResourceError(preload);

    const button = document.querySelector("#ontomato-stale-entry-notice button") as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    button!.click();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("ontomato_stale_entry_reload")).toBeNull();
  });
});
