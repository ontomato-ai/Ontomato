import { expect, it, vi } from "vitest";
import { createApp, h, ref } from "vue";
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import ArtifactLinkNode from "../components/ArtifactLinkNode.vue";
import { messageContextKey, shellContextKey, type ShellContext } from "../context";

const entry = "/ontology/applications";
const draftQuery = "state=%7B%22scope%22%3A%22visible%22%7D" +
  "&draftSessionId=99f322a5-7bec-4712-9873-737bd3969d1e&draftRunId=34073248-12cf-4e75-abe6-6bec9dc44e0d" +
  "&draftPath=outputs%2Fdrafts%2Fentry.page-draft.json";
const address = entry + "?" + draftQuery;

function renderLink(href: string) {
  const root = document.createElement("div");
  document.body.append(root);
  const open = vi.fn();
  const pageLink = vi.fn((candidate: string) => candidate === address ? open : null);
  const app = createApp(() => h(MarkdownView, {
    content: `[Open the draft](${href})`, final: true, nodes: { link: ArtifactLinkNode },
  }));
  app.provide(shellContextKey, { labels: ref({ unavailable: "Unavailable" }), pageLink } as unknown as ShellContext);
  app.provide(messageContextKey, ref({ runId: "run" }));
  app.mount(root);
  return { root, open, pageLink, close() { app.unmount(); root.remove(); } };
}

it.each(["http://localhost", "https://internal/workbench/#"])("opens the local entry when a draft link includes %s", async origin => {
  const { root, open, pageLink, close } = renderLink(origin + address);
  try {
    const link = await vi.waitFor(() => {
      const anchor = root.querySelector<HTMLAnchorElement>("a.page-link");
      expect(anchor?.getAttribute("href")).toBe(address);
      return anchor!;
    });
    expect(pageLink).toHaveBeenCalledWith(address);
    link.click();
    expect(open).toHaveBeenCalledOnce();
  } finally {
    close();
  }
});

it("does not offer a draft link for an entry the host does not recognise", async () => {
  const { root, pageLink, close } = renderLink(`http://localhost/unknown?${draftQuery}`);
  try {
    await vi.waitFor(() => expect(root.textContent).toContain("Open the draft (Unavailable)"));
    expect(pageLink).toHaveBeenCalledWith(`/unknown?${draftQuery}`);
    expect(root.querySelector("a")).toBeNull();
  } finally {
    close();
  }
});

it("leaves an ordinary external link with its own origin", async () => {
  const href = "https://example.com/docs";
  const { root, close } = renderLink(href);
  try {
    await vi.waitFor(() => expect(root.querySelector("a")?.getAttribute("href")).toBe(href));
    expect(root.querySelector("a")?.target).toBe("_blank");
  } finally {
    close();
  }
});
