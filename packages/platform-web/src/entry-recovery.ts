import type { Plugin } from "vite";

const RELOAD_KEY = "ontomato_stale_entry_reload";
const UPDATE_MESSAGE = "页面版本已更新，请刷新";
const RELOAD_BUTTON_LABEL = "刷新页面";

/**
 * Inline head script injected into built and dev entry documents.
 *
 * Covers the whole entry module graph (the entry module script, its static chunk imports,
 * modulepreloads, and entry stylesheets). When any part of that graph fails with 404/502 or fails
 * to mount `#app` before `load` (cases where `vite:preloadError` never fires), this listener
 * fetches the latest index.html once with HTTP cache bypass, reloads once, and otherwise renders
 * a visible refresh prompt instead of leaving a blank screen.
 */
export const ENTRY_RECOVERY_SCRIPT = `(function () {
  var RELOAD_KEY = ${JSON.stringify(RELOAD_KEY)};
  var UPDATE_MESSAGE = ${JSON.stringify(UPDATE_MESSAGE)};
  var RELOAD_BUTTON_LABEL = ${JSON.stringify(RELOAD_BUTTON_LABEL)};
  var handled = false;

  function isAppMounted() {
    var root = document.getElementById("app");
    return Boolean(root && root.childElementCount > 0);
  }

  function failedEntryResource(target) {
    if (!target || !target.tagName) return null;
    var tag = target.tagName.toUpperCase();
    if (tag === "SCRIPT") {
      var src = target.getAttribute("src") || "";
      if (!src) return null;
      return target.type === "module" || /(?:^|\\/)assets\\//.test(src) ? src : null;
    }
    if (tag === "LINK") {
      var rel = (target.getAttribute("rel") || "").toLowerCase();
      var href = target.getAttribute("href") || "";
      if (!href) return null;
      return (rel === "stylesheet" || rel === "modulepreload") && /(?:^|\\/)assets\\//.test(href)
        ? href
        : null;
    }
    return null;
  }

  function readReloadMark() {
    try {
      return window.sessionStorage.getItem(RELOAD_KEY);
    } catch (_error) {
      return "__unavailable__";
    }
  }

  function writeReloadMark(value) {
    try {
      window.sessionStorage.setItem(RELOAD_KEY, value);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function clearReloadMark() {
    try {
      window.sessionStorage.removeItem(RELOAD_KEY);
    } catch (_error) {
      // Ignore storage errors when clearing the retry marker.
    }
  }

  function showUpdatePrompt() {
    var render = function () {
      if (isAppMounted()) return;
      if (document.getElementById("ontomato-stale-entry-notice")) return;
      var target = document.getElementById("app") || document.body;
      if (!target) return;
      var isDark = document.documentElement.classList.contains("dark");
      var wrap = document.createElement("div");
      wrap.id = "ontomato-stale-entry-notice";
      wrap.setAttribute("role", "alert");
      wrap.style.cssText =
        "min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif;" +
        (isDark ? "background:#111315;color:#f3f4f6;" : "background:#f9fafb;color:#111827;");
      var card = document.createElement("div");
      card.style.cssText =
        "max-width:420px;text-align:center;padding:24px 28px;border-radius:12px;" +
        (isDark ? "background:#1b1f24;border:1px solid #2c323b;" : "background:#ffffff;border:1px solid #e5e7eb;");
      var text = document.createElement("p");
      text.style.cssText = "margin:0 0 16px;font-size:15px;line-height:1.6;";
      text.textContent = UPDATE_MESSAGE;
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = RELOAD_BUTTON_LABEL;
      button.style.cssText =
        "padding:8px 18px;font-size:14px;border-radius:8px;border:none;cursor:pointer;" +
        (isDark ? "background:#f3f4f6;color:#111315;" : "background:#111827;color:#ffffff;");
      button.addEventListener("click", function () {
        clearReloadMark();
        window.location.reload();
      });
      card.appendChild(text);
      card.appendChild(button);
      wrap.appendChild(card);
      target.appendChild(wrap);
    };
    if (document.body) {
      render();
    } else {
      document.addEventListener("DOMContentLoaded", render, { once: true });
    }
  }

  function triggerRecovery() {
    if (handled || isAppMounted()) return;
    handled = true;

    if (readReloadMark() || !writeReloadMark("1")) {
      showUpdatePrompt();
      return;
    }

    if (typeof window.fetch !== "function") {
      window.location.reload();
      return;
    }

    var entryUrl = window.location.pathname + window.location.search;
    window.fetch(entryUrl, { cache: "reload", credentials: "same-origin" })
      .then(function (response) {
        if (!response || !response.ok) {
          showUpdatePrompt();
          return;
        }
        window.location.reload();
      })
      .catch(function () {
        showUpdatePrompt();
      });
  }

  window.addEventListener(
    "error",
    function (event) {
      if (handled || isAppMounted()) return;
      if (!failedEntryResource(event.target)) return;
      triggerRecovery();
    },
    true,
  );

  window.addEventListener("load", function () {
    if (handled) return;
    if (isAppMounted()) {
      clearReloadMark();
      return;
    }
    if (document.getElementById("app")) {
      triggerRecovery();
    }
  });
})();`;

/** Injects the stale-entry recovery script into Vite entry documents before bundled module tags. */
export function entryRecoveryPlugin(): Plugin {
  return {
    name: "ontomato-entry-recovery",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return {
          html,
          tags: [
            {
              tag: "script",
              injectTo: "head",
              children: ENTRY_RECOVERY_SCRIPT,
            },
          ],
        };
      },
    },
  };
}
