import type { SkillManifest } from "./manifest";

export type { SkillManifest } from "./manifest";

export interface SkillMeta {
  id: string;
  isPublic: boolean;
  path: string;
  manifest: SkillManifest;
  skillMdPath: string;
}
