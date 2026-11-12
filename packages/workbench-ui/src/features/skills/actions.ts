import { ElMessage, ElMessageBox } from "element-plus";
import { authHost } from "../../utils/auth";
import { skillsApi } from "./api";

type Translate = (key: string, values?: Record<string, unknown>) => string;

/** Downloads the package: the browser fetches the link itself, so the current credential travels in its query. */
export function exportSkill(skillId: string) {
  const link = document.createElement("a");
  const params = new URLSearchParams();
  const token = authHost().getToken();
  const apiKey = authHost().getApiKey();
  if (token) params.set("tk", token);
  else if (apiKey) params.set("apiKey", apiKey);
  link.href = skillsApi.exportUrl(skillId, params.toString());
  link.download = `${skillId}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Deleting names the agents that lose the skill before it asks. True once the skill is gone; a failed step is reported,
 * not retried, and a declined question changes nothing.
 */
export async function deleteSkill(skillId: string, t: Translate): Promise<boolean> {
  let affectedAgents: { name: string }[];
  try {
    ({ affectedAgents } = await skillsApi.getReferences(skillId));
  } catch {
    ElMessage.error(t("admin.deleteFailed"));
    return false;
  }
  const confirmation = affectedAgents.length
    ? t("admin.deleteSkillAffectedConfirm", { id: skillId, agents: affectedAgents.map((agent) => agent.name).join(", ") })
    : t("admin.deleteSkillConfirm", { id: skillId });
  try {
    await ElMessageBox.confirm(confirmation, t("common.deleteConfirm"), {
      type: "warning",
      confirmButtonText: t("common.delete"),
      cancelButtonText: t("common.cancel"),
    });
  } catch {
    return false;
  }
  try {
    await skillsApi.deleteSkill(skillId);
  } catch {
    ElMessage.error(t("admin.deleteFailed"));
    return false;
  }
  ElMessage.success(t("admin.skillDeleted"));
  return true;
}
