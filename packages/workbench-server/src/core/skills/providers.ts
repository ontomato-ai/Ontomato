import type { z } from "zod";
import { createHash } from "node:crypto";
import type { PageSkillEntrance } from "@ontomato/contracts/page-skills";
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

/** Identity and dependencies describe the same snapshot used by both content readers. */
export interface ProtectedSkillOffering {
  kind: "protected";
  sourceKey: string;
  scopeKey: string;
  entrances: readonly PageSkillEntrance[];
  resourceIds: readonly string[];
  legacyAggregateRefs?: readonly RuntimeSkillRef[];
  readManifest(skill: RuntimeSkillRef): Promise<StandardSkillFrontmatter>;
  provide(skill: RuntimeSkillRef): Promise<SkillPackage>;
}

const PROTECTED_SKILL_NAME = /^pvt-[0-9a-f]{48}$/u;

export function isProtectedSkillName(name: string): boolean {
  return PROTECTED_SKILL_NAME.test(name);
}

export function protectedSkillRef(providerId: string, domainId: string, sourceKey: string, scopeKey: string): RuntimeSkillRef {
  const hash = createHash("sha256").update(JSON.stringify([providerId, domainId, sourceKey, scopeKey])).digest("hex");
  return { namespace: { kind: "domain", domainId }, name: `pvt-${hash.slice(0, 48)}` };
}

/**
 * A source of skills. It supplies packages only; catalogue merging, admission, publication and permissions belong to
 * the skill system.
 */
export interface SkillProvider<Offering extends SkillOffering | ProtectedSkillOffering = SkillOffering> {
  /** Stable provider identity used to derive protected skill refs and locate conflicts. */
  id: string;
  /** Name that management shows as who provides the skill. */
  name: string;
  list(context: SkillSourceContext): Promise<readonly Offering[]>;
}

export type RegisteredSkillProvider = SkillProvider<SkillOffering | ProtectedSkillOffering>;
const providers: RegisteredSkillProvider[] = [];

export function registerSkillProvider(provider: RegisteredSkillProvider): void {
  if (providers.some((registered) => registered.id === provider.id))
    throw new Error(`Skill provider "${provider.name}" is already registered with id "${provider.id}"`);
  providers.push(provider);
}

/** The registered sources for one catalogue read, in registration order. */
export function registeredSkillProviders(): readonly RegisteredSkillProvider[] {
  return [...providers];
}
