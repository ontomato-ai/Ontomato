import { ref } from "vue";
import { skillsApi } from "./api";

const count = ref<number | null>(null);
let requested = false;

export function updateSkillLibraryCount(value: number) {
  count.value = value;
}

/** Load the total only when the host renders the visible Skill navigation entry. */
export function skillLibraryCount(): number | null {
  if (!requested && count.value === null) {
    requested = true;
    void skillsApi.fetchSkills().then((response) => {
      if (!response?.success) throw new Error("Failed to load skill count");
      if (count.value === null) updateSkillLibraryCount(response.skills.length);
    }).catch(() => { requested = false; });
  }
  return count.value;
}
