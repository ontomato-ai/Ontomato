import { z } from "zod";
import { panelSkillSourceSchema } from "@ontomato/contracts/product-panels";
import { environment } from "../../config/environment";
import { config } from "../../config/application";
import { registerSkillProvider, type SkillProvider } from "../../core/skills";
import { backendGet } from "../../utils/backend-client";
import { panelSkillOfferings } from "./skill-package";

const sourceResponse = z.object({ success: z.literal(true), data: z.array(panelSkillSourceSchema) });

export const panelSkillProvider: SkillProvider = {
  id: "product-panels",
  name: "Panels",
  async list({ domainId }) {
    const query = new URLSearchParams({ domainId });
    const response = await backendGet("panel-skill-sources",
      `${config.dataQuery.baseUrl}/platform/applications/panel-skill-sources?${query}`,
      { headers: { "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken }, retries: 1 });
    const sources = sourceResponse.parse(JSON.parse(response.text)).data;
    return panelSkillOfferings(domainId, sources);
  },
};

export function registerPanelSkillProvider(): void {
  registerSkillProvider(panelSkillProvider);
}
