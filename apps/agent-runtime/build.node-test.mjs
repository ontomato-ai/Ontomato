import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import yaml from "yaml";
import { app } from "./build.mjs";
import { productionGraph } from "../../scripts/workbench/production-graph.mjs";

test("runtime production closure contains only the public runtime and contracts", () => {
  const lock = yaml.parse(
    readFileSync(join(app.repoRoot, "pnpm-lock.yaml"), "utf8"),
  );
  const manifests = Object.fromEntries(
    Object.keys(lock.importers).map((importer) => [
      importer,
      JSON.parse(
        readFileSync(join(app.repoRoot, importer, "package.json"), "utf8"),
      ),
    ]),
  );
  for (const arch of ["x64", "arm64"]) {
    const graph = productionGraph(lock, app.appImporter, manifests, arch);
    assert.deepEqual(Object.keys(graph.bindings).sort(), [
      "apps/agent-runtime",
      "packages/agent-runtime",
      "packages/contracts",
    ]);
    assert.ok(
      Object.keys(graph.packages).some((key) =>
        key.startsWith("@earendil-works/pi-ai@1.3.0"),
      ),
    );
  }
  assert.equal(app.sources.length, 1);
  assert.equal(app.sources[0].root, app.repoRoot);
  assert.equal(app.component, "ontomato-agent-runtime");
});

test("source staging accepts an app without a web bundle and preserves the fork license", async (t) => {
  const { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { assembleAppStage } =
    await import("../../scripts/workbench/stage-app.mjs");
  const root = mkdtempSync(join(tmpdir(), "runtime-stage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const absolute = join(root, "app");
  mkdirSync(join(absolute, "src/core/pi"), { recursive: true });
  writeFileSync(
    join(absolute, "package.json"),
    JSON.stringify({ name: "fixture" }),
  );
  writeFileSync(join(absolute, "src/core/pi/LICENSE"), "MIT fixture");
  assembleAppStage({
    root,
    stageRoot: join(root, "stage"),
    storeRoot: join(root, "store"),
    record: { appImporter: "app", web: false },
    platform: "linux/arm64",
    lock: {
      lockfileVersion: "9.0",
      importers: { app: {} },
      packages: {},
      snapshots: {},
    },
    members: [{ path: "app", absolute, manifest: { name: "fixture" } }],
    selected: [{ path: "app" }],
  });
  assert.equal(
    readFileSync(join(root, "stage/app/src/core/pi/LICENSE"), "utf8"),
    "MIT fixture",
  );
  assert.equal(existsSync(join(root, "stage/dist/web")), false);
});

test("notice generation sees the same production store that enters the final image", async (t) => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const { installedLicenseReport } =
    await import("../../scripts/workbench/install-runtime.mjs");
  const root = mkdtempSync(join(tmpdir(), "runtime-notices-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = join(root, "opt/runtime");
  const sdk =
    "node_modules/.pnpm/@anthropic-ai+sdk@0.129.0_zod@3.25.76/node_modules/@anthropic-ai/sdk";
  mkdirSync(join(runtime, sdk), { recursive: true });
  writeFileSync(
    join(runtime, sdk, "package.json"),
    JSON.stringify({
      name: "@anthropic-ai/sdk",
      version: "0.129.0",
      license: "MIT",
    }),
  );
  writeFileSync(join(runtime, sdk, "LICENSE"), "Actual installed SDK license");
  const raw = {
    MIT: [
      {
        name: "@anthropic-ai/sdk",
        versions: ["0.129.0"],
        paths: [join(runtime, sdk)],
      },
      {
        name: "uninstalled-optional-provider",
        versions: ["1.0.0"],
        paths: [join(runtime, "missing-provider")],
      },
    ],
  };
  const report = installedLicenseReport(raw, runtime, {
    "@anthropic-ai/sdk@0.129.0(zod@3.25.76)": sdk,
  });
  writeFileSync(join(root, "report.json"), JSON.stringify(report));
  execFileSync(
    "python3",
    [
      "-B",
      join(app.repoRoot, "scripts/third_party_notices.py"),
      join(root, "notices.txt"),
      "--npm",
      join(root, "report.json"),
    ],
    { input: "Node fixture\n" },
  );
  const text = readFileSync(join(root, "notices.txt"), "utf8");
  assert.match(text, /npm packages \(1\)/);
  assert.match(text, /Actual installed SDK license/);
  assert.doesNotMatch(text, /uninstalled-optional-provider/);

  const dockerfile = readFileSync(
    join(app.repoRoot, "apps/agent-runtime/Dockerfile"),
    "utf8",
  );
  const noticeStep = dockerfile
    .split("\nRUN ")
    .find((step) => step.includes("python /tmp/third_party_notices.py"));
  assert.match(
    noticeStep,
    /--mount=type=bind,from=dependencies,source=\/opt\/runtime,target=\/opt\/runtime/,
  );
  assert.match(
    dockerfile,
    /COPY --from=dependencies \/opt\/runtime\/node_modules \/opt\/runtime\/node_modules/,
  );
});
