import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { presetAgents } from "../../assistant/preset-definitions";
import { workbenchApplications } from "../builtins";

type DeclaredEntry = { pageKey: string; panelId?: string; defaultAgent?: { kind: string; agentKind?: string } };
type DeclaredApplication = { source: string; entries: DeclaredEntry[] };

const javaApplicationsDir = path.resolve("../data-engine-core/src/main/resources/applications");

function declaredApplications(): DeclaredApplication[] {
  const java = readdirSync(javaApplicationsDir).filter(name => name.endsWith(".json")).map(name => {
    const declaration = JSON.parse(readFileSync(path.join(javaApplicationsDir, name), "utf8"));
    return { source: `applications/${name}`, entries: (declaration.declaration.panelUses ?? []) as DeclaredEntry[] };
  });
  const workbench = [{
    source: "services/applications/builtins.ts",
    entries: workbenchApplications.flatMap(application => application.declaration.panelUses ?? []) as DeclaredEntry[],
  }];
  return [...java, ...workbench];
}

/** Built-in entries never point at withdrawn presets; entries without a registration naturally fall back to regular. */
it("registers no default agent for withdrawn presets and keeps the remaining page defaults valid", () => {
  const presetKinds = new Set(presetAgents.map(preset => preset.kind));
  const registrations = new Map<string, string>();
  const problems: string[] = [];
  for (const { source, entries } of declaredApplications()) {
    for (const entry of entries) {
      if (!entry.panelId || !entry.defaultAgent) continue;
      const { defaultAgent } = entry;
      if (defaultAgent.kind !== "preset" || !defaultAgent.agentKind || !presetKinds.has(defaultAgent.agentKind)) {
        problems.push(`${source}: ${entry.pageKey} registers ${JSON.stringify(defaultAgent)}, which is not a platform assistant`);
        continue;
      }
      if (["modeling", "product-layer", "admin"].includes(defaultAgent.agentKind))
        problems.push(`${source}: ${entry.pageKey} still registers withdrawn preset ${defaultAgent.agentKind}`);
      const previous = registrations.get(entry.pageKey);
      if (previous) problems.push(`${entry.pageKey} is registered twice: ${previous}, ${defaultAgent.agentKind}`);
      registrations.set(entry.pageKey, defaultAgent.agentKind);
    }
  }
  expect(problems).toEqual([]);
  expect(registrations.get("business-knowledge")).toBe("knowledge-governance");
  expect([...registrations.values()]).toContain("ops-diagnosis");
  expect([...registrations.values()]).toContain("app-builder");
});
