import { z } from "zod";
import { panelSkillSourceSchema } from "@ontomato/contracts/product-panels";
import { environment } from "../../config/environment";
import { config } from "../../config/application";
import { registerSkillProvider, type SkillProvider } from "../../core/skills";
import { backendGet } from "../../utils/backend-client";
import { panelSkillManifest, providePanelSkill, readPanelTitle } from "./skill-package";

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
    const panelIds = new Set(sources.flatMap(({ uses }) => uses.map(use => use.panelId)));
    const titles = new Map(await Promise.all([...panelIds].map(async id => [id, await readPanelTitle(domainId, id)] as const)));
    return sources.map(({ skill, uses }) => {
      const ids = new Set(uses.map(use => use.panelId));
      const manifest = panelSkillManifest(skill, [...ids].map(id => titles.get(id)!));
      return { skill, manifest, provide: () => providePanelSkill(domainId, skill, manifest, uses) };
    });
  },
};

export function registerPanelSkillProvider(): void {
  registerSkillProvider(panelSkillProvider);
}
