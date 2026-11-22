import assert from "node:assert/strict";
import { vuePanelContent } from "../../../__tests__/fixtures/vue-panel";
import { APPLICATION_PANEL_USE, EXPORT_SKILL, ONTOLOGY_TYPE, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
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
import { SkillSourceRecordError, type SkillSourceFailure } from "../../../core/skills/providers";
import { backendGet, backendPost } from "../../../utils/backend-client";
import { findCurrentProduct, type CurrentProductRow } from "../../../infrastructure/product-current";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://java.test" } } }));
vi.mock("../../../config/environment", () => ({
  environment: { agentRuntime: () => ({ queryServiceToken: "fixture-platform-service" }), publicBasePath: () => "" },
}));
vi.mock("../../../core/skills", () => ({ registerSkillProvider: vi.fn() }));
vi.mock("../../../utils/backend-client", async importOriginal => ({
  ...await importOriginal<typeof import("../../../utils/backend-client")>(), backendGet: vi.fn(), backendPost: vi.fn(),
}));
vi.mock("../../../infrastructure/product-current", () => ({ findCurrentProduct: vi.fn() }));

const domainId = "trial-domain";
const skillReader = { token: "fixture-reader", locale: "en" };
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
      commands: {},
    },
  };
  panels.set(id, panel);
  return panel;
}

let root: string;
let panelSkillProvider: typeof import("../skill-provider").panelSkillProvider;
const reportSourceFailure = vi.fn<[SkillSourceFailure], void>();
beforeEach(async () => {
  vi.clearAllMocks();
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: true,
    packs: {
      en: { messages: en, ...enLocaleMeta },
      "zh-CN": { ...enLocaleMeta, messages: { ...en, "panels.skill.export": "导出" } },
    },
  });
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
    packageComponents: "node/package-components.mjs",
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
  const offerings = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
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
  expect(await panelSkillProvider.list({ domainId: "another-domain", reader: skillReader, reportSourceFailure })).toEqual([]);
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

it("describes panel commands as addresses or declared operations in the generated skill", async () => {
  const use = uses[0]!;
  const panel = codeTasksPanel({ run: { projectionId: "projection-schedules-run", inputs: taskInputBinding } });
  panels.set(use.panelId, { ...panel, manifest: {
    ...panel.manifest,
    state: { ...panel.manifest.state, mode: { type: { kind: "scalar", type: "string" }, deepLink: true } },
    members: { ...panel.manifest.members, details: { target: { panelId: "panel-task-details" } } },
    commands: {
      reset: { labelKey: "task.reset", primary: true, do: { set: { fields: { mode: { literal: "instance" }, selectedTask: { literal: null } } } } },
      summaryMode: { labelKey: "task.summary", do: { set: { fields: { mode: { literal: "summary" } } } } },
      runSelected: { labelKey: "task.run", do: { invoke: { member: "run", operation: "runNow",
        inputs: { task: { state: "selectedTask" } } } } },
      openOverview: { labelKey: "task.overview", do: { open: { mode: "entry",
        entry: { literal: { className: APPLICATION_PANEL_USE, primaryKey: "overview" } } } } },
      openDetails: { labelKey: "task.details", do: { open: { mode: "drawer", member: "details" } } },
    },
  } });
  javaSources(uses);
  const offering = await panelSkillProvider.findByUse(domainId, use, skillReader);
  assert(offering && "provide" in offering);
  const shared = await offering.provide(taskRef);
  const { content } = shared.files[0]!;
  const reads = content.split("### Read current data\n")[1]!.split("\n### Open the panel")[0];
  expect(reads).toContain('memberPath: [previewSegment,{member:"detail"}]');
  expect(reads).toContain('dataName: "record"');
  const operations = content.split("### Declared operations\n")[1]!.split("\n### ")[0];
  expect(operations).toContain("operations:true");
  expect(operations).toContain('memberPath: [previewSegment,{member:"approve"}]');
  expect(operations).toContain('operationId: "preview.approve.approve"');
  const commands = content.split("### Panel commands\n")[1]!.split("\n\n### Declared operations")[0];
  expect(commands).toContain("The `/operate` endpoint accepts only IDs from Declared operations.");
  expect(commands).toContain('(reset). Open the current panel\'s canonical address. Set `mode` = `"instance"`, `selectedTask` = `null`');
  expect(commands).toContain("(runSelected). Invoke `run.runNow` as specified under Declared operations.");
  expect(commands).toContain("`task` = the current value of state field `selectedTask`");
  expect(commands).toContain('"primaryKey":"overview"');
  expect(commands).toContain("Open the returned `data.use.path`.");
  expect(commands).toContain("Find the admitted entry for panel `panel-task-details`");
  expect(commands).not.toContain(uses[1]!.path);
  const scoped = await offering.provide(taskRef, { entryInputKeys: ["selectedTask"] });
  expect(scoped.skill).toEqual(shared.skill);
  expect(scoped.files[0]!.content).not.toContain("(reset).");
  expect(scoped.files[0]!.content).toContain("(summaryMode).");
  expect(scoped.files[0]!.content).toContain("(runSelected).");
  expect(scoped.files[0]!.content).toContain("(openOverview).");
  expect(await offering.provide(taskRef)).toEqual(shared);
  expect(await offering.provide(taskRef, { entryInputKeys: ["unrelated"] })).toEqual(shared);
});

it.each(["record_missing", "invalid_definition"] as const)("reports %s without offering the affected panel", async reason => {
  const { panelId } = uses[0]!;
  if (reason === "record_missing") panels.delete(panelId);
  else {
    const panel = panels.get(panelId)!;
    panels.set(panelId, { ...panel, manifest: { members: { list: { target: { private: "private-stored-value" } } } } });
  }
  javaSources(uses);

  const offerings = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  expect(offerings.map(offering => offering.sourceKey)).toEqual([uses[2]!.panelId]);
  expect(reportSourceFailure).toHaveBeenCalledTimes(1);
  expect(reportSourceFailure).toHaveBeenCalledWith({
    sourceKey: panelId, entrances: [uses[0]!.entrance, uses[1]!.entrance],
    knownRequiredResourceIds: [panelId], reason,
    ...(reason === "invalid_definition" ? { field: expect.stringMatching(/^manifest\.members\.list\.target/) } : {}),
  });
  expect(JSON.stringify(reportSourceFailure.mock.calls)).not.toContain("private-stored-value");
  await expect(panelSkillProvider.findByUse(domainId, uses[0]!, skillReader)).resolves.toEqual({
    sourceKey: panelId, entrances: [uses[0]!.entrance],
    knownRequiredResourceIds: [panelId], reason,
    ...(reason === "invalid_definition" ? { field: expect.stringMatching(/^manifest\.members\.list\.target/) } : {}),
  });
});

it("keeps a catalogue dependency query failure distinct from a bad panel row", async () => {
  javaSources(uses);
  const outage = new Error("Panel storage unavailable");
  vi.mocked(findCurrentProduct).mockRejectedValueOnce(outage);
  await expect(panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure })).rejects.toBe(outage);
  vi.mocked(findCurrentProduct).mockRejectedValueOnce(outage);
  await expect(panelSkillProvider.findByUse(domainId, uses[0]!, skillReader)).rejects.toBe(outage);
  expect(reportSourceFailure).not.toHaveBeenCalled();
});

it("loads only the requested panel skill and pinpoints an invalid dependent projection", async () => {
  javaSources(uses);
  const brokenId = "projection-schedules-run";
  extraProjections.set(brokenId, {
    ...runProjection,
    data: { operation: { source: { operation: "schedules.runNow" }, read: "describe", params: {} } },
  });
  const summary = await panelSkillProvider.findByUse(domainId, uses[2]!, skillReader);
  assert(summary && "kind" in summary);
  await expect(summary.readManifest(taskRef)).resolves.toMatchObject({ name: taskRef.name });
  expect(vi.mocked(findCurrentProduct).mock.calls).toEqual([
    [domainId, "panel", uses[2]!.panelId],
    [domainId, "projection", "projection-schedules-summary"],
  ]);

  const [listed] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  await expect(listed!.readManifest(taskRef)).rejects.toMatchObject({
    detail: { resourceId: brokenId, field: "data.operation.source", reason: "invalid_definition" },
  });
  expect(reportSourceFailure).not.toHaveBeenCalled();

  const broken = await panelSkillProvider.findByUse(domainId, uses[0]!, skillReader);
  assert(broken && "kind" in broken);
  expect(broken.resourceIds).toContain(brokenId);
  const detail = { resourceId: brokenId, field: "data.operation.source", reason: "invalid_definition" };
  const manifest = broken.readManifest(taskRef);
  await expect(manifest).rejects.toBeInstanceOf(SkillSourceRecordError);
  await expect(manifest).rejects.toMatchObject({ detail });
  await expect(broken.provide(taskRef)).rejects.toMatchObject({ detail });
});

it.each([
  { reason: "component_missing", field: "componentId", invalid: { componentId: "@ontomato/sdk:MissingComponent" } },
  { reason: "operation_unregistered", field: "operations.runNow", invalid: {
    operations: { runNow: { operation: { kind: "PlatformOperation", id: "private.operation" }, target: { input: "task" } } },
  } },
])("reports $reason only after loading the projection and the current release", async ({ reason, field, invalid }) => {
  const projectionId = "projection-schedules-run";
  javaSources([uses[0]!]);
  extraProjections.set(projectionId, { ...runProjection, ...invalid });
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  expect(offering!.resourceIds).toContain(projectionId);
  await expect(offering!.readManifest(taskRef)).rejects.toMatchObject({ detail: { resourceId: projectionId, field, reason } });
  expect(reportSourceFailure).not.toHaveBeenCalled();
});

it("propagates a broken SDK release as an overall failure rather than an unavailable component", async () => {
  javaSources([uses[0]!]);
  await writeFile(path.join(root, "dist/apps-sdk/current.json"), "{ invalid");
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  await expect(offering!.readManifest(taskRef)).rejects.toThrow("Unable to read the current SDK component catalogue");
  expect(reportSourceFailure).not.toHaveBeenCalled();
});

it("uses the panel's default-locale text for panel command labels", async () => {
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
        commands: {
          review: { labelKey: "actions.review", do: { set: { fields: { selectedTask: { literal: null } } } } },
          reset: { labelKey: "actions.reset", do: { set: { fields: { selectedTask: { literal: null } } } } },
        },
      },
      content: { ...panel.content, messages: { en: { "actions.review": "Review scheduled tasks" } } },
    },
  });

  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  const { files } = await offering!.provide(taskRef);
  expect(files[0]!.content).toContain("Review scheduled tasks (review)");
  expect(files[0]!.content).toContain("actions.reset (reset)");
});

it("uses owner operation names and fingerprints the names and language visible to the reader", async () => {
  const actionId = "customer-action";
  extraProjections.set("named-operations", {
    ...runProjection,
    operations: {
      runNow: { operation: { kind: "PlatformOperation", id: "schedules.runNow" }, target: { input: "task" } },
      export: { operation: { kind: "PlatformOperation", id: EXPORT_SKILL } },
      customer: { operation: { kind: "Action", id: actionId }, target: { input: "task" } },
    },
  });
  codeTasksPanel({ run: { projectionId: "named-operations", inputs: taskInputBinding } });
  javaSources([uses[0]!]);
  let name = "Start customer review";
  vi.mocked(backendPost).mockImplementation(async (_endpoint, _url, _body, options) => ({
    status: 200, statusText: "OK", headers: new Headers(),
    text: JSON.stringify({
      success: true,
      data: options?.headers?.tk === skillReader.token ? [{
        id: actionId, name, codeHash: "stored-code-hash",
        target: { className: "Customer", keyParameter: "key" },
        function: { parameters: [{ name: "key", type: "TYPE_STRING" }] },
      }] : [],
    }),
  }));

  const readPackage = async (reader: typeof skillReader) => {
    const [offering] = await panelSkillProvider.list({ domainId, reader, reportSourceFailure });
    const manifest = await offering!.readManifest(taskRef);
    const { files } = await offering!.provide(taskRef);
    const markdown = files[0]!.content;
    expect(parseSkillMarkdown(markdown)?.manifest).toEqual(manifest);
    return { markdown, fingerprint: manifest.metadata?.["ontomato-panel-fingerprint"] };
  };
  const first = await readPackage(skillReader);
  expect(first.markdown).toContain("Run now (run.runNow)");
  expect(first.markdown).toContain("Export (run.export)");
  expect(first.markdown).toContain("Start customer review (run.customer)");
  expect(backendPost).toHaveBeenCalledTimes(1);
  expect(backendPost).toHaveBeenCalledWith("action-object-catalog", "http://java.test/action/queryList",
    { status: "PUBLISHED" }, { headers: expect.objectContaining({ tk: skillReader.token, "Accept-Language": "en" }) });

  name = "Review the customer";
  const renamed = await readPackage(skillReader);
  expect(renamed.markdown).toContain("Review the customer (run.customer)");
  expect(renamed.fingerprint).not.toBe(first.fingerprint);

  const localized = await readPackage({ ...skillReader, locale: "zh-CN" });
  expect(localized.markdown).toContain("导出 (run.export)");
  expect(localized.fingerprint).not.toBe(renamed.fingerprint);

  const hidden = await readPackage({ ...skillReader, token: "fixture-other-reader" });
  expect(hidden.markdown).not.toContain("run.customer");
  expect(hidden.fingerprint).not.toBe(renamed.fingerprint);
});

it("reads the direct trial panel from the current SDK catalogue", async () => {
  javaSources([uses[0]!]);
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
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

  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  expect(markdown).toContain("Summary from the current SDK release.");
  expect(markdown).toContain("List from the current SDK release.");
  expect(markdown).toContain('Named data: {"record":');
  expect(markdown).toContain('"read":"record","params":{},"result":"panelRecord"');
});

it("binds the current SDK digest to the supplied panel bytes for the lifetime of the offering", async () => {
  javaSources([uses[0]!]);
  const [first] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  const original = await first!.provide(taskRef);
  const filename = path.join(root, "dist/apps-sdk/current.json");
  const current = JSON.parse(await readFile(filename, "utf8"));
  await writeFile(filename, JSON.stringify({ ...current, digest: "b".repeat(64) }));

  const [second] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  expect(await first!.provide(taskRef)).toEqual(original);
  const updated = await second!.provide(taskRef);
  expect(updated.skill).toEqual(original.skill);
  expect(updated.files[0]!.content).not.toBe(original.files[0]!.content);
});

it("keeps the package and recipes for a panel independent of its entrance", async () => {
  extraProjections.set("legacy-form", trialProjections.get("projection-schedules-form")!);
  extraProjections.set("legacy-run", runProjection);
  extraProjections.set("projection-editor", {
    name: "Projection editor", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectForm",
    inputs: {}, outputs: {}, config: {},
    data: { createForm: { source: { type: { kind: "PlatformObjectType", id: PRODUCT_PROJECTION } }, read: "createForm", params: {} } },
    operations: { save: { operation: { kind: "PlatformOperation", id: `${PRODUCT_PROJECTION}.save` } } },
  });
  const panel = codeTasksPanel({
    form: { projectionId: "legacy-form", inputs: taskInputBinding },
    catalogue: { projectionId: "projection-editor", inputs: {} },
    run: { projectionId: "legacy-run", inputs: taskInputBinding },
  });
  const ref = taskRef;
  javaSources([uses[0]!, uses[1]!]);
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  const manifest = await offering!.readManifest(ref);
  expect(manifest.description).toBe(
    "Read current data, open the panel, draft changes, and review declared operations for " + panel.name + ".",
  );
  javaSources([uses[1]!]);
  const [otherEntrance] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
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
    expect(markdown).toContain('"objectType":"platform:ScheduledTask"');
    expect(markdown).toContain("platform:ScheduledTask.save");
    expect(markdown).toContain("handlerRef schedules.runNow");
    expect(markdown).toContain('"state":"selectedTask"');
    const readSection = markdown.split("### Read current data")[1]!.split("### Open the panel")[0]!;
    expect(readSection).toContain("POST to `$ONTOMATO_PANEL_OPERATIONS_URL/read`");
    expect(readSection).toContain("Member `form`, dataName `form` — form returns `panelFormDescription`");
    expect(readSection).toContain("X-Ontomato-Callback-Credential");
    expect(readSection).not.toContain("/platform/scheduled-tasks");
    const draftSection = markdown.split("### Draft a change")[1]!.split(/\n### /)[0];
    expect(draftSection).toContain("Follow that form-save operation's drafting instructions under Declared operations");
    const [, draftExample] = draftSection.match(/```json\n([\s\S]*?)\n```/) ?? [];
    expect(JSON.parse(draftExample!)).toMatchObject({ target: { objectType: taskInput.objectType, id: "<owner object id>" } });
    const scheduledForm = draftSection.split("\n").find(line => line.startsWith("- Form `form.save`."))!;
    expect(scheduledForm).toContain('"target":{"objectType":"platform:ScheduledTask","id":"<owner object id>"}');
    expect(scheduledForm).not.toContain("For creation");
    const projectionForm = draftSection.split("\n").find(line => line.startsWith("- Form `catalogue.save`."))!;
    expect(projectionForm).toContain(`"operation":"projection.update","target":{"objectType":"${PRODUCT_PROJECTION}","id":"<owner object id>"}`);
    expect(projectionForm).toContain(`"operation":"projection.create","target":{"objectType":"${PRODUCT_PROJECTION}"}`);
    expect(draftSection).not.toContain("validate the complete values");
    expect(draftSection).toContain("Write each draft to a fresh output path.");
    expect(draftSection).toContain("test -s \"$ONTOMATO_OUTPUT_DIR/drafts/<name>.page-draft.json\" && printenv ONTOMATO_SESSION_ID ONTOMATO_RUN_ID");
    expect(draftSection).toContain("check that this is the file you just wrote and use the IDs printed by that call");
    expect(draftSection).toContain("Never copy a run ID from the conversation, a previous link, or an earlier run.");
    expect(draftSection).toContain("preserve the entry's existing query parameters");
    expect(draftSection).toContain("site-relative address starting with a single `/`");
    expect(draftSection).toContain("Do not prefix it with `$ONTOMATO_BASE_URL`, a hostname, or a URL scheme.");
    expect(draftSection).toContain("It starts with `outputs/drafts/` and has no leading `/`.");
    expect(draftSection).toContain("URL-encode that value exactly once");
    expect(draftSection).toContain("?draftSessionId=SESSION_ID&draftRunId=RUN_ID&draftPath=outputs%2Fdrafts%2Fedit.page-draft.json");
    expect(draftSection).toContain("In your final reply, the draft link must be a Markdown link with a destination that starts with a single slash");
    expect(draftSection).toContain("Never put a scheme, hostname, port, or `localhost` in the draft link.");
    expect(draftSection).toContain("[Open the draft](/ontology/applications?draftSessionId=SESSION_ID&draftRunId=RUN_ID&draftPath=outputs%2Fdrafts%2Fedit.page-draft.json)");
    expect(markdown).toContain("Never put a scheme, hostname, or port in a platform page link.");
    expect(draftSection).toContain("Use the draft file path only inside `draftPath`. A standalone file link opens a JSON file card.");
    expect(markdown).not.toContain("fixture-platform-service");
    expect(markdown).not.toContain("fixture-owner");
    expect(markdown).not.toContain(panel.content.html);
    const [renamed] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
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
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
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
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  expect((await offering!.readManifest(taskRef)).description).toBe(`Open the panel and review declared operations for ${panel.name}.`);
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  expect(markdown).toContain("handlerRef schedules.runNow");
  expect(markdown).not.toContain("### Draft a change");
  expect(markdown).not.toContain("### Read current data");
});

it("describes both named reads of the model graph", async () => {
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
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  expect(markdown).toContain('"id":"platform:ObjectType"');
  expect(markdown).toContain('"edgeEnds":{"source":"/fromclass","target":"/toclass"}');
  expect(markdown).toContain("Member `graph`, dataName `nodes` — list returns `panelRecordList`");
  expect(markdown).toContain("Member `graph`, dataName `edges` — list returns `panelRecordList`");
});

it("documents only the platform ontology reads declared on the projection", async () => {
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
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  const reads = markdown.split("### Read current data")[1]!.split("### Open the panel")[0]!;
  expect(reads).toContain("Member `graph`, dataName `schema` — schema returns `panelGraphSchema`");
  expect(reads).toContain("Member `graph`, dataName `neighbors` — neighbors returns `panelGraphNeighbors`");
  expect(reads).toContain("Member `graph`, dataName `objects` — objects returns `panelOntologyObjects`");
  expect(reads).not.toContain("dataName `counts`");
  expect(reads).not.toContain("dataName `start`");
});

it("describes listColumn and listRowDetail members, bound operation params, and row-scoped operate guidance", async () => {
  javaSources([uses[0]!]);
  const listProj = trialProjections.get("projection-schedules-tasks")!;
  const summaryProj = trialProjections.get("projection-schedules-summary")!;
  extraProjections.set("row-list", listProj);
  extraProjections.set("row-col-run", {
    ...runProjection,
    inputs: {
      task: { kind: "object", objectType: "platform:ScheduledTask" },
      note: { kind: "scalar", type: "string" },
    },
    operations: {
      runNow: {
        operation: { kind: "PlatformOperation", id: "schedules.runNow" },
        target: { input: "task" },
        params: { note: { input: "note" }, source: { literal: "row-action" } },
      },
    },
  });
  extraProjections.set("row-detail-summary", {
    ...summaryProj,
    operations: {
      runNow: {
        operation: { kind: "PlatformOperation", id: "schedules.runNow" },
        target: { input: "task" },
      },
    },
  });
  const id = uses[0]!.panelId;
  const row = trialPanels.get(id)!;
  panels.set(id, {
    ...row,
    content: { ...row.content, ...vuePanelContent("tasks") },
    manifest: {
      state: { selectedTask },
      members: {
        tasks: { target: { projectionId: "row-list" }, outputs: { selected: { state: "selectedTask" } } },
        rowRun: {
          target: { projectionId: "row-col-run" },
          listColumn: { slot: "tasks", column: "actions" },
          inputs: { task: { item: true }, note: { itemField: "schedule" } },
        },
        rowDetail: {
          target: { projectionId: "row-detail-summary" },
          listRowDetail: { slot: "tasks" },
          inputs: { task: { item: true } },
        },
      },
      commands: {},
    },
  });
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  expect(markdown).toContain("Attached as listColumn on host list `tasks`, column `actions`.");
  expect(markdown).toContain("Attached as listRowDetail on host list `tasks`.");
  expect(markdown).toContain('Row-scoped (listColumn on host list `tasks`, column `actions`).');
  expect(markdown).toContain('Row inputs: {"task":{"item":true},"note":{"itemField":"schedule"}}.');
  expect(markdown).toContain('Bound params: {"note":{"input":"note"},"source":{"literal":"row-action"}}.');
  expect(markdown).toContain("Row-scoped (listRowDetail on host list `tasks`).");
  expect(markdown).toContain("rowContext");
  expect(markdown).toContain("itemKey");
  expect(markdown).toContain("Row-scoped operations accept only a single `call`, never `calls`.");
});

it("refuses generating a panel skill when a listColumn member declares independent data", async () => {
  javaSources([uses[0]!]);
  const listProj = trialProjections.get("projection-schedules-tasks")!;
  const summaryProj = trialProjections.get("projection-schedules-summary")!;
  extraProjections.set("row-list", listProj);
  extraProjections.set("bad-col-with-data", summaryProj);
  const id = uses[0]!.panelId;
  const row = trialPanels.get(id)!;
  panels.set(id, {
    ...row,
    content: { ...row.content, ...vuePanelContent("tasks") },
    manifest: {
      state: { selectedTask },
      members: {
        tasks: { target: { projectionId: "row-list" } },
        badCol: {
          target: { projectionId: "bad-col-with-data" },
          listColumn: { slot: "tasks", column: "actions" },
          inputs: { task: { item: true } },
        },
      },
      commands: {},
    },
  });
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  await expect(offering!.provide(taskRef)).rejects.toThrow(SkillSourceRecordError);
});
