import type { SkillInfo } from "@ontomato/contracts/skills";
export type AnalysisSkill = Pick<
  SkillInfo,
  "id" | "type" | "title" | "description" | "category" | "tags" | "useCases" | "enabled"
>;
import { api } from "../../api";
import { apiUrl } from "../../utils/api-base";
import { workbenchContent } from "../../content";

export function createSkillsApi(request: Pick<typeof api, "get" | "post" | "put" | "delete" | "postFormData"> = api) {
  async function fetchSkills() {
    return request.get("/skills");
  }

  async function listSkills(category: AnalysisSkill["category"]): Promise<AnalysisSkill[]> {
    const response = await fetchSkills();
    if (response?.success !== true || !Array.isArray(response.skills)) {
      throw new Error(workbenchContent().text.skillsListInvalid);
    }

    const skills: AnalysisSkill[] = response.skills;
    return skills.filter(
      (skill) =>
        skill.category === category && (category !== "visualization" || skill.type === "executable")
    );
  }

  return {
    fetchSkills,
    listAnalysisSkills: () => listSkills("analysis"),
    listVisualizationSkills: () => listSkills("visualization"),
    toggleSkill: (skillId: string) => request.put(`/skills/${skillId}/toggle`),
    getReferences: (skillId: string) => request.get(`/skills/${skillId}/references`),
    deleteSkill: (skillId: string) => request.delete(`/skills/${skillId}`),
    getScript: (skillId: string) => request.get(`/skills/${skillId}/script`),
    getContent: (skillId: string) => request.get(`/skills/${skillId}/content`),
    updateSkill: (skillId: string, body: unknown) => request.put(`/skills/${skillId}`, body),
    createSkill: (body: unknown) => request.post("/skills", body),
    importSkill: (file: File, overwrite = false) => {
      const formData = new FormData();
      formData.append("file", file);
      return request.postFormData(overwrite ? "/skills/import?overwrite=true" : "/skills/import", formData);
    },
    debugSkill: (skillId: string, input: unknown) =>
      request.post(`/skills/${skillId}/debug`, { input }),
    exportUrl: (skillId: string, query: string) =>
      apiUrl(`/skills/${skillId}/export${query ? `?${query}` : ""}`),
  };
}

export const skillsApi = createSkillsApi();
