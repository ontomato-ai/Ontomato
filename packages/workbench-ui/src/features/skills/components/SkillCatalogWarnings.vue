<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import type { SkillCatalogDiagnostics } from "@ontomato/contracts/skills";

defineProps<{ diagnostics: SkillCatalogDiagnostics }>();
const { t } = useI18n();
function message(item: SkillCatalogDiagnostics["items"][number]) {
  return t(item.field ? "skills.diagnostics.itemField" : "skills.diagnostics.item", {
    skill: runtimeSkillKey(item.skill), resource: item.resourceId, field: item.field,
    reason: t(`skills.diagnostics.${item.reason}`),
  });
}
</script>

<template>
  <el-alert v-for="item in diagnostics.items" :key="runtimeSkillKey(item.skill)" type="warning"
    :title="message(item)" :closable="false" show-icon />
  <el-alert v-if="diagnostics.sourceUnavailable" type="warning" :title="t('skills.diagnostics.sourceUnavailable')"
    :closable="false" show-icon />
</template>
