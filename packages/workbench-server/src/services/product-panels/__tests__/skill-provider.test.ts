import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { panelManifestSchema } from "@ontomato/contracts/panel-manifest";
import type { ApplicationPanelUse, PanelSkillSource } from "@ontomato/contracts/product-panels";
import { components } from "../../../../../apps-sdk/src/catalogue";
import { installContentLayout } from "../../../content/layout";
import { parseSkillMarkdown } from "../../../core/skills/manifest";
import { backendGet } from "../../../utils/backend-client";
import { findCurrentProduct, type CurrentProductRow } from "../../../infrastructure/product-current";
import { panelSkillProvider } from "../skill-provider";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://java.test" } } }));
vi.mock("../../../config/environment", () => ({ environment: { agentRuntime: () => ({ queryServiceToken: "fixture-platform-service" }) } }));
vi.mock("../../../core/skills", () => ({ registerSkillProvider: vi.fn() }));
vi.mock("../../../utils/backend-client", () => ({ backendGet: vi.fn() }));
vi.mock("../../../infrastructure/product-current", () => ({ findCurrentProduct: vi.fn() }));

const domainId = "trial-domain";
const version = "trial-sdk";
const example = new URL("../../../../../apps-sdk/examples/panels/schedules-trial/", import.meta.url);
const definitions = fileURLToPath(new URL("definitions.mjs", example));
const trial = await import(definitions) as {
  applications: { applicationId: string; panelUses: ApplicationPanelUse[] }[];
  panels: { id: string; directory: string; manifest: unknown; name: string; description: string }[];
  projections: { id: string; input: Record<string, unknown> }[];
  panelContent(directory: string): Record<string, string>;
};

// Exact refs returned by Java for the same locator keys in PanelApplicationsTest.
const pageNames = [
  "panel-page-panels-trial-a-tasks-5b8e580bfe498f76fd5b2f47",
  "panel-page-panels-trial-b-tasks-078cb1db044a707c17788b14",
  "panel-page-panels-trial-b-summary-bbb7128431ec0bc491e589e0",
];
const menuName = "panel-menu-menu-c661d73dba966285774f9f15";
const uses = trial.applications.flatMap(application => application.panelUses.map(use => ({
  applicationId: application.applicationId, useId: use.id, pageKey: use.pageKey, path: use.path, panelId: use.panelId,
})));
const skill = (name: string) => ({ namespace: { kind: "domain" as const, domainId }, name });
const memberSources: PanelSkillSource[] = uses.map((use, index) => ({ skill: skill(pageNames[index]!), uses: [use] }));
const panels = new Map(trial.panels.map(panel => [panel.id, {
  name: panel.name, description: panel.description, manifest: panel.manifest, visibility: "domain",
  content: trial.panelContent(panel.directory),
}]));

let root: string;
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(path.join(os.tmpdir(), "panel-skill-"));
  const sdk = path.join(root, "dist/apps-sdk");
  await mkdir(path.join(sdk, version), { recursive: true });
  await writeFile(path.join(sdk, "current.json"), JSON.stringify({ version }));
  await writeFile(path.join(sdk, version, "components.json"), JSON.stringify({ version, components }));
  installContentLayout({ runtimeRoot: root, prompts: [], publicSkillsRoot: root, runtimeResources: [] });
  vi.mocked(findCurrentProduct).mockImplementation(async (requestedDomain, kind, id) => {
    const definition = kind === "panel" ? panels.get(id) : trial.projections.find(projection => projection.id === id)?.input;
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

it("uses the three Java member refs and reads only the verified domain and service identity", async () => {
  javaSources(memberSources);
  const offerings = await panelSkillProvider.list({ domainId });
  expect(offerings.map(offering => offering.skill)).toEqual(pageNames.map(skill));
  expect(offerings.map(offering => offering.manifest.description)).toEqual([
    `Read current data, open the panel, draft changes, and review declared operations for ${trial.panels[0]!.name}.`,
    `Read current data, open the panel, draft changes, and review declared operations for ${trial.panels[0]!.name}.`,
    `Read current data and open the panel for ${trial.panels[1]!.name}.`,
  ]);
  expect(await panelSkillProvider.list({ domainId: "another-domain" })).toEqual([]);
  const reads = vi.mocked(findCurrentProduct).mock.calls;
  expect(reads).toHaveLength(trial.panels.length + trial.projections.length);
  expect(reads).toEqual(expect.arrayContaining([
    ...trial.panels.map(panel => [domainId, "panel", panel.id]),
    ...trial.projections.map(projection => [domainId, "projection", projection.id]),
  ]));
  expect(backendGet).toHaveBeenNthCalledWith(1, "panel-skill-sources",
    "http://java.test/platform/applications/panel-skill-sources?domainId=trial-domain",
    { headers: { "X-Ontomato-Query-Service-Token": "fixture-platform-service" }, retries: 1 });
});

it("assembles one current package for a shared menu with a section per use and the original recipes", async () => {
  const ref = skill(menuName);
  javaSources([{ skill: ref, uses: [uses[0]!, uses[2]!] }]);
  const offerings = await panelSkillProvider.list({ domainId });
  expect(offerings.map(offering => offering.skill)).toEqual([ref]);
  const [offering] = offerings;
  expect(offering!.manifest.description).toBe(
    `Read current data, open the panels, draft changes, and review declared operations for ${trial.panels[0]!.name}, ${trial.panels[1]!.name}.`,
  );
  const panel = panels.get(uses[0]!.panelId)!;
  const originalName = panel.name;
  panel.name = "Renamed independently of the locator";
  try {
    const pkg = await offering!.provide();
    expect(pkg.skill).toEqual(ref);
    const markdown = pkg.files[0]!.content;
    expect(parseSkillMarkdown(markdown)?.manifest).toEqual(offering!.manifest);
    expect(markdown).toContain(originalName);
    expect(markdown).toContain(trial.panels[1]!.name);
    expect(markdown).toContain(await readFile(new URL("p/recipes.md", example), "utf8"));
    expect(markdown).toContain("/applications/app-panels-trial-a/tasks");
    expect(markdown).toContain("/applications/app-panels-trial-b/summary");
    expect(markdown).toContain("PlatformObjectType:platform:ScheduledTask");
    expect(markdown).toContain("platform:ScheduledTask.save");
    expect(markdown).toContain("handlerRef schedules.runNow");
    expect(markdown).toContain('"state":"selectedTask"');
    expect(markdown).toContain("POST /platform/scheduled-tasks/applications/:appId/form");
    expect(markdown).toContain("Use these endpoints for `PlatformObjectType:platform:ScheduledTask`.");
    expect(markdown).toContain("POST JSON with `values`, `changedField`, `taskId`, and `timeZone`.");
    expect(markdown).toContain("ONTOMATO_EXECUTION_CALLBACK");
    expect(markdown).toContain('"pageKey": "panels-trial-a-tasks"');
    expect(markdown).toContain('"form": {}');
    expect(markdown).toContain("P3");
    expect(markdown).not.toContain("fixture-platform-service");
    expect(markdown).not.toContain("fixture-owner");
    expect(markdown).not.toContain(panel.content.html);
    const [renamed] = await panelSkillProvider.list({ domainId });
    expect(renamed!.skill).toEqual(ref);
    expect(renamed!.manifest.description).toContain(panel.name);
    const updatedMarkdown = (await renamed!.provide()).files[0]!.content;
    expect(updatedMarkdown).toContain(`## ${panel.name}`);
    expect(parseSkillMarkdown(updatedMarkdown)?.manifest).toEqual(renamed!.manifest);
    expect(findCurrentProduct).toHaveBeenCalledWith(domainId, "panel", uses[0]!.panelId);
  } finally {
    panel.name = originalName;
  }
});

it("advertises only reading and opening for B's summary skill", async () => {
  javaSources([memberSources[2]!]);
  const [offering] = await panelSkillProvider.list({ domainId });
  expect(offering!.manifest.description).toBe(`Read current data and open the panel for ${trial.panels[1]!.name}.`);
  const { files } = await offering!.provide();
  const markdown = files[0]!.content;
  expect(parseSkillMarkdown(markdown)?.manifest).toEqual(offering!.manifest);
  expect(markdown).toContain("### Read current data");
  expect(markdown).toContain("### Open the panel");
  expect(markdown).toContain("No operations.");
  expect(markdown).not.toContain("### Draft a change");
  expect(markdown).not.toContain("### Recipes");
});

it("advertises a declared operation without promising a draft when there is no form", async () => {
  javaSources([memberSources[0]!]);
  const panel = panels.get(uses[0]!.panelId)!;
  const original = panel.manifest;
  const manifest = panelManifestSchema.parse(original);
  panel.manifest = { ...manifest, slots: { run: manifest.slots.run! } };
  try {
    const [offering] = await panelSkillProvider.list({ domainId });
    expect(offering!.manifest.description).toBe(`Open the panel and review declared operations for ${panel.name}.`);
    const markdown = (await offering!.provide()).files[0]!.content;
    expect(markdown).toContain("handlerRef schedules.runNow");
    expect(markdown).not.toContain("### Draft a change");
    expect(markdown).not.toContain("### Read current data");
  } finally {
    panel.manifest = original;
  }
});
