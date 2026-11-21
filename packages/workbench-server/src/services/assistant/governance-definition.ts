export const GOVERNANCE_KIND = "knowledge-governance";
export const GOVERNANCE_SKILL = { namespace: { kind: "provider" as const, provider: "ontology" }, name: GOVERNANCE_KIND };
export const GOVERNANCE_REPORT_SKILL = { namespace: { kind: "provider" as const, provider: "workbench" }, name: "assistant-report" };
export const GOVERNANCE_SKILLS = [GOVERNANCE_SKILL, GOVERNANCE_REPORT_SKILL];
export const GOVERNANCE_PANEL_ID = "builtin-product-business-knowledge";
export const GOVERNANCE_PRESET_VERSION = 1;
