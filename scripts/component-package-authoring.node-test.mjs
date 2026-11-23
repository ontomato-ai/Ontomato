import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const repo = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);
const version = "9.9.9-dev." + "a".repeat(64);

test("offline panel check expands a qualified component from its package declarations", async t => {
  const root = await mkdtemp(join(tmpdir(), "offline-component-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sdk = join(root, "sdk");
  const workspace = join(root, "workspace");
  const release = join(root, "release");
  await Promise.all([sdk, workspace, release].map(directory => mkdir(directory)));
  const json = (directory, file, value) => writeFile(join(directory, file), JSON.stringify(value));
  const packageName = "@example/tools";
  const operation = "schedules.runNow";
  const objectType = "platform:ScheduledTask";
  const item = {
    componentId: packageName + ":ScheduleCards", module: packageName, exportName: "ScheduleCards",
    role: "control", meaning: "Shows scheduled tasks and starts one.",
    data: { rows: { results: ["panelRecordList"], required: true } },
    operations: [{ name: "runNow", handlerRef: operation }],
    ports: { props: [], events: [], slots: [] },
  };

  await Promise.all([
    json(sdk, "sdk.json", { version, check: "check.mjs", components: "components.json" }),
    json(sdk, "components.json", { version, components: [] }),
    writeFile(join(sdk, "check.mjs"), `export * from ${JSON.stringify(new URL("../packages/contracts/src/panel-check.ts", import.meta.url).href)};`),
    json(release, "package.json", {
      name: packageName, version: "1.0.0", author: "Example",
      ontomato: { components: "components.json", entries: { [packageName]: "index.mjs" } },
    }),
    json(release, "components.json", [item]),
    writeFile(join(release, "index.mjs"), 'throw new Error("The checker must not execute the package");'),
    json(workspace, "registration.json", {
      panels: [{ id: "example", mode: "create", input: { name: "Schedules", description: "", visibility: "domain" } }],
    }),
    json(workspace, "panel.json", { manifest: {
      state: { selected: { type: { kind: "object", objectType } } },
      members: { cards: { component: item.componentId, type: objectType, data: { rows: "list" }, operation, target: "selected" } },
    } }),
    writeFile(join(workspace, "panel.html"), '<div id="app"><projection slot="cards"></projection></div>'),
    writeFile(join(workspace, "panel.mjs"), 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});\n'),
    json(root, "types.json", {
      objectTypes: { [objectType]: {
        reads: { list: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" } },
        operations: [{ id: operation, kind: "action", effect: "write", target: { source: "input", input: "task" }, inputSchema: {}, batch: false }],
      } },
      resultSchemas: { panelRecordList: { type: "array" } },
    }),
  ]);

  const check = () => run(process.execPath, [
    "--import", "./packages/contracts/node_modules/tsx/dist/loader.mjs", "agent-skills/ontomato-app-builder/ontomato.mjs",
    "panel", "check", workspace, "--sdk-dir", sdk, "--component-package", release, "--type-table", join(root, "types.json"),
  ], { cwd: repo, env: { ...process.env, ONTOMATO_WORKBENCH_URL: "http://127.0.0.1:1" } });
  assert.deepEqual(JSON.parse((await check()).stdout), { status: "valid", version, unchecked: [] });

  await json(release, "components.json", [{ ...item, data: { rows: { results: ["panelRecord"], required: true } } }]);
  await assert.rejects(check(), error => error.stderr.includes("does not accept result 'panelRecordList'"));

  await json(release, "components.json", [{ ...item, operations: [{ name: "runNow", handlerRef: "" }] }]);
  await assert.rejects(check(), error => error.stderr.includes("handlerRef"));

  await json(release, "components.json", [{ ...item, componentId: "@example/other:ScheduleCards" }]);
  await assert.rejects(check(), error => error.stderr.includes("Expected component ID prefixed with"));
});
