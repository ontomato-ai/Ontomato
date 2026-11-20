import { vuePanelContent } from "../../../__tests__/fixtures/vue-panel";
import { ONTOLOGY_TYPE } from "@ontomato/contracts/platform-object-types";
import { appsSdkReleaseManifestSchema } from "@ontomato/contracts/apps-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { panelManifestSchema } from "@ontomato/contracts/panel-manifest";
import type { ApplicationPanelUse, PanelSkillSource } from "@ontomato/contracts/product-panels";
import { components } from "../../../../../apps-sdk/src/catalogue";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { parseSkillMarkdown } from "../../../core/skills/manifest";
import { backendGet } from "../../../utils/backend-client";
import { findCurrentProduct, type CurrentProductRow } from "../../../infrastructure/product-current";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://java.test" } } }));
vi.mock("../../../config/environment", () => ({
  environment: { agentRuntime: () => ({ queryServiceToken: "fixture-platform-service" }), publicBasePath: () => "" },
}));
vi.mock("../../../core/skills", () => ({ registerSkillProvider: vi.fn() }));
vi.mock("../../../utils/backend-client", () => ({ backendGet: vi.fn() }));
vi.mock("../../../infrastructure/product-current", () => ({ findCurrentProduct: vi.fn() }));

const domainId = "trial-domain";
const example = new URL("../../../../../apps-sdk/examples/panels/schedules-trial/", import.meta.url);
const definitions = fileURLToPath(new URL("definitions.mjs", example));
const trial = await import(definitions) as {
  applications: { applicationId: string; panelUses: ApplicationPanelUse[] }[];
  panels: { id: string; directory: string; manifest: unknown; name: string; description: string }[];
  projections: { id: string; input: Record<string, unknown> }[];
  panelContent(directory: string): { html: string; module: string; recipes?: string };
};

const uses: PanelSkillSource[] = trial.applications.flatMap(application => application.panelUses.map(use => ({
  applicationId: application.applicationId, useId: use.id, panelId: use.panelId, path: use.path,
  entrance: "permissionCode" in use.access
    ? { pageKey: use.pageKey, permissionCode: use.access.permissionCode }
    : { pageKey: use.pageKey, access: use.access.kind },
})));
const skill = (name: string) => ({ namespace: { kind: "domain" as const, domainId }, name });
const taskRef = skill("captured-task-skill");
const taskInput = { kind: "object", objectType: "platform:ScheduledTask" } as const;
const selectedTask = { type: taskInput, external: true, deepLink: true, default: null };
const taskInputBinding = { task: { state: "selectedTask" } };
const trialPanels = new Map(trial.panels.map(panel => [panel.id, {
  name: panel.name, description: panel.description, manifest: panel.manifest,
  visibility: "domain", content: trial.panelContent(panel.directory),
}] as const));
let panels = new Map(trialPanels);
const trialProjections = new Map(trial.projections.map(({ id, input }) => [id, input]));

const extraProjections = new Map<string, Record<string, unknown>>();
const runProjection = trialProjections.get("projection-schedules-run")!;
function codeTasksPanel(projections: Record<string, { projectionId: string; inputs: object }>) {
  const id = uses[0]!.panelId;
  const row = trialPanels.get(id)!;
  const panel = {
    ...row,
    content: { ...row.content, ...vuePanelContent(...Object.keys(projections)) },
    manifest: {
      state: { selectedTask },
      members: Object.fromEntries(Object.entries(projections).map(([key, { projectionId, inputs }]) =>
        [key, { target: { projectionId }, inputs }])),
      events: {},
    },
  };
  panels.set(id, panel);
  return panel;
}

let root: string;
let panelSkillProvider: typeof import("../skill-provider").panelSkillProvider;
beforeEach(async () => {
  vi.clearAllMocks();
  panels = new Map(trialPanels);
  extraProjections.clear();
  root = await mkdtemp(path.join(os.tmpdir(), "panel-skill-"));
  const currentVersion = "2.0.0-pilot";
  const build = path.join(root, "dist/apps-sdk");
  const bundled = path.join(build, currentVersion);
  const manifest = appsSdkReleaseManifestSchema.parse({
    version: currentVersion,
    product: "ontomato",
    executionContext: 1,
    hostTransport: 1,
    messageBridge: 2,
    entries: { "@ontomato/sdk/panel": "panel.js" },
    stylesheet: "styles/sdk.css",
    components: "catalogue/metadata.json",
    check: "node/panel-check.mjs",
    libraries: {},
    docs: "docs/index.md",
  });
  await mkdir(path.dirname(path.join(bundled, manifest.components)), { recursive: true });
  await writeFile(path.join(build, "current.json"), JSON.stringify({ version: currentVersion, digest: "a".repeat(64) }));
  await writeFile(path.join(bundled, "sdk.json"), JSON.stringify(manifest));
  await writeFile(path.join(bundled, manifest.components), JSON.stringify({
    version: currentVersion,
    components: components.map(component => {
      const ports = { props: [], events: [], slots: [] };
      if (component.componentId === "ObjectSummary") return { ...component, ports, meaning: "Summary from the current SDK release." };
      if (component.componentId === "ObjectList") return { ...component, ports, meaning: "List from the current SDK release." };
      return { ...component, ports };
    }),
  }));
  installContentLayout({ runtimeRoot: root, prompts: [], publicSkillsRoot: root, runtimeResources: [] });
  ({ panelSkillProvider } = await import("../skill-provider"));
  vi.mocked(findCurrentProduct).mockImplementation(async (requestedDomain, kind, id) => {
    const definition = kind === "panel" ? panels.get(id) : extraProjections.get(id) ?? trialProjections.get(id);
    return requestedDomain === domainId && definition
      ? { id, definition, domainId, ownerId: "fixture-owner", revision: 1 } as CurrentProductRow
      : undefined;
  });
});
afterEach(() => rm(root, { recursive: true }));

function javaSources(sources: PanelSkillSource[]) {
  vi.mocked(backendGet).mockImplementation(async (_endpoint, url) => ({
    status: 200, statusText: "OK", headers: new Headers(),
    text: JSON.stringify({ success: true, data: new URL(url).searchParams.get("domainId") === domainId ? sources : [] }),
  }));
}

it("provides a single protected source for all uses of the same panel and lists its full dependencies", async () => {
  javaSources([...uses, uses[0]!]);
  const offerings = await panelSkillProvider.list({ domainId });
  const [tasks, summary] = offerings;
  expect(offerings).toHaveLength(2);
  expect(tasks).toMatchObject({
    kind: "protected", sourceKey: uses[0]!.panelId, entrances: [uses[0]!.entrance, uses[1]!.entrance],
  });
  expect([...tasks!.resourceIds].sort()).toEqual([uses[0]!.panelId, ...trial.projections.map(projection => projection.id)].sort());
  expect(summary).toMatchObject({
    kind: "protected", sourceKey: uses[2]!.panelId, entrances: [uses[2]!.entrance],
    resourceIds: [uses[2]!.panelId, "projection-schedules-summary"],
  });
  expect(vi.mocked(findCurrentProduct).mock.calls).toEqual(trial.panels.map(panel => [domainId, "panel", panel.id]));
  expect(await panelSkillProvider.list({ domainId: "another-domain" })).toEqual([]);
  const manifest = await tasks!.readManifest(taskRef);
  const pkg = await tasks!.provide(taskRef);
  await summary!.readManifest(skill("captured-summary-skill"));
  expect(manifest.name).toBe(taskRef.name);
  expect(pkg.skill).toEqual(taskRef);
  expect(parseSkillMarkdown(pkg.files[0]!.content)?.manifest).toEqual(manifest);
  expect(pkg.files[0]!.content).not.toContain(uses[1]!.path);
  expect(pkg.files[0]!.content).toContain("run.runNow");
  const reads = vi.mocked(findCurrentProduct).mock.calls;
  expect(reads).toHaveLength(trial.panels.length + trial.projections.length);
  expect(backendGet).toHaveBeenNthCalledWith(1, "panel-skill-sources",
    "http://java.test/platform/applications/panel-skill-sources?domainId=trial-domain",
    { headers: { "X-Ontomato-Query-Service-Token": "fixture-platform-service" }, retries: 1 });
});

it("loads only the requested panel skill and pinpoints an invalid dependent projection", async () => {
  javaSources(uses);
  const brokenId = "projection-schedules-run";
  extraProjections.set(brokenId, {
    ...runProjection,
    data: { operation: { source: { operation: "schedules.runNow" }, read: "describe", params: {} } },
  });
  const summary = await panelSkillProvider.findByUse(domainId, uses[2]!);
  await expect(summary!.readManifest(taskRef)).resolves.toMatchObject({ name: taskRef.name });
  expect(vi.mocked(findCurrentProduct).mock.calls).toEqual([
    [domainId, "panel", uses[2]!.panelId],
    [domainId, "projection", "projection-schedules-summary"],
  ]);

  const broken = await panelSkillProvider.findByUse(domainId, uses[0]!);
  expect(broken?.resourceIds).toContain(brokenId);
  const failure = {
    code: "SKILL_SOURCE_UNAVAILABLE",
    message: expect.stringContaining(`Panel '${uses[0]!.panelId}' skill is unavailable: projection '${brokenId}', field 'data.operation.source'`),
  };
  await expect(broken!.readManifest(taskRef)).rejects.toMatchObject(failure);
  await expect(broken!.provide(taskRef)).rejects.toMatchObject(failure);
});

it("uses the panel's default-locale text for declared state operation labels", async () => {
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { messages: en, ...enLocaleMeta } },
  });
  const source = uses[2]!;
  const id = source.panelId;
  const panel = panels.get(id)!;
  javaSources([source]);
  vi.mocked(findCurrentProduct).mockResolvedValueOnce({
    id, domainId, ownerId: "fixture-owner", revision: 1,
    createdAt: new Date("2026-11-20T00:00:00Z"), updatedAt: new Date("2026-11-20T00:00:00Z"),
    definition: {
      ...panel,
      manifest: {
        ...panelManifestSchema.parse(panel.manifest),
        events: {
          review: { labelKey: "actions.review", do: { set: { fields: { selectedTask: { literal: null } } } } },
          reset: { labelKey: "actions.reset", do: { set: { fields: { selectedTask: { literal: null } } } } },
        },
      },
      content: { ...panel.content, messages: { en: { "actions.review": "Review scheduled tasks" } } },
    },
  });

  const [offering] = await panelSkillProvider.list({ domainId });
  const { files } = await offering!.provide(taskRef);
  expect(files[0]!.content).toContain("Review scheduled tasks (review)");
  expect(files[0]!.content).toContain("actions.reset (reset)");
});

it("reads the direct trial panel from the current SDK catalogue", async () => {
  javaSources([uses[0]!]);
  const [offering] = await panelSkillProvider.list({ domainId });
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  expect(markdown).toContain(trial.panels[0]!.name);
  expect(markdown).toContain("Summary from the current SDK release.");
  expect(markdown).toContain('Named data: {"record":');
});

it("describes a code panel's fixed projections using the current SDK", async () => {
  const source = uses[2]!;
  const id = source.panelId;
  const panel = panels.get(id)!;
  const manifest = panelManifestSchema.parse(panel.manifest);
  extraProjections.set("legacy-list", {
    ...trialProjections.get("projection-schedules-tasks")!, inputs: {},
  });
  panels.set(id, { ...panel, manifest: {
    ...manifest, members: { ...manifest.members, list: { target: { projectionId: "legacy-list" } } },
  } });
  javaSources([source]);

  const [offering] = await panelSkillProvider.list({ domainId });
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  expect(markdown).toContain("Summary from the current SDK release.");
  expect(markdown).toContain("List from the current SDK release.");
  expect(markdown).toContain('Named data: {"record":');
  expect(markdown).toContain('"read":"record","params":{},"result":"panelRecord"');
});

it("binds the current SDK digest to the supplied panel bytes for the lifetime of the offering", async () => {
  javaSources([uses[0]!]);
  const [first] = await panelSkillProvider.list({ domainId });
  const original = await first!.provide(taskRef);
  const filename = path.join(root, "dist/apps-sdk/current.json");
  const current = JSON.parse(await readFile(filename, "utf8"));
  await writeFile(filename, JSON.stringify({ ...current, digest: "b".repeat(64) }));

  const [second] = await panelSkillProvider.list({ domainId });
  expect(await first!.provide(taskRef)).toEqual(original);
  const updated = await second!.provide(taskRef);
  expect(updated.skill).toEqual(original.skill);
  expect(updated.files[0]!.content).not.toBe(original.files[0]!.content);
});

it("keeps the package and recipes for a panel independent of its entrance", async () => {
  extraProjections.set("legacy-form", trialProjections.get("projection-schedules-form")!);
  extraProjections.set("legacy-run", runProjection);
  const panel = codeTasksPanel({
    form: { projectionId: "legacy-form", inputs: taskInputBinding },
    run: { projectionId: "legacy-run", inputs: taskInputBinding },
  });
  const ref = taskRef;
  javaSources([uses[0]!, uses[1]!]);
  const [offering] = await panelSkillProvider.list({ domainId });
  const manifest = await offering!.readManifest(ref);
  expect(manifest.description).toBe(
    "Read current data, open the panel, draft changes, and review declared operations for " + panel.name + ".",
  );
  javaSources([uses[1]!]);
  const [otherEntrance] = await panelSkillProvider.list({ domainId });
  expect(await otherEntrance!.provide(ref)).toEqual(await offering!.provide(ref));
  const originalName = panel.name;
  panel.name = "Renamed independently of the locator";
  try {
    const pkg = await offering!.provide(taskRef);
    expect(pkg.skill).toEqual(ref);
    const markdown = pkg.files[0]!.content;
    expect(parseSkillMarkdown(markdown)?.manifest).toEqual(await offering!.readManifest(taskRef));
    expect(markdown).toContain(originalName);
    expect(markdown).toContain(await readFile(new URL("p/recipes.md", example), "utf8"));
    expect(markdown).not.toContain("/applications/app-panels-trial-a/tasks");
    expect(markdown).not.toContain("/applications/app-panels-trial-b/tasks");
    expect(markdown).toContain("PlatformObjectType:platform:ScheduledTask");
    expect(markdown).toContain("platform:ScheduledTask.save");
    expect(markdown).toContain("handlerRef schedules.runNow");
    expect(markdown).toContain('"state":"selectedTask"');
    expect(markdown).toContain("POST /platform/scheduled-tasks/applications/:appId/form");
    expect(markdown).toContain("for `PlatformObjectType:platform:ScheduledTask`.");
    expect(markdown).toContain("POST JSON with `values`, `changedField`, `taskId`, and `timeZone`.");
    const readSection = markdown.split("### Read current data")[1]!.split("### Open the panel")[0]!;
    expect(readSection).toContain("`ONTOMATO_TK` is set, send `tk: $ONTOMATO_TK`");
    expect(readSection).toContain("`ONTOMATO_API_KEY` is set, send `X-API-Key: $ONTOMATO_API_KEY`");
    expect(readSection).toContain("/api/assistant/executions/<runId>/ontology");
    expect(readSection).toContain("Never send callback headers to a direct Java URL");
    expect(readSection).toContain("An anonymous direct Java URL needs no authentication header");
    expect(markdown).toContain('"pageKey": "<current page context pageKey>"');
    expect(markdown).toContain('"form": {}');
    const draftSection = markdown.split("### Draft a change")[1]!.split("### Declared operations")[0]!;
    expect(draftSection).toContain("Use the owner-described values in `form`.");
    expect(markdown.split("### Declared operations")[1]!).toContain("Send the returned string values and the current task revision in call.input.");
    expect(markdown).toContain('"required":["values","revision"]');
    expect(markdown).toContain("$ONTOMATO_PANEL_OPERATIONS_URL/operate");
    expect(markdown).toContain("/intents/<intentId>/dispatch");
    expect(markdown).toContain("End this tool call immediately; do not wait or poll.");
    expect(markdown).not.toContain("fixture-platform-service");
    expect(markdown).not.toContain("fixture-owner");
    expect(markdown).not.toContain(panel.content.html);
    const [renamed] = await panelSkillProvider.list({ domainId });
    const renamedManifest = await renamed!.readManifest(ref);
    expect(renamedManifest.description).toContain(panel.name);
    const updatedMarkdown = (await renamed!.provide(taskRef)).files[0]!.content;
    expect(updatedMarkdown).toContain(`## ${panel.name}`);
    expect(parseSkillMarkdown(updatedMarkdown)?.manifest).toEqual(renamedManifest);
    expect(findCurrentProduct).toHaveBeenCalledWith(domainId, "panel", uses[0]!.panelId);
  } finally {
    panel.name = originalName;
  }
});

it("describes B's direct summary data without adding agent operations", async () => {
  javaSources([uses[2]!]);
  const [offering] = await panelSkillProvider.list({ domainId });
  expect((await offering!.readManifest(taskRef)).description).toBe(`Read current data and open the panel for ${trial.panels[1]!.name}.`);
  const { files } = await offering!.provide(taskRef);
  const markdown = files[0]!.content;
  expect(parseSkillMarkdown(markdown)?.manifest).toEqual(await offering!.readManifest(taskRef));
  expect(markdown).toContain('Named data: {"record":');
  expect(markdown).toContain("### Open the panel");
  expect(markdown).toContain("No operations.");
  expect(markdown).not.toContain("### Draft a change");
  expect(markdown).not.toContain("### Recipes");
});

it("advertises a declared operation without promising a draft when there is no form", async () => {
  javaSources([uses[0]!]);
  extraProjections.set("legacy-run", runProjection);
  const panel = codeTasksPanel({ run: { projectionId: "legacy-run", inputs: taskInputBinding } });
  const [offering] = await panelSkillProvider.list({ domainId });
  expect((await offering!.readManifest(taskRef)).description).toBe(`Open the panel and review declared operations for ${panel.name}.`);
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  expect(markdown).toContain("handlerRef schedules.runNow");
  expect(markdown).not.toContain("### Draft a change");
  expect(markdown).not.toContain("### Read current data");
});

it("describes both graph bindings and their single metadata read", async () => {
  javaSources([uses[0]!]);
  extraProjections.set("graph-fixture", {
    name: "Data scope", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectGraph",
    inputs: {}, outputs: {}, config: { edgeEnds: { source: "/fromclass", target: "/toclass" } },
    data: {
      nodes: { source: { type: { kind: "PlatformObjectType", id: "platform:ObjectType" } }, read: "list", params: {} },
      edges: { source: { type: { kind: "PlatformObjectType", id: "platform:Relationship" } }, read: "list", params: {} },
    },
  });
  codeTasksPanel({ graph: { projectionId: "graph-fixture", inputs: {} } });
  const [offering] = await panelSkillProvider.list({ domainId });
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  expect(markdown).toContain('"id":"platform:ObjectType"');
  expect(markdown).toContain('"edgeEnds":{"source":"/fromclass","target":"/toclass"}');
  expect(markdown.match(/POST \/admin\/getMetas/gu)).toHaveLength(1);
});

it("describes the platform ontology's five workbench reads once across both graph bindings", async () => {
  javaSources([uses[0]!]);
  const source = { type: { kind: "PlatformObjectType", id: ONTOLOGY_TYPE } };
  extraProjections.set("ontology-graph", {
    name: "Platform ontology", description: "", visibility: "domain", componentId: "@ontomato/sdk:OntologyGraph",
    inputs: { node: { kind: "json" }, type: { kind: "scalar", type: "string" } }, outputs: {}, config: {},
    data: {
      schema: { source, read: "schema", params: {} },
      neighbors: { source, read: "neighbors", params: { node: { input: "node" } } },
      objects: { source, read: "objects", params: { type: { input: "type" } } },
    },
  });
  codeTasksPanel({ graph: { projectionId: "ontology-graph", inputs: {} } });
  const [offering] = await panelSkillProvider.list({ domainId });
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  const reads = markdown.split("### Read current data")[1]!.split("### Open the panel")[0]!;
  for (const [method, name] of [
    ["GET", "schema"], ["GET", "counts"], ["GET", "start"], ["POST", "neighbors"], ["POST", "objects"],
  ]) {
    const command = "`" + method + " /api/platform-ontology/" + name + "` on `ONTOMATO_WORKBENCH_URL`";
    expect(reads.split(command)).toHaveLength(2);
  }
  expect(reads).toContain("relationKinds?");
  expect(reads).toContain("keyword?");
});
