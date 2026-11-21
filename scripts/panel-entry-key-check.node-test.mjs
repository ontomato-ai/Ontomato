import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
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

async function workspace(messages) {
  const directory = await mkdtemp(join(tmpdir(), "ontomato-entry-key-"));
  await writeFile(join(directory, "panel.json"), JSON.stringify({
    manifest: { state: {}, members: { create: { target: { projectionId: entryProjection.id } } }, events: {} },
    content: { messages },
  }));
  await writeFile(join(directory, "panel.html"), '<div id="app"><projection slot="create"></projection></div>');
  await writeFile(join(directory, "panel.mjs"), 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});\n');
  return directory;
}

/** Runs the check in a Node that reads the contracts' TypeScript, with the registered projection found by lookup. */
async function check(directory) {
  const program = `
    import * as checks from ${JSON.stringify(pathToFileURL(join(ROOT, "packages/contracts/src/panel-check.ts")).href)};
    import { checkPanelWorkspace } from ${JSON.stringify(pathToFileURL(join(ROOT, "agent-skills/ontomato-app-builder/panel-check.mjs")).href)};
    const catalogue = { version: ${JSON.stringify(version)}, components: [{ componentId: "ConversationEntry", data: {} }] };
    const projection = ${JSON.stringify(entryProjection)};
    const result = await checkPanelWorkspace(${JSON.stringify(directory)}, {
      checks, catalogue, version: ${JSON.stringify(version)}, lookup: async (kind, id) => (kind === "projection" && id === projection.id ? projection : null),
    });
    console.log(JSON.stringify(result));`;
  return run(process.execPath, ["--import", "./packages/contracts/node_modules/tsx/dist/loader.mjs", "--input-type=module", "-e", program], { cwd: ROOT });
}

test("a reused projection's opening-sentence key must be in each language the placing panel declares", async () => {
  const missing = await workspace({ en: { "actions.create": "Help me create an action:" }, "zh-CN": {} });
  await assert.rejects(check(missing), (error) =>
    error.stderr.includes("member create (projection entry-proj) prefillKey 'actions.create' is not in content.messages (zh-CN)"));

  // An inherited name is no key of the panel's.
  const inherited = await workspace({ en: { "actions.create": "Help me create an action:" }, "zh-CN": { "toString": "x" } });
  await assert.rejects(check(inherited), (error) => error.stderr.includes("(zh-CN)"));

  const held = await workspace({ en: { "actions.create": "Help me create an action:" }, "zh-CN": { "actions.create": "帮我新建一个动作：" } });
  const { stdout } = await check(held);
  assert.equal(JSON.parse(stdout).status, "valid");
});
