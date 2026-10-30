<script setup lang="ts">
import { computed } from "vue";
import type { AnalysisChartResult } from "@ontomato/contracts/analysis-charts";
import { embedChartHtml, updateParsedReportContent } from "../../../utils/analysis-report";
import { renderAgentMarkdown } from "../../../utils/agent-markdown";
import { renderMarkdown } from "../../../utils/markdown";
import { withSkillResourceCredentials } from "../../skills/utils/skill-resource";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  content: string;
  charts?: AnalysisChartResult[];
  safe?: boolean;
}>();

const parts = computed(() => updateParsedReportContent(
  undefined,
  embedChartHtml(props.content, props.charts || [], { diagnosticLabel: "AnalysisMessageBody" }),
  "message",
  false,
).parts);
</script>

<template>
  <template v-for="part in parts" :key="part.id">
    <div
      v-if="part.type === 'text'"
      class="markdown-body markdown-content"
      v-html="safe ? renderAgentMarkdown(part.content) : renderMarkdown(part.content)"
    ></div>
    <iframe
      v-else
      class="message-chart"
      :title="t('chat.visualizationResult')"
      :srcdoc="withSkillResourceCredentials(part.html)"
      sandbox="allow-scripts allow-same-origin"
      loading="lazy"
    ></iframe>
  </template>
</template>

<style scoped>
.message-chart {
  display: block;
  width: 100%;
  height: 460px;
  margin: 12px 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-bg-color);
}
</style>
