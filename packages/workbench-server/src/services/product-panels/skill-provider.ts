import { z } from "zod";
import { panelSkillSourcesQuerySchema, panelSkillSourcesResponseSchema, type PanelUseRef } from "@ontomato/contracts/product-panels";
import { environment } from "../../config/environment";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { registerSkillProvider, type ProtectedSkillOffering, type SkillProvider, type SkillSourceFailure } from "../../core/skills/providers";
import { backendGet } from "../../utils/backend-client";
import { platformHomeStore } from "../platform-home/store";
import { PANEL_SKILL_PROVIDER_ID } from "./skill-identity";

const sourceResponse = z.object({ success: z.literal(true), data: panelSkillSourcesResponseSchema });

export async function readPanelSkillSources(domainId: string) {
  const query = new URLSearchParams(panelSkillSourcesQuerySchema.parse({ domainId }));
  const response = await backendGet("panel-skill-sources",
    `${config.dataQuery.baseUrl}/platform/applications/panel-skill-sources?${query}`,
    { headers: { "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken }, retries: 1 });
  try {
    return sourceResponse.parse(JSON.parse(response.text)).data;
  } catch (cause) {
    throw new Error("Invalid panel skill source catalogue", { cause });
  }
}

export const panelSkillProvider: SkillProvider<ProtectedSkillOffering> & {
  findByUse(domainId: string, use: PanelUseRef, reader: AssistantCredentials, panelIdOverride?: string): Promise<ProtectedSkillOffering | SkillSourceFailure | null>;
} = {
  id: PANEL_SKILL_PROVIDER_ID,
  name: "Panels",
  async list({ domainId, userId, reader, reportSourceFailure }) {
    const { panelSkillSources } = await import("./skill-package");
    const rawSources = await readPanelSkillSources(domainId);
    const homePanelId = userId ? await platformHomeStore.homePanelId({ domainId, userId }) : null;
    const sources = homePanelId !== null
      ? rawSources.map(entry =>
          entry.applicationId === "home" && entry.useId === "home"
            ? { ...entry, panelId: homePanelId }
            : entry,
        )
      : rawSources;
    const offerings: ProtectedSkillOffering[] = [];
    for (const source of await panelSkillSources(domainId, sources, reader)) {
      if ("kind" in source) offerings.push(source);
      else reportSourceFailure(source);
    }
    return offerings;
  },
  async findByUse(domainId, { applicationId, useId }, reader, panelIdOverride) {
    const source = (await readPanelSkillSources(domainId)).find(entry => entry.applicationId === applicationId && entry.useId === useId);
    if (!source) return null;
    const resolved = panelIdOverride !== undefined && panelIdOverride !== source.panelId
      ? { ...source, panelId: panelIdOverride }
      : source;
    const { panelSkillSources } = await import("./skill-package");
    const [result] = await panelSkillSources(domainId, [resolved], reader);
    return result!;
  },
};

export function registerPanelSkillProvider(): void {
  registerSkillProvider(panelSkillProvider);
}
