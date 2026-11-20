import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveConfig, type HtmlTagDescriptor } from "vite";
import { describe, expect, it } from "vitest";

function renderTags(tags: HtmlTagDescriptor[]): string[] {
  return tags.map((tag) => {
    const attrs = Object.entries(tag.attrs ?? {})
      .map(([k, v]) => (v === true ? k : `${k}="${String(v)}"`))
      .join(" ");
    const open = attrs ? `<${tag.tag} ${attrs}>` : `<${tag.tag}>`;
    return `${open}${typeof tag.children === "string" ? tag.children : ""}</${tag.tag}>`;
  });
}

describe("public workbench entry index.html", () => {
  it("injects the stale-entry recovery script into head via Vite config", async () => {
    const webRoot = path.resolve(__dirname, "../../web");
    const config = await resolveConfig({ configFile: path.join(webRoot, "vite.config.ts") }, "build");
    let html = readFileSync(path.join(webRoot, "index.html"), "utf8");
    const headTags: string[] = [];

    for (const plugin of config.plugins) {
      const hook = plugin.transformIndexHtml;
      if (!hook) continue;
      const handler = typeof hook === "function" ? hook : "handler" in hook ? hook.handler : hook.transform;
      const result = await handler.call({} as never, html, { path: "/index.html", filename: "index.html" });
      if (typeof result === "string") {
        html = result;
      } else if (Array.isArray(result)) {
        headTags.push(...renderTags(result));
      } else if (result && typeof result === "object") {
        if (result.html) html = result.html;
        if (result.tags) headTags.push(...renderTags(result.tags));
      }
    }

    const rendered = html.replace("</head>", `${headTags.join("\n")}\n</head>`);
    expect(rendered).toContain("ontomato_stale_entry_reload");
    expect(rendered).toContain("页面版本已更新，请刷新");
  });
});
