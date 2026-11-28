import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installContentLayout, installWorkbenchProduct } from "@ontomato/workbench-server";
import { workbenchServerResourceRoot } from "@ontomato/workbench-server/content/resources";
import { syncRuntimeDefaultResources } from "@ontomato/workbench-server/platform/runtime-defaults";
import { ossContentLayout } from "../content";
import { configureOssI18n } from "../i18n";
import { ossProduct } from "../product";

// Configure the edition locale before reading localized diagnostic resources.
configureOssI18n();
const { KnowledgeNotFoundError, listKnowledgeTree, readKnowledgeMarkdown } = await import(
  "@ontomato/workbench-server/platform/diagnosis/observe/agent/knowledge-store"
);

let runtimeRoot: string;
let tempDirs: string[] = [];
const tempDir = (prefix: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};
const data = (...segments: string[]) => path.join(runtimeRoot, "data", ...segments);

beforeEach(() => {
  runtimeRoot = tempDir("oss-runtime-");
  vi.stubEnv("ONTOMATO_LOG_DIR", path.join(runtimeRoot, "logs"));
  installWorkbenchProduct(ossProduct);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("open-source runtime default resources", () => {
  it("reads bundled knowledge directly and syncs runtime defaults", async () => {
    installContentLayout(ossContentLayout(runtimeRoot));
    fs.mkdirSync(data("knowledge"), { recursive: true });
    fs.mkdirSync(data("echart"), { recursive: true });
    fs.writeFileSync(data("knowledge", "site-note.md"), "# Site note\n");
    fs.writeFileSync(data("knowledge", "index.md"), "# Stale index\n");
    fs.writeFileSync(data("echart", "echarts.min.js"), "stale");

    await syncRuntimeDefaultResources();

    expect(() => readKnowledgeMarkdown("site-note.md")).toThrow(KnowledgeNotFoundError);
    expect(listKnowledgeTree().children?.map((entry) => entry.path)).not.toContain("site-note.md");
    expect(fs.readFileSync(data("knowledge", "index.md"), "utf8")).toBe("# Stale index\n");
    expect(readKnowledgeMarkdown("index.md").content).toBe(
      fs.readFileSync(path.join(workbenchServerResourceRoot, "data", "knowledge", "index.md"), "utf8")
    );
    expect(fs.readFileSync(data("echart", "echarts.min.js"))).toEqual(
      fs.readFileSync(path.join(workbenchServerResourceRoot, "data", "echart", "echarts.min.js"))
    );
  });
});
