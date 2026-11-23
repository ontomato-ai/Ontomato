import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

/*
 * Contract validation for the M3 four-layer capability map registration material under the unified single-release
 * panel/projection contracts:
 * - All four ontology-backed projections (four-layer graph, relations, type objects and user picker) validate against
 *   `productProjectionInputSchema` and `registerProductProjectionRequestSchema`, using
 *   `{ kind: "PlatformObjectType", id: "platform:OntologyType" }` data reads and runtime-supplied list search/page.
 *   The static mode switcher renders directly with `<segmented-control>` rather than as a projection.
 * - The panel manifest validates against `panelManifestSchema` (`members` + `commands`), carries no `sdkVersion`,
 *   keeps its rendering module (`content.module`), and matches `candidatePanelSourceSchema`.
 * - Every `en` / `zh-CN` message key matches across locales and covers all event and projection config label keys.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../../..");
const execFileAsync = promisify(execFile);

async function runWithContracts(check) {
  const { stdout } = await execFileAsync(process.execPath, [
    "--import", join(ROOT, "packages/contracts/node_modules/tsx/dist/loader.mjs"), "--input-type=module", "-e", `
      import * as panels from "@ontomato/contracts/product-panels";
      import * as manifest from "@ontomato/contracts/panel-manifest";
      import * as projection from "@ontomato/contracts/panel-projection";
      import * as host from "@ontomato/contracts/panel-host";
      import * as material from ${JSON.stringify(join(HERE, "material.mjs"))};
      console.log(JSON.stringify(await (${check})({ ...panels, ...manifest, ...projection, ...host }, material)));
    `,
  ], { cwd: HERE });
  return JSON.parse(stdout);
}

test("all four capability-map projections validate against the unified projection registration contract", async () => {
  const result = await runWithContracts(String(({
    productProjectionInputSchema,
    registerProductProjectionRequestSchema,
    projectionBindingKeys,
    projectionPorts,
  }, { projectionMaterial }) => {
    const entries = projectionMaterial().projections;
    return Object.fromEntries(entries.map(({ id, input }) => {
      const parsed = productProjectionInputSchema.parse(input);
      registerProductProjectionRequestSchema.parse({ ...input, revision: 0 });
      return [id, {
        componentId: parsed.componentId,
        data: Object.keys(parsed.data),
        bindings: projectionBindingKeys(parsed),
        outputs: Object.keys(projectionPorts(parsed, {}).outputs ?? {}),
      }];
    }));
  }));

  assert.deepEqual(result, {
    "capability-map-graph": {
      componentId: "@ontomato/sdk:OntologyGraph",
      data: ["schema", "counts", "start", "neighbors"],
      bindings: ["PlatformObjectType:platform:OntologyType"],
      outputs: ["selectedNode", "selectedType"],
    },
    "capability-map-relations": {
      componentId: "@ontomato/sdk:ObjectRelations",
      data: ["neighbors"],
      bindings: ["PlatformObjectType:platform:OntologyType"],
      outputs: ["selected"],
    },
    "capability-map-type-objects": {
      componentId: "@ontomato/sdk:ObjectList",
      data: ["objects"],
      bindings: ["PlatformObjectType:platform:OntologyType"],
      outputs: ["selected"],
    },
    "capability-map-user-picker": {
      componentId: "@ontomato/sdk:ObjectList",
      data: ["objects"],
      bindings: ["PlatformObjectType:platform:OntologyType"],
      outputs: ["selected"],
    },
  });
});

test("capability-map panel input, candidate files, and locale messages validate with no sdkVersion pin", async () => {
  const result = await runWithContracts(String(({
    productPanelInputSchema,
    registerProductPanelRequestSchema,
    candidatePanelSourceSchema,
    matchesDirectPanelValue,
  }, { PANEL_ID, panelInput, candidateFiles, messages, projections }) => {
    const input = panelInput();
    const parsedPanel = productPanelInputSchema.parse(input);
    registerProductPanelRequestSchema.parse({ ...input, revision: 0 });
    const rejectsSdkPin = !registerProductPanelRequestSchema.safeParse({
      ...input,
      revision: 0,
      sdkVersion: "1.1.2",
    }).success;

    const files = Object.fromEntries(candidateFiles().map((file) => [file.path, file.content]));
    const descriptor = JSON.parse(files["panel.json"]);
    const candidate = candidatePanelSourceSchema.parse({
      kind: "candidate",
      workspace: { id: "9d4e5520-1c8d-49bb-933d-9f4e2a8c2003", ref: "working" },
      panel: {
        manifest: descriptor.manifest,
        content: {
          html: files["panel.html"],
          module: files["panel.mjs"],
          recipes: files["recipes.md"],
          ...descriptor.content,
        },
      },
      previewContext: { kind: "build-test", test: null },
    });

    const projectionIds = new Set(projections.map((p) => p.id));
    const referencedIds = Object.values(parsedPanel.manifest.members).map((member) =>
      "projectionId" in member.target ? member.target.projectionId : null,
    );
    const enKeys = Object.keys(messages.en).sort();
    const zhKeys = Object.keys(messages["zh-CN"]).sort();
    const configLabelKeys = projections.flatMap(({ input: p }) => {
      const optionKeys = Array.isArray(p.config.options)
        ? p.config.options.map((opt) => opt?.labelKey)
        : [];
      return [p.config.emptyText, p.config.ariaLabelKey, ...optionKeys].filter((v) => typeof v === "string");
    });

    return {
      panelId: PANEL_ID,
      hasModule: typeof parsedPanel.content.module === "string" && parsedPanel.content.module.trim().length > 0,
      candidateHasModule: typeof candidate.panel.content.module === "string" && candidate.panel.content.module.trim().length > 0,
      rejectsSdkPin,
      candidateHasSdkVersion: Object.hasOwn(descriptor, "sdkVersion"),
      candidateMembers: Object.keys(candidate.panel.manifest.members).sort(),
      allMembersReferenceDeclaredProjections: referencedIds.every((id) => id !== null && projectionIds.has(id)),
      localesMatch: JSON.stringify(enKeys) === JSON.stringify(zhKeys),
      allLabelKeysTranslated: configLabelKeys.every(
        (key) => Boolean(messages.en[key]) && Boolean(messages["zh-CN"][key]),
      ),
      selectedAcceptsOntologyType: matchesDirectPanelValue(parsedPanel.manifest.state.selected.type, {
        className: "platform:OntologyType",
        primaryKey: "platform:BusinessKnowledge",
      }),
      startAcceptsOntologyType: matchesDirectPanelValue(parsedPanel.manifest.state.start.type, {
        className: "platform:OntologyType",
        primaryKey: "platform:BusinessKnowledge",
      }),
      selectedRejectsUnlayeredOption: !matchesDirectPanelValue(parsedPanel.manifest.state.selected.type, {
        className: "platform:ModelOption",
        primaryKey: "m-1",
      }),
    };
  }));

  assert.deepEqual(result, {
    panelId: "capability-map",
    hasModule: true,
    candidateHasModule: true,
    rejectsSdkPin: true,
    candidateHasSdkVersion: false,
    candidateMembers: ["graph", "relations", "typeObjects", "userPicker"],
    allMembersReferenceDeclaredProjections: true,
    localesMatch: true,
    allLabelKeysTranslated: true,
    selectedAcceptsOntologyType: true,
    startAcceptsOntologyType: true,
    selectedRejectsUnlayeredOption: true,
  });
});

test("material CLI emits candidate, projections, and panels payloads without --sdk-version", async () => {
  for (const [command, topKey] of [["candidate", "files"], ["projections", "projections"], ["panels", "panels"]]) {
    const { stdout } = await execFileAsync(process.execPath, [join(HERE, "material.mjs"), command], { cwd: HERE });
    const parsed = JSON.parse(stdout);
    assert.ok(Array.isArray(parsed[topKey]) && parsed[topKey].length > 0, `${command} must emit ${topKey}`);
  }
});
