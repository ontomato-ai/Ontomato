import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { OPS_DIAGNOSIS_KIND } from "@ontomato/contracts/ops-diagnosis";

export { OPS_DIAGNOSIS_KIND };
export function isOpsDiagnosisKind(kind: string) { return kind === OPS_DIAGNOSIS_KIND; }
export const OPS_DIAGNOSIS_SKILL: RuntimeSkillRef = {
  namespace: { kind: "provider", provider: "workbench" }, name: "ops-diagnosis",
};
export const OPS_DIAGNOSIS = {
  kind: OPS_DIAGNOSIS_KIND,
  name: "Operations diagnosis",
  description: "Read evidence and diagnose faults",
  icon: "wrench",
  skills: [OPS_DIAGNOSIS_SKILL],
};
