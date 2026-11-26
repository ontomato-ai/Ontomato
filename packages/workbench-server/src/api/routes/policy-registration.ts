import { Router } from "express";
import { z } from "zod";
import { context, wrap } from "../utils/agent-host";
import { requireManagement } from "../../identity/management";
import { findCurrentProducts } from "../../infrastructure/product-current";
import { assistantStore } from "../../services/assistant/store";
import { registeredDomainComponentIds } from "../../services/domain-components/store";
import { skillRegistryManager } from "../../core/skills/registry/manager";

const kindSchema = z.enum(["PANEL", "PROJECTION", "COMPONENT", "AGENT", "SKILL"]);
type Kind = z.infer<typeof kindSchema>;
const requestSchema = z.object({
  targets: z.array(z.object({ kind: kindSchema, key: z.string().min(1) }).strict()),
}).strict();

export const policyRegistrationRouter = Router();

policyRegistrationRouter.post("/registered-targets/check",
  requireManagement({ id: "authorization.policies.read" }),
  wrap(async (req, res) => {
    const { owner } = context(req);
    const { targets } = requestSchema.parse(req.body);
    const byKind = new Map<Kind, string[]>();
    for (const { kind, key } of targets) {
      const keys = byKind.get(kind) ?? [];
      keys.push(key);
      byKind.set(kind, keys);
    }
    const matches = await Promise.all([...byKind.entries()].map(async ([kind, keys]) => {
      const { domainId } = owner;
      const ids = await registeredIds(domainId, kind, keys);
      return ids.map(key => ({ kind, key }));
    }));
    res.json({ matches: matches.flat() });
  }),
);

async function registeredIds(domainId: string, kind: Kind, keys: readonly string[]): Promise<string[]> {
  switch (kind) {
    case "PANEL":
      return [...(await findCurrentProducts(domainId, "panel", keys)).keys()];
    case "PROJECTION":
      return [...(await findCurrentProducts(domainId, "projection", keys)).keys()];
    case "COMPONENT":
      return registeredDomainComponentIds(domainId, keys);
    case "AGENT":
      return assistantStore.registeredAgentIds(domainId, keys);
    case "SKILL":
      return skillRegistryManager.registeredDomainSkillIds(domainId, keys);
  }
}
