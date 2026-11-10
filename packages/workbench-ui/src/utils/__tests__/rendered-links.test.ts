import { describe, expect, it } from "vitest";
import { renderAgentMarkdown } from "../agent-markdown";
import { renderMarkdown } from "../markdown";
import { renderMarkdown as renderQueryMarkdown } from "../../features/query-view/components/MessageContent/utils/markdown";

describe("rendered answer links", () => {
  it.each([
    ["agent", renderAgentMarkdown],
    ["general", renderMarkdown],
    ["query", renderQueryMarkdown],
  ])("open source links in a new tab and keep in-page anchors in place (%s renderer)", (_name, render) => {
    const html = render("[原文](http://example.com/a.txt) [节](#part) http://example.com/b");
    expect(html).toContain('<a target="_blank" rel="noopener noreferrer" href="http://example.com/a.txt"');
    expect(html).toContain('<a href="#part"');
  });
});
