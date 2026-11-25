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
  entrance: { applicationId: application.applicationId, entryKey: use.id, pageKey: use.pageKey },
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
  expect(parseSkillMarkdown(pkg.files[0]!.content)?.manifest).toMatchObject({
    name: manifest.name, description: manifest.description,
  });
  expect(pkg.files[0]!.content).toContain("run.runNow");
  const reads = vi.mocked(findCurrentProduct).mock.calls;
  expect(reads).toHaveLength(trial.panels.length + trial.projections.length);
  expect(backendGet).toHaveBeenNthCalledWith(1, "panel-skill-sources",
    "http://java.test/platform/applications/panel-skill-sources?domainId=trial-domain",
    { headers: { "X-Ontomato-Query-Service-Token": "fixture-platform-service" }, retries: 1 });
});

it("lists only the admitted registered entrances and fingerprints each entrance set", async () => {
  const first = { ...uses[0]!, names: { en: "Scheduled tasks", "zh-CN": "计划任务" },
    applicationNames: { en: "Operations" } };
  const second = { ...uses[1]!, names: { en: "Task administration" }, applicationNames: { en: "Administration" } };
  javaSources([second, first]);
  const [offering] = await panelSkillProvider.list({ domainId, reader: { ...skillReader, locale: "zh-CN" }, reportSourceFailure });
  assert(offering);
  async function provide(...sources: PanelSkillSource[]) {
    const pkg = await offering!.provide(taskRef, { admittedEntrances: sources.map(source => source.entrance) });
    return pkg.files[0]!.content;
  }
  const sourceJson = ({ applicationId, useId }: PanelSkillSource) =>
    JSON.stringify({ kind: "registered", applicationId, useId });
  const firstOnly = await provide(first);
  const secondOnly = await provide(second);
  const both = await provide(first, second);
  expect(firstOnly).toContain("### Available entrances");
  for (const fact of ["计划任务", "Operations", first.path, sourceJson(first)]) expect(firstOnly).toContain(fact);
  for (const fact of ["Task administration", second.path, sourceJson(second)]) expect(firstOnly).not.toContain(fact);
  expect(secondOnly).toContain(second.path);
  expect(secondOnly).not.toContain(first.path);
  for (const fact of ["计划任务", first.path, sourceJson(first), "Task administration", second.path, sourceJson(second)])
    expect(both).toContain(fact);
  const fingerprints = [firstOnly, secondOnly, both].map(content =>
    parseSkillMarkdown(content)?.manifest.metadata?.["ontomato-panel-fingerprint"]);
  expect(fingerprints).not.toContain(undefined);
  expect(new Set(fingerprints).size).toBe(3);
  expect(await provide(second, first)).toBe(both);
  expect((await offering.provide(taskRef)).files[0]!.content).toBe(both);
  const none = await provide();
  expect(none).not.toContain(first.path);
  expect(none).not.toContain(second.path);
});

it("describes member reads and declared operations in the generated skill", async () => {
  const use = uses[0]!;
  const panel = codeTasksPanel({ run: { projectionId: "projection-schedules-run", inputs: taskInputBinding } });
  panels.set(use.panelId, { ...panel, manifest: {
    ...panel.manifest,
    state: { ...panel.manifest.state, mode: { type: { kind: "scalar", type: "string" }, deepLink: true } },
    members: { ...panel.manifest.members, details: { target: { panelId: "panel-task-details" } } },
  } });
  javaSources(uses);
  const offering = await panelSkillProvider.findByUse(domainId, use, skillReader);
  assert(offering && "provide" in offering);
  const shared = await offering.provide(taskRef);
  const { content } = shared.files[0]!;
  const reads = content.split("### Read current data\n")[1]!.split("\n### Open the panel")[0];
  expect(reads).toContain("$ONTOMATO_PANEL_OPERATIONS_URL/nested");
  const operations = content.split("### Declared operations and live page actions\n")[1]!.split("\n### ")[0];
  expect(operations).toContain("operations: true");
  expect(operations).toContain('operation, memberPath?, rowKey?, input?');
  expect(content).not.toContain("### Panel commands");
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
    const { files } = await offering!.provide(taskRef);
    const markdown = files[0]!.content;
    const manifest = parseSkillMarkdown(markdown)!.manifest;
    return { markdown, fingerprint: manifest.metadata?.["ontomato-panel-fingerprint"] };
  };
  const first = await readPackage(skillReader);
  expect(first.markdown).toContain("Run now (run.runNow)");
  expect(first.markdown).toContain("Export (run.export)");
  expect(first.markdown).toContain("Start customer review (run.customer)");
  expect(backendPost).toHaveBeenCalledTimes(1);
  expect(backendPost).toHaveBeenCalledWith("action-object-catalog", "http://java.test/action/queryList",
    { purpose: "execute", status: "PUBLISHED" }, { headers: expect.objectContaining({ tk: skillReader.token, "Accept-Language": "en" }) });

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

it("reads the direct trial panel from the current SDK catalogue without copying generic component meaning", async () => {
  javaSources([uses[0]!]);
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  expect(markdown).toContain(trial.panels[0]!.name);
  expect(markdown).toContain("@ontomato/sdk:ObjectSummary");
  expect(markdown).toContain('Named data: {"record":');
  expect(markdown).not.toContain("Summary from the current SDK release.");
  expect(markdown).not.toContain("List from the current SDK release.");
});

it("describes a code panel's fixed projections using the current SDK without generic component meaning", async () => {
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
  expect(markdown).toContain("@ontomato/sdk:ObjectSummary");
  expect(markdown).toContain("@ontomato/sdk:ObjectList");
  expect(markdown).toContain('Named data: {"record":');
  expect(markdown).toContain('"read":"record","params":{},"result":"panelRecord"');
  expect(markdown).not.toContain("Summary from the current SDK release.");
  expect(markdown).not.toContain("List from the current SDK release.");
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

it("keeps the shared panel recipes when the entry list changes", async () => {
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
    "Read current data, open the panel, fill live forms, and review declared operations for " + panel.name + ".",
  );
  javaSources([uses[1]!]);
  const [otherEntrance] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  const recipes = await readFile(new URL("p/recipes.md", example), "utf8");
  expect((await otherEntrance!.provide(ref)).files[0]!.content).toContain(recipes);
  const originalName = panel.name;
  panel.name = "Renamed independently of the locator";
  try {
    const pkg = await offering!.provide(taskRef);
    expect(pkg.skill).toEqual(ref);
    const markdown = pkg.files[0]!.content;
    expect(markdown).toContain(originalName);
    expect(markdown).toContain(recipes);
    expect(markdown).toContain('"objectType":"platform:ScheduledTask"');
    expect(markdown).toContain("platform:ScheduledTask.save");
    expect(markdown).toContain("handlerRef schedules.runNow");
    expect(markdown).toContain('"state":"selectedTask"');
    const readSection = markdown.split("### Read current data")[1]!.split("### Open the panel")[0]!;
    expect(readSection).toContain("POST to `$ONTOMATO_PANEL_OPERATIONS_URL/read`");
    expect(readSection).toContain("Member `form`, dataName `form` — form returns `panelFormDescription`");
    expect(readSection).toContain("X-Ontomato-Callback-Credential");
    expect(readSection).not.toContain("/platform/scheduled-tasks");
    const formSection = markdown.split("### Fill a live form")[1]!.split("\n### ")[0]!;
    expect(formSection).toContain("Form member `form` (save operation `form.save`, type `platform:ScheduledTask`)");
    expect(formSection).toContain("Form member `catalogue` (save operation `catalogue.save`");
    expect(formSection).toContain("blocked_unsaved");
    expect(formSection).toContain("overwriteUnsaved: true");
    expect(markdown).toContain("Declared public state covers every state field");
    expect(markdown).toContain("current live contents and unsaved status of open forms");
    expect(markdown).toContain("observe_display");
    expect(markdown).toContain("call `present({ target, state })` immediately in this round");
    expect(markdown).toContain("including fields not marked `deepLink`");
    expect(markdown).toContain("awaiting_confirmation");
    expect(markdown).toContain("instance, target, and form contents have not changed");
    expect(markdown).toContain("Never put a scheme, hostname, or port in a platform page link.");
    expect(markdown).not.toContain("fixture-platform-service");
    expect(markdown).not.toContain("fixture-owner");
    expect(markdown).not.toContain(panel.content.html);
    const [renamed] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
    const renamedManifest = await renamed!.readManifest(ref);
    expect(renamedManifest.description).toContain(panel.name);
    const updatedMarkdown = (await renamed!.provide(taskRef)).files[0]!.content;
    expect(updatedMarkdown).toContain(`## ${panel.name}`);
    expect(parseSkillMarkdown(updatedMarkdown)?.manifest.description).toBe(renamedManifest.description);
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
  expect(markdown).toContain('Named data: {"record":');
  expect(markdown).toContain("### Open the panel");
  expect(markdown).toContain("No operations.");
  expect(markdown).not.toContain("### Fill a live form");
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
  expect(markdown).not.toContain("### Fill a live form");
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

it("describes row-scoped operations declared on a list projection, bound operation params, and row-scoped page actions", async () => {
  javaSources([uses[0]!]);
  const listProj = trialProjections.get("projection-schedules-tasks")!;
  extraProjections.set("row-list", {
    ...listProj,
    operations: {
      runNow: {
        operation: { kind: "PlatformOperation", id: "schedules.runNow" },
        target: { row: true },
        params: { note: { rowField: "schedule" }, source: { literal: "row-action" } },
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
      },
    },
  });
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  expect(markdown).toContain("Row-scoped operation on list rows.");
  expect(markdown).toContain('Bound params: {"note":{"rowField":"schedule"},"source":{"literal":"row-action"}}.');
  expect(markdown).toContain("`<className>:<primaryKey>`");
  expect(markdown).toContain("verbatim from the corresponding row in the page snapshot");
  expect(markdown).toContain("per-row availability and bound parameters");
  expect(markdown).not.toContain("rowContext");
});

it("refuses generating a panel skill when legacy listColumn syntax is present", async () => {
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
        },
      },
    },
  });
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  await expect(offering!.provide(taskRef)).rejects.toThrow(SkillSourceRecordError);
});

it("describes targetless customer Actions without requiring object selection and names the mounted action", async () => {
  javaSources([uses[0]!]);
  vi.mocked(backendPost).mockImplementation(async (_name, url) => {
    if (String(url).endsWith("/action/queryList")) {
      return {
        text: JSON.stringify({
          success: true,
          data: [
            {
              id: "create-order",
              name: "Create order",
              codeHash: "a".repeat(64),
              target: null,
              definition: { affects: ["Order"] },
              function: { parameters: [{ name: "customer", type: "TYPE_STRING" }] },
            },
          ],
        }),
      } as never;
    }
    throw new Error(`Unexpected backendPost ${url}`);
  });
  extraProjections.set("create-order-btn", {
    name: "Create order button",
    description: "Runs targetless order creation.",
    visibility: "domain",
    componentId: "@ontomato/sdk:OperationButton",
    inputs: {},
    outputs: {},
    data: {},
    config: { operation: "create" },
    operations: {
      create: { operation: { kind: "Action", id: "create-order" } },
    },
  });
  const id = uses[0]!.panelId;
  const row = trialPanels.get(id)!;
  panels.set(id, {
    ...row,
    content: { ...row.content, ...vuePanelContent("createBtn") },
    manifest: {
      state: {},
      members: {
        createBtn: { target: { projectionId: "create-order-btn" } },
      },
    },
  });
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  expect(markdown).toContain("Create order (createBtn.create), Action create-order, target null.");
  expect(markdown).toContain("No object selection is required.");
  expect(markdown).toContain("page_action({ operation: \"createBtn.create\", input? })");
  expect(markdown).not.toContain("for the actual selected object");
  expect(markdown).not.toContain("### Fill a live form");
});

it("documents filling and saving mounted customer Action forms", async () => {
  javaSources([uses[0]!]);
  vi.mocked(backendPost).mockImplementation(async (_name, url) => {
    if (String(url).endsWith("/action/queryList")) {
      return {
        text: JSON.stringify({
          success: true,
          data: [
            {
              id: "create-order",
              name: "Create order",
              codeHash: "a".repeat(64),
              target: null,
              definition: { affects: ["Order"] },
              function: { parameters: [{ name: "customer", type: "TYPE_STRING" }] },
            },
            {
              id: "update-order",
              name: "Update order",
              codeHash: "b".repeat(64),
              target: { className: "Order", keyParameter: "order_id" },
              definition: { affects: ["Order"] },
              function: {
                parameters: [
                  { name: "order_id", type: "TYPE_STRING" },
                  { name: "note", type: "TYPE_STRING" },
                ],
              },
            },
          ],
        }),
      } as never;
    }
    throw new Error(`Unexpected backendPost ${url}`);
  });
  extraProjections.set("order-create-form", {
    name: "Order create form",
    description: "Creates a customer order.",
    visibility: "domain",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: {},
    outputs: {},
    data: {
      createForm: { source: { type: { kind: "ObjectType", id: "Order" } }, read: "createForm", params: {} },
    },
    config: {},
    operations: {
      save: { operation: { kind: "Action", id: "create-order" } },
      approveKnowledge: {
        operation: { kind: "PlatformOperation", id: "knowledge.approve" },
        target: { literal: { className: "platform:BusinessKnowledge", primaryKey: "article" } },
      },
    },
  });
  extraProjections.set("order-edit-form", {
    name: "Order edit form",
    description: "Edits a customer order.",
    visibility: "domain",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: { target: { kind: "object", objectType: "Order" } },
    outputs: {},
    data: {
      form: { source: { object: { input: "target" } }, read: "form", params: {} },
    },
    config: {},
    operations: {
      save: { operation: { kind: "Action", id: "update-order" }, target: { input: "target" } },
    },
  });
  const id = uses[0]!.panelId;
  const row = trialPanels.get(id)!;
  panels.set(id, {
    ...row,
    content: { ...row.content, ...vuePanelContent("createForm", "editForm") },
    manifest: {
      state: {
        selectedOrder: { type: { kind: "object", objectType: "Order" }, personal: false, deepLink: true, external: false },
      },
      members: {
        createForm: { target: { projectionId: "order-create-form" } },
        editForm: { target: { projectionId: "order-edit-form" }, inputs: { target: { state: "selectedOrder" } } },
      },
    },
  });
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  const manifest = await offering!.readManifest(taskRef);
  expect(manifest.description).toContain("fill live forms");
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  const formSection = markdown.split("### Fill a live form")[1]!.split("\n### ")[0]!;
  expect(formSection).toContain("Form member `createForm` (save operation `createForm.save`, type `Order`)");
  expect(formSection).toContain("Form member `editForm` (save operation `editForm.save`, type `Order`)");
  expect(formSection).toContain("present({ target, state })");
  expect(formSection).toContain("fill_form({ member, memberPath?, values, overwriteUnsaved? })");
  expect(markdown).toContain('page_action({ operation: "createForm.save" })');
  expect(markdown).toContain('page_action({ operation: "editForm.save" })');
});

it("never treats a targetless customer Action as a customer form save when a projection also declares a platform form.save", async () => {
  javaSources([uses[0]!]);
  vi.mocked(backendPost).mockImplementation(async (_name, url) => {
    if (String(url).endsWith("/action/queryList")) {
      return {
        text: JSON.stringify({
          success: true,
          data: [
            {
              id: "review-action",
              name: "Submit review",
              codeHash: "c".repeat(64),
              target: null,
              definition: { affects: ["Order"] },
              function: { parameters: [{ name: "note", type: "TYPE_STRING" }] },
            },
          ],
        }),
      } as never;
    }
    throw new Error(`Unexpected backendPost ${url}`);
  });
  extraProjections.set("platform-save-with-review", {
    name: "Knowledge form with review",
    description: "Edits knowledge and exposes a targetless customer review action.",
    visibility: "domain",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: { target: { kind: "object", objectType: "platform:BusinessKnowledge" } },
    outputs: {},
    data: {
      form: { source: { object: { input: "target" } }, read: "form", params: {} },
      createForm: { source: { type: { kind: "PlatformObjectType", id: "platform:BusinessKnowledge" } }, read: "createForm", params: {} },
    },
    config: {},
    operations: {
      save: { operation: { kind: "PlatformOperation", id: "platform:BusinessKnowledge.save" }, target: { input: "target" } },
      review: { operation: { kind: "Action", id: "review-action" } },
    },
  });
  const id = uses[0]!.panelId;
  const row = trialPanels.get(id)!;
  panels.set(id, {
    ...row,
    content: { ...row.content, ...vuePanelContent("knowledgeForm") },
    manifest: {
      state: {
        selected: { type: { kind: "object", objectType: "platform:BusinessKnowledge" }, personal: false, deepLink: true, external: false },
      },
      members: {
        knowledgeForm: { target: { projectionId: "platform-save-with-review" }, inputs: { target: { state: "selected" } } },
      },
    },
  });
  const [offering] = await panelSkillProvider.list({ domainId, reader: skillReader, reportSourceFailure });
  const markdown = (await offering!.provide(taskRef)).files[0]!.content;
  const formSection = markdown.split("### Fill a live form")[1]!.split(/\n### /)[0]!;
  expect(formSection).toContain("knowledgeForm.save");
  expect(formSection).not.toContain("knowledgeForm.review");
  const opsSection = markdown.split("### Declared operations")[1]!;
  expect(opsSection).toContain("Submit review (knowledgeForm.review)");
  expect(opsSection).not.toContain("form save via Action review-action");
});
