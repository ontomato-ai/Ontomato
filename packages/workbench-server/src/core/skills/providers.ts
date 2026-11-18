import type { z } from "zod";
import {
  runtimeRegisterSkillRequestSchema,
  type RuntimeSkillRef,
  type StandardSkillFrontmatter,
} from "@ontomato/contracts/agent-runtime-skills";

/** A standard skill package: the identity plus the exact files the runtime receives. */
export type SkillPackage = z.infer<typeof runtimeRegisterSkillRequestSchema>;

/** The verified domain the skill system is reading for. Providers cannot choose another one. */
export interface SkillSourceContext {
  readonly domainId: string;
}

/** One skill a provider offers now, with its current package supplied on demand. */
export interface SkillOffering {
  skill: RuntimeSkillRef;
  manifest: StandardSkillFrontmatter;
  provide(): Promise<SkillPackage>;
}

/**
 * A source of skills. It supplies packages only; catalogue merging, admission, publication and permissions belong to
 * the skill system.
 */
export interface SkillProvider {
  /** Stable source identity used to locate conflicts. It is not part of a skill's runtime identity. */
  id: string;
  /** Name that management shows as who provides the skill. */
  name: string;
  list(context: SkillSourceContext): Promise<readonly SkillOffering[]>;
}

const providers: SkillProvider[] = [];

export function registerSkillProvider(provider: SkillProvider): void {
  if (providers.some((registered) => registered.id === provider.id))
    throw new Error(`Skill provider "${provider.name}" is already registered with id "${provider.id}"`);
  providers.push(provider);
}

/** The registered sources for one catalogue read, in registration order. */
export function registeredSkillProviders(): readonly SkillProvider[] {
  return [...providers];
}
