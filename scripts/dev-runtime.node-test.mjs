import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { runtimeEnvironment } from "./dev-runtime.mjs";
import { configuration } from "./dev-command.mjs";
import { classify, runtimePort } from "./dev-stack.mjs";

test("dev shares a persistent credential and keeps data in the calling checkout", t => {
  const root = mkdtempSync(join(tmpdir(), "runtime-dev-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, ".env"), "POSTGRES_USER=fixture\nPOSTGRES_PASSWORD=private\nDATA_QUERY_BASE_URL=http://127.0.0.1:18087\nAGENT_RUNTIME_PORT=3131\n");
  const product = { root, runtimeDatabase: "fixture_database" };
  const first = runtimeEnvironment(product, {});
  const second = runtimeEnvironment(product, {});
  assert.equal(first.AGENT_RUNTIME_SERVICE_TOKEN, second.AGENT_RUNTIME_SERVICE_TOKEN);
  assert.ok(first.ONTOMATO_MODEL_RUNTIME_TOKEN);
  assert.equal(first.ONTOMATO_MODEL_RUNTIME_TOKEN, second.ONTOMATO_MODEL_RUNTIME_TOKEN);
  assert.equal(configuration("server", product, first).env.ONTOMATO_MODEL_RUNTIME_TOKEN,
    second.ONTOMATO_MODEL_RUNTIME_TOKEN);
  assert.equal(JSON.parse(first.AGENT_RUNTIME_HOSTS)[0].token, first.AGENT_RUNTIME_SERVICE_TOKEN);
  assert.equal(first.AGENT_RUNTIME_DATABASE, "fixture_database");
  assert.equal(first.AGENT_RUNTIME_URL, "http://127.0.0.1:3131");
  assert.equal(relative(root, first.AGENT_RUNTIME_ROOT).startsWith(".."), false);
  assert.equal(statSync(join(root, ".secrets/agent-runtime.env")).mode & 0o777, 0o600);
  assert.doesNotMatch(readFileSync(join(root, ".env"), "utf8"), /AGENT_RUNTIME_SERVICE_TOKEN/);
  // Still identify native processes left by older development entries.
  const command = `node /public/node_modules/tsx/dist/cli.mjs watch /public/apps/agent-runtime/src/index.ts --dev-root ${root}`;
  const ctx = { root, javaEnvFile: join(root, ".env") };
  assert.equal(classify(command, root, ctx), "frontend-root");
  assert.equal(classify(command, root + "-other", ctx), undefined);
  assert.equal(classify(command.replace("node ", "node -e "), root, ctx), undefined);
  assert.equal(runtimePort(ctx, {}), 3131);
  assert.equal(runtimePort(ctx, { AGENT_RUNTIME_PORT: "3232" }), 3232);
});
