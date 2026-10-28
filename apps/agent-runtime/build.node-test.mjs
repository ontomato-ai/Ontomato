import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import yaml from "yaml";
import { app } from "./build.mjs";
import { productionGraph } from "../../scripts/workbench/production-graph.mjs";

test("build prepares an empty context before adding Python requirements and invoking Docker", async (t) => {
  const {
    cpSync,
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    writeFileSync,
  } = await import("node:fs");
  const { dirname } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { execFileSync, spawnSync } = await import("node:child_process");
  const temporary = realpathSync(
    mkdtempSync(join(tmpdir(), "runtime-build-order-")),
  );
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = join(temporary, "ontomato");
  const files = [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "pom.xml",
    "LICENSE",
    "NOTICE",
    "apps/agent-runtime/build.mjs",
    "apps/agent-runtime/Dockerfile",
    "apps/agent-runtime/package.json",
    "apps/agent-runtime/src/index.ts",
    "packages/agent-runtime/package.json",
    "packages/agent-runtime/src/worker-launch.py",
    "packages/agent-runtime/requirements-py310.txt",
    "packages/contracts/package.json",
    "scripts/build-support.mjs",
    "scripts/pnpm-workspace-context.mjs",
    "scripts/third_party_notices.py",
    ...[
      "install-runtime",
      "runtime-layout",
      "production-graph",
      "stage-app",
    ].map((name) => `scripts/workbench/${name}.mjs`),
  ];
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(join(app.repoRoot, file), join(root, file));
  }
  writeFileSync(join(root, ".gitignore"), ".build/\n");
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=",
    "commit",
    "-qm",
    "fixture",
  );

  // Execute the real CLI/build()/staging helpers. Only Docker is replaced, inside
  // this subprocess, so the test neither builds an image nor touches a daemon.
  const fakeDocker = join(temporary, "fake-docker.mjs");
  const log = join(temporary, "docker.json");
  writeFileSync(
    fakeDocker,
    `
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const nativeSpawn = childProcess.spawnSync;
const calls = [];
let built;
childProcess.spawnSync = (command, args, options) => {
  if (command !== "docker") return nativeSpawn(command, args, options);
  const call = { args };
  let stdout = "";
  if (args[0] === "buildx" && args[1] === "build") {
    const context = args.at(-1);
    call.context = {
      inputs: JSON.parse(readFileSync(join(context, "inputs.json"), "utf8")),
      requirements: readFileSync(join(context, "requirements-py310.txt"), "utf8"),
      launcher: readFileSync(join(context, "workspace/ontomato/packages/agent-runtime/src/worker-launch.py"), "utf8"),
      stale: existsSync(join(context, "stale-marker")),
    };
    const labels = Object.fromEntries(args.flatMap((arg, i) => arg === "--label" ? [[args[i + 1].slice(0, args[i + 1].indexOf("=")), args[i + 1].slice(args[i + 1].indexOf("=") + 1)]] : []));
    built = { Os: "linux", Architecture: args[args.indexOf("--platform") + 1].split("/")[1], Config: { Labels: labels } };
  } else if (args[0] === "image" && args[1] === "inspect" && built) {
    stdout = JSON.stringify([built]);
  } else throw new Error("Unexpected Docker call: " + args.join(" "));
  calls.push(call);
  writeFileSync(process.env.RUNTIME_BUILD_TEST_LOG, JSON.stringify(calls));
  return { status: 0, stdout, stderr: "" };
};
syncBuiltinESMExports();
`,
  );
  const context = join(root, ".build/contexts/agent-runtime/arm64/image");
  for (let attempt = 0; attempt < 2; attempt++) {
    mkdirSync(context, { recursive: true });
    writeFileSync(join(context, "stale-marker"), "previous build");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        fakeDocker,
        join(root, "apps/agent-runtime/build.mjs"),
        "--arch",
        "arm64",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          DOCKER_API_VERSION: "1.49",
          RUNTIME_BUILD_TEST_LOG: log,
        },
      },
    );
    assert.equal(
      result.status,
      0,
      result.error?.message || result.stderr || result.stdout,
    );
    const calls = JSON.parse(readFileSync(log, "utf8"));
    assert.deepEqual(
      calls.map((call) => call.args.slice(0, 2)),
      [
        ["buildx", "build"],
        ["image", "inspect"],
      ],
    );
    assert.equal(calls[0].args.at(-1), context);
    assert.equal(calls[0].context.stale, false);
    assert.equal(calls[0].context.inputs.appImporter, "apps/agent-runtime");
    assert.equal(
      calls[0].context.inputs.yamlProvider,
      "@ontomato/agent-runtime",
    );
    assert.equal(calls[0].context.inputs.web, false);
    assert.equal(
      calls[0].context.requirements,
      readFileSync(
        join(app.repoRoot, "packages/agent-runtime/requirements-py310.txt"),
        "utf8",
      ),
    );
    assert.equal(
      calls[0].context.launcher,
      readFileSync(
        join(app.repoRoot, "packages/agent-runtime/src/worker-launch.py"),
        "utf8",
      ),
    );
  }
});

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
        key.startsWith("@earendil-works/pi-ai@1.4.0"),
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
  const { assembleAppStage } = await import(
    "../../scripts/workbench/stage-app.mjs"
  );
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
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import(
    "node:fs"
  );
  const { tmpdir } = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const { installedLicenseReport } = await import(
    "../../scripts/workbench/install-runtime.mjs"
  );
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
