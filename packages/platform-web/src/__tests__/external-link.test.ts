import { expect, it, vi } from "vitest";
import { ElMessageBox } from "element-plus";
import { clearExternalLinkTab, copyExternalLink, externalLinkOf, externalLinkTab, rememberExternalLinkTab, writeClipboard } from "../external-link";

/*
 * An entry's external link is its own address with the flag (big main's ruling, 2026-11-21): the state the reader is at
 * and anything else the address carries stay as they are, so the link opens the same page in the same state.
 */
it("keeps the entry's address and state, and adds the flag", () => {
  const at = { origin: "https://ontomato.example", pathname: "/app/" };
  const state = encodeURIComponent(JSON.stringify({ selected: { className: "Course", primaryKey: "c1" } }));
  const link = externalLinkOf(`/applications/app-school/orders?frame=%7B%22term%22%3A%22A%22%7D&state=${state}`, at);
  const url = new URL(link);
  expect(url.origin + url.pathname).toBe("https://ontomato.example/app/");
  const [path, search] = url.hash.slice(1).split("?");
  expect(path).toBe("/applications/app-school/orders");
  const query = new URLSearchParams(search);
  expect(query.get("standalone")).toBe("1");
  expect(JSON.parse(query.get("state")!)).toEqual({ selected: { className: "Course", primaryKey: "c1" } });
  expect(JSON.parse(query.get("frame")!)).toEqual({ term: "A" });
  expect(externalLinkOf("/applications/app-school/orders", at)).toBe("https://ontomato.example/app/#/applications/app-school/orders?standalone=1");
});

/*
 * A deployment served over plain HTTP has no clipboard API (128, 2026-11-22: copying did nothing and threw): the link is
 * copied through a selected field instead, and where nothing copies it is shown for the reader to copy by hand.
 */
it("copies without the clipboard API, and shows the link when nothing copies it", async () => {
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  const copied: string[] = [];
  const execCommand = vi.fn((command: string) => {
    copied.push(`${command}:${document.querySelector("textarea")?.value ?? ""}`);
    return true;
  });
  Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
  try {
    expect(await writeClipboard("https://ontomato.example/#/a?standalone=1")).toBe(true);
    expect(copied).toEqual(["copy:https://ontomato.example/#/a?standalone=1"]);
    // The field is gone once it has served.
    expect(document.querySelector("textarea")).toBeNull();

    execCommand.mockReturnValue(false);
    const alert = vi.spyOn(ElMessageBox, "alert").mockResolvedValue("confirm" as never);
    await copyExternalLink("/applications/app-school/orders", { copied: "Copied", title: "Copy external link" });
    expect(alert).toHaveBeenCalledWith(expect.stringMatching(/#\/applications\/app-school\/orders\?standalone=1$/), "Copy external link");
  } finally {
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else delete (navigator as { clipboard?: unknown }).clipboard;
    delete (document as { execCommand?: unknown }).execCommand;
    vi.restoreAllMocks();
  }
});

it("remembers and clears external link tab state in sessionStorage", () => {
  sessionStorage.clear();
  expect(externalLinkTab()).toBe(false);
  rememberExternalLinkTab();
  expect(externalLinkTab()).toBe(true);
  clearExternalLinkTab();
  expect(externalLinkTab()).toBe(false);
});
