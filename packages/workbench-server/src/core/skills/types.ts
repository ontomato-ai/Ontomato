import type { SkillCategoryValue, SkillTypeValue } from "./constants";
import type { SkillManifest } from "./manifest";

export type { SkillManifest } from "./manifest";

export interface SkillMeta {
  id: string;
  isPublic: boolean;
  path: string;
  manifest: SkillManifest;
  skillMdPath: string;
}

export interface SkillQuery {
  type?: SkillTypeValue;
  category?: SkillCategoryValue;
  includeDisabled?: boolean;
}
