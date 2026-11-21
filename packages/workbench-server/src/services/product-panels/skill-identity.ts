import { isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import { protectedSourceSkillRef } from "../../core/skills/providers";

export const PANEL_SKILL_PROVIDER_ID = "product-panels";

export function panelSkillScope(panelId: string): "platform" | undefined {
  return isBuiltinProductId(panelId) ? "platform" : undefined;
}

export function panelSkillRef(domainId: string, panelId: string) {
  return protectedSourceSkillRef(PANEL_SKILL_PROVIDER_ID, domainId, { sourceKey: panelId, scope: panelSkillScope(panelId) });
}
