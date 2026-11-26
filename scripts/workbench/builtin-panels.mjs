import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const sourceFiles = ["registration.json", "panel.json", "panel.html", "panel.mjs"];

export function javaBuiltinApplications(sources) {
  return sources.flatMap(({ root }) => {
    const packages = join(root, "packages");
    if (!existsSync(packages)) return [];
    return readdirSync(packages, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
      const resources = join(packages, entry.name, "src/main/resources/applications");
      if (!existsSync(resources)) return [];
      return readdirSync(resources).filter(file => file.endsWith(".json")).map(file =>
        JSON.parse(readFileSync(join(resources, file), "utf8")));
    });
  });
}

export async function stageBuiltinPanels({ directory, members, applications, checks, checkSource }) {
  const builtinEntryIds = new Set(applications.flatMap(({ declaration }) =>
    (declaration?.panelUses ?? []).map(use => use.id)));
  const panels = new Map();
  for (const member of members) {
    const source = join(member.absolute, "resources/builtin-panels");
    if (!existsSync(source)) continue;
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const folder = join(source, entry.name);
      const { panelId } = await checkSource(folder, checks, { builtinEntryIds });
      if (panels.has(panelId)) throw new Error(`Duplicate platform panel ${panelId}: ${panels.get(panelId).folder} and ${folder}`);
      const files = [...sourceFiles, ...["recipes.md", "projections.json"].filter(file => existsSync(join(folder, file)))];
      panels.set(panelId, { folder, relative: `${member.name}/${entry.name}`, files });
    }
  }

  for (const application of applications) {
    if (application.framePanelId !== undefined) {
      const label = `Built-in application ${application.id}, frame panel ${application.framePanelId}`;
      const result = checks.builtinProductIdSchema.safeParse(application.framePanelId);
      if (!result.success) throw new Error(`${label}: ${result.error.message}`);
      if (!panels.has(application.framePanelId)) throw new Error(`${label}: panel is missing from the release`);
    }
    for (const use of application.declaration?.panelUses ?? []) {
      if (use.kind === "native") {
        const label = `Built-in application ${application.id}, native entry ${use.id} (${use.path})`;
        const result = checks.builtinNativeEntrySchema.safeParse(use);
        if (!result.success) throw new Error(`${label}: ${result.error.message}`);
        continue;
      }
      if (use.kind === "frame-conversation") {
        const label = `Built-in application ${application.id}, frame conversation entry ${use.id} (${use.path})`;
        const result = checks.frameConversationEntrySchema.safeParse(use);
        if (!result.success) throw new Error(`${label}: ${result.error.message}`);
        continue;
      }
      const label = `Built-in application ${application.id}, entry ${use.id} (${use.path}), panel ${use.panelId}`;
      const result = checks.builtinApplicationPanelUseSchema.safeParse(use);
      if (!result.success) throw new Error(`${label}: ${result.error.message}`);
      if (!panels.has(use.panelId)) throw new Error(`${label}: panel is missing from the release`);
    }
  }

  mkdirSync(directory, { recursive: true });
  const index = [];
  for (const { folder, relative, files } of panels.values()) {
    const destination = join(directory, relative);
    mkdirSync(destination, { recursive: true });
    for (const file of files) copyFileSync(join(folder, file), join(destination, file));
    index.push(relative);
  }
  writeFileSync(join(directory, "index.json"), JSON.stringify(index.sort()) + "\n");
}

export async function prepareBuiltinPanels(root, sharedRoot, members, javaApplications) {
  const server = members.find(member => member.name === "@ontomato/workbench-server");
  const { workbenchApplications } = await import(pathToFileURL(join(server.absolute, "src/services/applications/builtins.ts")).href);
  const skill = join(sharedRoot, "agent-skills/ontomato-app-builder/scripts");
  const { installedPanelSdk } = await import(pathToFileURL(join(skill, "current-sdk.mjs")).href);
  const { checkBuiltinPanelSource } = await import(pathToFileURL(join(skill, "panel-check.mjs")).href);
  const sdkPath = join(root, "dist/apps-sdk");
  const { version } = JSON.parse(readFileSync(join(sdkPath, "current.json"), "utf8"));
  const { checks } = await installedPanelSdk(join(sdkPath, version));
  return stageBuiltinPanels({
    directory: join(root, "dist/builtin-panels"),
    members, applications: [...javaApplications, ...workbenchApplications], checks, checkSource: checkBuiltinPanelSource,
  });
}
