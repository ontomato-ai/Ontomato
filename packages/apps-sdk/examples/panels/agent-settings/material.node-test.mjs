import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PANEL_ID, panelInput } from "./material.mjs";

test("the panel registration command emits the shared registration material without a pinned SDK", () => {
  const script = fileURLToPath(new URL("./material.mjs", import.meta.url));
  const output = execFileSync(process.execPath, [script, "panels"], { encoding: "utf8" });
  const expected = { panels: [{ id: PANEL_ID, mode: "create", input: panelInput() }] };
  assert.equal(Object.hasOwn(expected.panels[0].input, "sdkVersion"), false);
  assert.equal(output, `${JSON.stringify(expected, null, 2)}\n`);
});
