import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { presetAgents } from "../../assistant/preset-definitions";
import { workbenchApplications } from "../builtins";

type DeclaredEntry = { pageKey: string; panelId?: string; kind?: string; defaultAgent?: { kind: string; agentKind?: string } };
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

/** Every page skill the platform ships belongs to exactly one assistant, and the entry says which. */
it("registers one platform assistant per page entry that carries a page skill", () => {
  const presetKinds = new Set(presetAgents.map(preset => preset.kind));
  const registered = new Map<string, string>();
  const problems: string[] = [];
  for (const { source, entries } of declaredApplications()) {
    for (const entry of entries) {
      if (!entry.panelId) continue;
      const { defaultAgent } = entry;
      if (!defaultAgent) {
        problems.push(`${source}: ${entry.pageKey} registers no default agent`);
        continue;
      }
      if (defaultAgent.kind !== "preset" || !defaultAgent.agentKind || !presetKinds.has(defaultAgent.agentKind)) {
        problems.push(`${source}: ${entry.pageKey} registers ${JSON.stringify(defaultAgent)}, which is not a platform assistant`);
        continue;
      }
      const previous = registered.get(entry.pageKey);
      if (previous) problems.push(`${entry.pageKey} is registered twice: ${previous}, ${defaultAgent.agentKind}`);
      registered.set(entry.pageKey, defaultAgent.agentKind);
    }
  }
  expect(problems).toEqual([]);
  expect([...registered.values()].sort()).toEqual(expect.arrayContaining(["admin", "product-layer", "modeling"]));
});
