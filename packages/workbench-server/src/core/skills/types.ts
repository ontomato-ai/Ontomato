import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import type { SkillWriteRestriction } from "@ontomato/contracts/skills";
import type { SkillManifest } from "./manifest";
import type { SkillPackage, SkillPackageContext } from "./providers";

export type { SkillManifest } from "./manifest";

/** A package found in a file source. Its path stays inside that file source. */
export interface SkillMeta {
  id: string;
  isPublic: boolean;
  path: string;
  manifest: SkillManifest;
  skillMdPath: string;
}

/** Where a catalogue entry comes from. Only file sources have a path. */
export type SkillSource =
  | { kind: "public"; path: string }
  | { kind: "domain"; path: string }
  | { kind: "provider"; providerId: string; providerName: string };

/** One manageable skill, whatever its source. */
export interface SkillEntry {
  skill: RuntimeSkillRef;
  manifest: SkillManifest;
  source: SkillSource;
  provide(context?: SkillPackageContext): Promise<SkillPackage>;
}

/** The single place that decides whether a skill's content may be changed here. */
export function skillWriteRestriction(entry: Pick<SkillEntry, "source">): SkillWriteRestriction {
  const source = entry.source;
  if (source.kind === "public") return { kind: "public" };
  if (source.kind === "provider")
    return { kind: "provider", providerId: source.providerId, providerName: source.providerName };
  return null;
}
