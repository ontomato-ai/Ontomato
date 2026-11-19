import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PANEL_ID, panelInput } from "./material.mjs";

test("the panel registration command emits the same record used for built-in installation", () => {
  const version = `4.1.9-dev.${"a".repeat(64)}`;
  const script = fileURLToPath(new URL("./material.mjs", import.meta.url));
  const output = execFileSync(process.execPath, [script, "panels", "--sdk-version", version], { encoding: "utf8" });
  const expected = { panels: [{ id: PANEL_ID, mode: "create", input: panelInput(version) }] };
  assert.equal(output, `${JSON.stringify(expected, null, 2)}\n`);
});
