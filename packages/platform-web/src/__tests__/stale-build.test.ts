import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ElNotification } from "element-plus";
import { reloadOnStaleBuild } from "../stale-build";

vi.mock("@ontomato/workbench-ui/i18n", () => ({ t: (key: string) => key }));

let stop: () => void;
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.spyOn(window.location, "reload").mockImplementation(() => {});
  stop = reloadOnStaleBuild();
});

afterEach(() => {
  stop();
  ElNotification.closeAll();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.restoreAllMocks();
});

function failLazyImport() {
  const event = new Event("vite:preloadError", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

it("preserves the mounted conversation and allows a manual reload after a lazy import fails", () => {
  const root = document.getElementById("app")!;
  root.setAttribute("data-v-app", "");
  root.innerHTML = '<textarea></textarea>';
  const draft = root.querySelector("textarea")!;
  draft.value = "Follow-up question";

  expect(failLazyImport().defaultPrevented).toBe(false);
  failLazyImport();
  expect(window.location.reload).not.toHaveBeenCalled();
  expect(root.querySelector("textarea")).toBe(draft);
  expect(draft.value).toBe("Follow-up question");
  expect(document.querySelectorAll('[role="alert"] button')).toHaveLength(1);

  document.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
  expect(window.location.reload).toHaveBeenCalledOnce();
});

it("recovers automatically once when the entry has not mounted", () => {
  expect(failLazyImport().defaultPrevented).toBe(true);
  expect(failLazyImport().defaultPrevented).toBe(false);
  expect(window.location.reload).toHaveBeenCalledOnce();
});
