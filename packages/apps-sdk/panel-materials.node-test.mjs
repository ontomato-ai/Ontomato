import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * The panels this SDK version ships as materials — the trial pair, the four-layer capability map and the agent settings
 * page — registered against the catalogue that same version builds. Registration on the platform checks a projection's
 * datums against the component's declaration before it accepts a panel; a declaration that does not cover a datum the
 * material already sends stops the whole registration (one capability-map projection whose `neighbors` read returns the
 * graph result took every panel skill down), so the same three checks run here, where a wrong declaration costs a build
 * instead of a deployment.
 *
 * What a projection names, here, is only its own component and data: which datum may hold which read result is the
 * catalogue's to say, and each read's result is the owner's declaration, resolved by the contract's own rule.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MATERIALS = {
  "schedules-trial P/Q": join(HERE, "examples/panels/schedules-trial/definitions.mjs"),
  "capability-map": join(HERE, "examples/panels/capability-map/projections.mjs"),
  "agent-settings": join(HERE, "examples/panels/agent-settings/projections.mjs"),
};

test("every shipped panel material registers against this version's component catalogue", async (t) => {
  const out = mkdtempSync(join(tmpdir(), "sdk-materials-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  execFileSync(process.execPath, [join(HERE, "build.mjs"), join(HERE, "../../apps/workbench/web/src/sdk-edition.ts"), out], {
    env: { ...process.env, APPS_SDK_BUILD: JSON.stringify({ product: "workbench", release: false }) },
    stdio: "pipe",
  });

  const version = readdirSync(out).find((name) => name !== "current.json");
  const sdk = join(out, version);
  const { directReadDeclaration, appsSdkComponentCatalogSchema } = await import(pathToFileURL(join(sdk, "node/panel-check.mjs")).href);
  const catalogue = appsSdkComponentCatalogSchema.parse(JSON.parse(readFileSync(join(sdk, "components.json"), "utf8")));
  const components = new Map(catalogue.components.map((component) => {
    const packageName = component.module.split("/", component.module.startsWith("@") ? 2 : 1).join("/");
    return [`${packageName}:${component.componentId}`, component];
  }));

  for (const [name, file] of Object.entries(MATERIALS)) {
    const module = await import(pathToFileURL(file).href);
    for (const { id, input } of module.projections ?? module.default) {
      const component = components.get(input.componentId);
      assert.ok(component, `${name}: ${id} uses ${input.componentId}, which this SDK version declares`);
      assert.notEqual(component.data, undefined, `${name}: ${id}'s component declares projection data`);
      for (const [datum, { required }] of Object.entries(component.data))
        assert.ok(!required || Object.hasOwn(input.data ?? {}, datum), `${name}: ${id} declares the required datum '${datum}'`);
      for (const [datum, read] of Object.entries(input.data ?? {})) {
        assert.ok(Object.hasOwn(component.data, datum), `${name}: ${id}'s component declares the datum '${datum}'`);
        // The owner's own declaration says what the read returns; the component says which results its datum holds.
        const { result } = directReadDeclaration(input, read) ?? {};
        assert.ok(result, `${name}: ${id}.${datum} reads '${read.read}' from an owner that registers it`);
        assert.ok(component.data[datum].results.includes(result),
          `${name}: ${id}.${datum} returns '${result}'; ${component.componentId} accepts ${component.data[datum].results.join(", ")}`);
      }
    }
  }
});
