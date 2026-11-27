import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { builtinPanelIconReport } from "./builtin-panel-icons.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { hasAppIcon } = await import(pathToFileURL(join(ROOT, "packages/platform-shell/src/icons.ts")).href);

test("every shipped builtin panel static icon is in the platform icon set", () => {
  const report = builtinPanelIconReport({
    root: ROOT,
    hasAppIcon,
  });
  assert.ok(report.panels > 0, "expected builtin panels to be scanned");
  assert.deepEqual(report.violations, []);
});
