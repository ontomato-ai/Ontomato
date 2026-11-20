import { z } from "zod";
import { panelSkillSourcesQuerySchema, panelSkillSourcesResponseSchema, type PanelUseRef } from "@ontomato/contracts/product-panels";
import { environment } from "../../config/environment";
import { config } from "../../config/application";
import { registerSkillProvider, type ProtectedSkillOffering, type SkillProvider } from "../../core/skills/providers";
import { backendGet } from "../../utils/backend-client";

const sourceResponse = z.object({ success: z.literal(true), data: panelSkillSourcesResponseSchema });

async function readSources(domainId: string) {
  const query = new URLSearchParams(panelSkillSourcesQuerySchema.parse({ domainId }));
  const response = await backendGet("panel-skill-sources",
    `${config.dataQuery.baseUrl}/platform/applications/panel-skill-sources?${query}`,
    { headers: { "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken }, retries: 1 });
  return sourceResponse.parse(JSON.parse(response.text)).data;
}

export const panelSkillProvider: SkillProvider<ProtectedSkillOffering> & {
  findByUse(domainId: string, use: PanelUseRef): Promise<ProtectedSkillOffering | null>;
} = {
  id: "product-panels",
  name: "Panels",
  async list({ domainId }) {
    const { panelSkillOfferings } = await import("./skill-package");
    return panelSkillOfferings(domainId, await readSources(domainId));
  },
  async findByUse(domainId, { applicationId, useId }) {
    const source = (await readSources(domainId)).find(entry => entry.applicationId === applicationId && entry.useId === useId);
    if (!source) return null;
    const { panelSkillOfferings } = await import("./skill-package");
    const [offering] = await panelSkillOfferings(domainId, [source]);
    return offering!;
  },
};

export function registerPanelSkillProvider(): void {
  registerSkillProvider(panelSkillProvider);
}
