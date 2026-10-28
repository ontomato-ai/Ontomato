import { describe, expect, it } from "vitest";
import { assistantSkillInputSchema } from "@ontomato/contracts/assistant-chat";
import { runtimeSkillRefSchema } from "@ontomato/contracts/agent-runtime-skills";
import { resolveAssistantSkillReferences } from "../skill-references";

describe("assistant skill ownership boundary", () => {
  it.each(["domain-a", "public"])(
    "resolves a domain-free input using the verified %s identity",
    (domainId) => {
      const input = assistantSkillInputSchema.parse({
        name: "local-analysis",
        namespace: { kind: "domain" },
      });
      const [resolved] = resolveAssistantSkillReferences([input], domainId);
      expect(runtimeSkillRefSchema.parse(resolved)).toEqual({
        name: "local-analysis",
        namespace: { kind: "domain", domainId },
      });
    },
  );

  it("preserves provider and matching full references from a definition read", () => {
    const skills = [
      { name: "assistant-report", namespace: { kind: "provider", provider: "workbench" } },
      { name: "local-analysis", namespace: { kind: "domain", domainId: "domain-a" } },
    ].map((skill) => assistantSkillInputSchema.parse(skill));
    expect(resolveAssistantSkillReferences(skills, "domain-a")).toEqual(skills);
  });

  it("rejects a foreign domain instead of letting the browser select it", () => {
    const foreign = assistantSkillInputSchema.parse({
      name: "local-analysis",
      namespace: { kind: "domain", domainId: "domain-b" },
    });
    expect(() => resolveAssistantSkillReferences([foreign], "domain-a"))
      .toThrow(expect.objectContaining({ status: 403 }));
  });
});
