// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/* The third copy of the brand colours (the edition's dashboard palette, gradients and chart colours) must not return. */
it("chart colours are not written into the edition content or the chart code", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const utils = join(here, "../components/utils");
  const files = [
    join(here, "../../../../../../apps/workbench/web/src/workbench-content.ts"),
    join(here, "../chart-palette.ts"),
    ...readdirSync(utils).map((name) => join(utils, name)),
  ];
  for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(\d/i);
});
