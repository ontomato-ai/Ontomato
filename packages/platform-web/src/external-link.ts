import { ElMessage, ElMessageBox } from "element-plus";

/*
 * An application's external link (big main's ruling, 2026-11-21): the entry's own address with `standalone=1`. Opened in
 * a tab, the platform draws the application without its rail, and keeps doing so in that tab as the reader goes on; in
 * the platform the same address opens with the rail. One address, two presentations: the page, its state and the
 * reader's admission are the same.
 */

const TAB_KEY = "ontomato.externalLinkTab";

/** Whether this tab was opened from an external link. */
export function externalLinkTab(): boolean {
  try {
    return sessionStorage.getItem(TAB_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remembers that this tab is an external link's, across the reader's navigation and a reload. */
export function rememberExternalLinkTab() {
  try {
    sessionStorage.setItem(TAB_KEY, "1");
  } catch {
    // Without session storage the tab still hides the rail until it is reloaded.
  }
}

/** An entry's address (hash route, with its state) as the external link: the full page address with the flag. */
export function externalLinkOf(address: string, location: Pick<Location, "origin" | "pathname"> = window.location) {
  const [path, search = ""] = address.split("?");
  const query = new URLSearchParams(search);
  query.set("standalone", "1");
  return `${location.origin}${location.pathname}#${path}?${query}`;
}

/**
 * Puts text on the clipboard: through the clipboard API where the page may use it, else through a selected text field,
 * which a deployment served over plain HTTP (where the API is absent) still allows. False when neither took it.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (no permission, the page not focused): the field below may still copy it.
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/**
 * Copies an entry's external link and says so. Where the browser copies nothing, the link is shown for the reader to copy
 * by hand, so the action never ends in silence.
 */
export async function copyExternalLink(address: string, labels: { copied: string; title: string }) {
  const link = externalLinkOf(address);
  if (await writeClipboard(link)) ElMessage.success(labels.copied);
  else await ElMessageBox.alert(link, labels.title).catch(() => undefined);
}
