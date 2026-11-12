import fs from "node:fs";
import path from "node:path";
import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { qualifiedTable as t } from "../../postgres";
import type { QueryableClient } from "../helpers";

export const SKILL_ENABLE_RETIREMENT_VERSION = "20261112_skill_enable_retirement_v1";
export const SKILL_ENABLE_RETIREMENT_NAME = "skill enablement retirement";

/*
 * A snapshot of the rule retired on 2026-11-12, as it was: each domain kept `skill-states.json` in its directory under
 * the domain skills root (the directory named by the encoded domain ID), a skill was off when that file listed it as
 * disabled, or else when it was not listed as enabled and its package said `ontomato.defaultEnabled: "false"`; agents
 * kept off skills in their selections and runs left them out. Nothing reads these any more, so they are written here.
 */
export const RETIRED_STATES_FILE = "skill-states.json";
const DEFAULT_DISABLED_PUBLIC = ["generate-ppt", "admin-choropleth-map", "leaflet", "network-graph", "quality-trace-graph"];
const DEFAULT_DISABLED = /^\s*ontomato\.defaultEnabled:\s*["']?false["']?\s*$/m;

type StoredAgent = { id: string; domain_id: string; skills: RuntimeSkillRef[] };

/** The references each domain had switched off, keyed by domain ID; a domain without a directory had only the defaults. */
function retiredReferences(domainsRoot: string): (domainId: string) => Set<string> {
  const directories = new Map<string, string>();
  if (fs.existsSync(domainsRoot))
    for (const entry of fs.readdirSync(domainsRoot, { withFileTypes: true }))
      if (entry.isDirectory()) directories.set(decodeURIComponent(entry.name), path.join(domainsRoot, entry.name));
  const provider = (name: string) => runtimeSkillKey({ name, namespace: { kind: "provider", provider: "workbench" } });
  return (domainId) => {
    const directory = directories.get(domainId);
    const statesFile = directory && path.join(directory, RETIRED_STATES_FILE);
    const states = statesFile && fs.existsSync(statesFile)
      ? JSON.parse(fs.readFileSync(statesFile, "utf8")) as { disabledSkills?: string[]; enabledSkills?: string[] }
      : {};
    const enabled = new Set(states.enabledSkills ?? []);
    const packageFile = (name: string) => directory && path.join(directory, name, "SKILL.md");
    const isDomain = (name: string) => { const file = packageFile(name); return Boolean(file && fs.existsSync(file)); };
    const reference = (name: string) =>
      isDomain(name) ? runtimeSkillKey({ name, namespace: { kind: "domain", domainId } }) : provider(name);
    const off = new Set((states.disabledSkills ?? []).map(reference));
    for (const name of DEFAULT_DISABLED_PUBLIC) if (!enabled.has(name)) off.add(provider(name));
    if (directory)
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }))
        if (entry.isDirectory() && !entry.name.startsWith(".") && isDomain(entry.name) && !enabled.has(entry.name)
            && DEFAULT_DISABLED.test(fs.readFileSync(packageFile(entry.name)!, "utf8")))
          off.add(reference(entry.name));
    return off;
  };
}

/** Running agents left their off skills out; the selections lose them, so every agent keeps using what it used. */
export async function migrateSkillEnableRetirement(client: QueryableClient, domainsRoot: string): Promise<{ agents: number }> {
  const rows = (await client.query(
    `SELECT id,domain_id,skills FROM ${t("assistant_agents")} WHERE jsonb_array_length(skills) > 0`,
  )).rows as StoredAgent[];
  const retiredOf = retiredReferences(domainsRoot);
  const retired = new Map<string, Set<string>>();
  let agents = 0;
  for (const row of rows) {
    if (!retired.has(row.domain_id)) retired.set(row.domain_id, retiredOf(row.domain_id));
    const off = retired.get(row.domain_id)!;
    const kept = row.skills.filter((skill) => !off.has(runtimeSkillKey(skill)));
    if (kept.length === row.skills.length) continue;
    await client.query(`UPDATE ${t("assistant_agents")} SET skills=$2::jsonb WHERE id=$1`, [row.id, JSON.stringify(kept)]);
    agents++;
  }
  return { agents };
}

/** After the selections are committed, the retired enablement files go. */
export function removeRetiredSkillStates(domainsRoot: string) {
  if (!fs.existsSync(domainsRoot)) return;
  for (const entry of fs.readdirSync(domainsRoot, { withFileTypes: true }))
    if (entry.isDirectory()) fs.rmSync(path.join(domainsRoot, entry.name, RETIRED_STATES_FILE), { force: true });
}
