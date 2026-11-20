import { z } from "zod";
import { panelSkillSourcesQuerySchema, panelSkillSourcesResponseSchema, type PanelUseRef } from "@ontomato/contracts/product-panels";
import { environment } from "../../config/environment";
import { config } from "../../config/application";
import { registerSkillProvider, SkillSourceRecordError, type ProtectedSkillOffering, type SkillProvider } from "../../core/skills/providers";
import { backendGet } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";

const sourceResponse = z.object({ success: z.literal(true), data: panelSkillSourcesResponseSchema });

async function readSources(domainId: string) {
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
  findByUse(domainId: string, use: PanelUseRef): Promise<ProtectedSkillOffering | null>;
} = {
  id: "product-panels",
  name: "Panels",
  async list({ domainId, reportSourceFailure }) {
    const { panelSkillOfferings } = await import("./skill-package");
    return panelSkillOfferings(domainId, await readSources(domainId), reportSourceFailure);
  },
  async findByUse(domainId, { applicationId, useId }) {
    const source = (await readSources(domainId)).find(entry => entry.applicationId === applicationId && entry.useId === useId);
    if (!source) return null;
    const { panelSkillOfferings } = await import("./skill-package");
    const panelId = source.panelId;
    function rethrow(error: unknown): never {
      if (!(error instanceof SkillSourceRecordError)) throw error;
      const { resourceId, field, reason } = error.detail;
      const resource = resourceId === panelId ? "panel" : "projection";
      const location = `${resource} '${resourceId}'${field ? `, field '${field}'` : ""}`;
      throw new HttpError(502, `Panel '${panelId}' skill is unavailable: ${location}: ${reason.replaceAll("_", " ")}`, "SKILL_SOURCE_UNAVAILABLE");
    }
    const [offering] = await panelSkillOfferings(domainId, [source]).catch(rethrow);
    return {
      ...offering!,
      readManifest: ref => offering!.readManifest(ref).catch(rethrow),
      provide: ref => offering!.provide(ref).catch(rethrow),
    };
  },
};

export function registerPanelSkillProvider(): void {
  registerSkillProvider(panelSkillProvider);
}
