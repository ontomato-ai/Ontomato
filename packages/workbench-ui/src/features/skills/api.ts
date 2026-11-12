import type { SkillFile } from "@ontomato/contracts/skills";
import { api } from "../../api";
import { apiUrl } from "../../utils/api-base";

export function createSkillsApi(request: Pick<typeof api, "get" | "delete" | "postFormData"> = api) {
  return {
    fetchSkills: () => request.get("/skills"),
    getReferences: (skillId: string) => request.get(`/skills/${skillId}/references`),
    deleteSkill: (skillId: string) => request.delete(`/skills/${skillId}`),
    listFiles: async (skillId: string): Promise<SkillFile[]> =>
      (await request.get(`/skills/${encodeURIComponent(skillId)}/files`)).files,
    readFile: async (skillId: string, path: string): Promise<string> =>
      (await request.get(`/skills/${encodeURIComponent(skillId)}/file?path=${encodeURIComponent(path)}`)).content,
    importSkill: (file: File, overwrite = false) => {
      const formData = new FormData();
      formData.append("file", file);
      return request.postFormData(overwrite ? "/skills/import?overwrite=true" : "/skills/import", formData);
    },
    exportUrl: (skillId: string, query: string) =>
      apiUrl(`/skills/${skillId}/export${query ? `?${query}` : ""}`),
  };
}

export const skillsApi = createSkillsApi();
