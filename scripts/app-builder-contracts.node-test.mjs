import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const [command, option] of [
  [["distinct-values", "person", "id"], "--limit"],
  [["prod-distinct-values", "person", "id"], "--limit"],
  [["prod-knowledge", "question"], "--max"],
]) {
  for (const value of ["abc", "Infinity", ""]) {
    test(`${command[0]} rejects ${JSON.stringify(value)} before HTTP`, () => {
      const result = spawnSync(process.execPath, [
        "agent-skills/ontomato-app-builder/ontomato.mjs", ...command, option, value,
      ], {
        encoding: "utf8",
        env: { ...process.env, ONTOMATO_URL: "http://127.0.0.1:1", ONTOMATO_API_KEY: "test-only" },
      });
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(`${option}: expected a finite number`), result.stderr);
      assert.ok(!result.stderr.includes("fetch failed"), result.stderr);
    });
  }
}
