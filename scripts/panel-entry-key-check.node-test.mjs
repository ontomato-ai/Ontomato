import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

/*
 * `panel check` with the release's real checks (A's review, 2026-11-21): a conversation entry's opening sentence named
 * by key is the placing panel's own words, so a panel that places such a projection — a new one, or one already
 * registered and reused — must hold the key in each language it declares, or the reader's composer would open with the
 * key itself.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);
const version = "9.9.9-dev." + "a".repeat(64);
const entryProjection = {
  id: "entry-proj", name: "New action", description: "", componentId: "@ontomato/sdk:ConversationEntry",
  inputs: {}, outputs: {}, config: {}, data: {},
  conversationEntry: { target: { kind: "page-default" }, prefillKey: "actions.create" },
  domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain",
};

async function workspace(t, messages) {
  const directory = await mkdtemp(join(tmpdir(), "ontomato-entry-key-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "panel.json"), JSON.stringify({
    manifest: { state: {}, members: { create: { target: { projectionId: entryProjection.id } } }, commands: {} },
    content: { messages },
  }));
  await writeFile(join(directory, "panel.html"), '<div id="app"><projection slot="create"></projection></div>');
  await writeFile(join(directory, "panel.mjs"), 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});\n');
  return directory;
}

/** Runs the check in a Node that reads the contracts' TypeScript, with the registered projection found by lookup. */
async function check(directory, prefillKey = entryProjection.conversationEntry.prefillKey) {
  const program = `
    import * as checks from ${JSON.stringify(pathToFileURL(join(ROOT, "packages/contracts/src/panel-check.ts")).href)};
    import { checkPanelWorkspace } from ${JSON.stringify(pathToFileURL(join(ROOT, "agent-skills/ontomato-app-builder/panel-check.mjs")).href)};
    const catalogue = { version: ${JSON.stringify(version)}, components: [{ componentId: "ConversationEntry", data: {} }] };
    const projection = ${JSON.stringify({
      ...entryProjection, conversationEntry: { ...entryProjection.conversationEntry, prefillKey },
    })};
    const result = await checkPanelWorkspace(${JSON.stringify(directory)}, {
      checks, catalogue, version: ${JSON.stringify(version)}, lookup: async (kind, id) => (kind === "projection" && id === projection.id ? projection : null),
    });
    console.log(JSON.stringify(result));`;
  return run(process.execPath, ["--import", "./packages/contracts/node_modules/tsx/dist/loader.mjs", "--input-type=module", "-e", program], { cwd: ROOT });
}

test("a reused projection's opening-sentence key must be in each language the placing panel declares", async (t) => {
  const missing = await workspace(t, { en: { "actions.create": "Help me create an action:" }, "zh-CN": {} });
  await assert.rejects(check(missing), (error) =>
    error.stderr.includes("member create (projection entry-proj) prefillKey 'actions.create' is not in content.messages (zh-CN)"));

  // An inherited name is no key of the panel's.
  const inherited = await workspace(t, { en: { toString: "Help me create an action:" }, "zh-CN": {} });
  await assert.rejects(check(inherited, "toString"), (error) =>
    error.stderr.includes("prefillKey 'toString' is not in content.messages (zh-CN)"));

  const held = await workspace(t, { en: { "actions.create": "Help me create an action:" }, "zh-CN": { "actions.create": "帮我新建一个动作：" } });
  const { stdout } = await check(held);
  assert.equal(JSON.parse(stdout).status, "valid");
});

/** Runs the release's check of a platform panel's sources, as the image build stages them, with the real checks. */
async function checkBuiltin(directory) {
  const program = `
    import * as checks from ${JSON.stringify(pathToFileURL(join(ROOT, "packages/contracts/src/panel-check.ts")).href)};
    import { checkBuiltinPanelSource } from ${JSON.stringify(pathToFileURL(join(ROOT, "agent-skills/ontomato-app-builder/panel-check.mjs")).href)};
    console.log(JSON.stringify(await checkBuiltinPanelSource(${JSON.stringify(directory)}, checks)));`;
  return run(process.execPath, ["--import", "./packages/contracts/node_modules/tsx/dist/loader.mjs", "--input-type=module", "-e", program], { cwd: ROOT });
}

async function builtin(messages) {
  const directory = await mkdtemp(join(tmpdir(), "ontomato-builtin-entry-key-"));
  await writeFile(join(directory, "registration.json"), JSON.stringify({
    panels: [{ id: "builtin-product-entry-key-panel", mode: "create", input: { name: "Actions", description: "", visibility: "domain" } }],
  }));
  await writeFile(join(directory, "panel.json"), JSON.stringify({
    manifest: { state: {}, commands: {}, members: {
      create: { id: "builtin-product-entry-key-entry", component: "ConversationEntry", agent: "page-default", prefillKey: "actions.newPrefill" },
    } },
    content: { messages },
  }));
  await writeFile(join(directory, "panel.html"), '<div id="app"><projection slot="create"></projection></div>');
  await writeFile(join(directory, "panel.mjs"), 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});\n');
  return directory;
}

test("a platform panel's entry key must be in each language it declares, checked before the build stages it", async () => {
  await assert.rejects(checkBuiltin(await builtin({ en: { "actions.newPrefill": "Help me create an action:" }, "zh-CN": {} })), (error) =>
    error.stderr.includes("member create prefillKey 'actions.newPrefill' is not in content.messages (zh-CN)"));
  const { stdout } = await checkBuiltin(await builtin({
    en: { "actions.newPrefill": "Help me create an action:" }, "zh-CN": { "actions.newPrefill": "帮我新建一个动作：" },
  }));
  assert.equal(JSON.parse(stdout).panelId, "builtin-product-entry-key-panel");
});
