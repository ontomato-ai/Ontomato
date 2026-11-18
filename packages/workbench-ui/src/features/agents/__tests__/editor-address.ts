import { vi } from "vitest";
import { pageDraftLink, withoutPageDraftQuery } from "@ontomato/agent-shell-ui";
import { agentSettingsAddressKey } from "../agent-settings-address";

/**
 * The address the settings page is shown at, as the page that mounts the editor provides it. The editor is mounted only
 * by that page, so a test mounting the editor directly stands in for it.
 */
export function editorAddress(path: string) {
  const [pathname, search = ""] = path.split("?");
  const query = Object.fromEntries(new URLSearchParams(search));
  const remaining = withoutPageDraftQuery(query);
  const saved = Object.keys(remaining).length ? `?${new URLSearchParams(remaining as Record<string, string>)}` : "";
  const go = vi.fn();
  return {
    go,
    provide: {
      [agentSettingsAddressKey as symbol]: {
        address: { value: path },
        draft: { value: pageDraftLink(query) },
        savedAddress: { value: `${pathname}${saved}` },
        agentAddress: (id: string) => `${pathname!.slice(0, pathname!.lastIndexOf("/"))}/${id}${search ? `?${search}` : ""}`,
        go,
      },
    },
  };
}
