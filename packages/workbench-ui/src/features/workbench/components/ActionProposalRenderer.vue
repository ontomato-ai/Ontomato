<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowRight, CheckCircle2, ChevronRight, CircleAlert, Clock3, LoaderCircle, Sparkles } from "lucide-vue-next";
import type { ArtifactRendererProps } from "@ontomato/agent-shell-ui";
import { assistantActionCardSchema, assistantActionExecutionSchema, type AssistantActionCard } from "@ontomato/contracts/assistant-actions";
import { nodeApiGet, nodeApiPost } from "../../../utils/api";

const props = defineProps<ArtifactRendererProps>();
const { t, locale } = useI18n();
const zh = computed(() => locale.value.toLowerCase().startsWith("zh"));
const card = ref<AssistantActionCard | null>(null);
const values = ref<Record<string, string>>({});
const loading = ref(false);
const executing = ref(false);
const error = ref("");
const continuing = ref(false);
const endpoint = computed(() => `/assistant/sessions/${props.artifact.sessionId}/artifacts/${props.artifact.id}/action`);
const editable = computed(() => !executing.value && !card.value?.execution);
const detailed = computed(() => props.presentation === "panel");
const statusKind = computed(() => executing.value ? "executing" : card.value?.execution?.status ?? "pending");
const statusLabel = computed(() => ({
  pending: zh.value ? "待确认" : "Needs confirmation",
  executing: zh.value ? "执行中" : "Executing",
  succeeded: zh.value ? "已完成" : "Completed",
  failed: zh.value ? "执行失败" : "Failed",
  unknown: zh.value ? "待核实" : "Check outcome",
})[statusKind.value]);
const identityParameter = (name: string) => /^(exchange_id|person_id)$/.test(name);
const visibleParameters = computed(() => card.value?.action.parameters.filter((parameter) =>
  !identityParameter(parameter.name) && parameter.name !== "expected_value") ?? []);
const target = computed(() => card.value?.proposal.display?.target || (values.value.exchange_id ? (zh.value ? "所选学术交流记录" : "Selected exchange record") : values.value.person_id ? (zh.value ? "所选教职工" : "Selected staff member") : props.title));
const missingContext = computed(() => card.value?.action.parameters.some((parameter) =>
  (identityParameter(parameter.name) || parameter.name === "expected_value") && !values.value[parameter.name]?.trim()) ?? false);
const ready = computed(() => !missingContext.value && visibleParameters.value.every((parameter) => !parameter.required || values.value[parameter.name]?.trim()));
function parameterPlaceholder(name: string) {
  if (!zh.value) return "Enter the new value";
  return ({ new_source: "例如：科研处活动登记表（请填写真实来源）", new_role: "例如：主讲人、主持人、参会人", new_activity_type: "例如：学术研讨、教学交流", highest_education: "例如：研究生、本科", highest_degree: "例如：博士、硕士、学士" } as Record<string, string>)[name] || "请填写要更新的内容";
}
const parameterLabel = (parameter: { name: string; description: string }) => {
  const label = card.value?.proposal.display?.parameterLabels[parameter.name];
  if (label) return label;
  const known: Record<string, string> = zh.value
    ? { exchange_id: "交流记录", person_id: "教职工", expected_value: "当前值", new_source: "新数据来源", new_role: "新参与角色", new_activity_type: "新活动类型", highest_education: "最高学历", highest_degree: "最高学位", role: "参与角色", source: "数据来源" }
    : { exchange_id: "Exchange record", person_id: "Staff member", expected_value: "Current value", new_source: "New source", new_role: "New role", new_activity_type: "New activity type" };
  return known[parameter.name] ?? parameter.description.split(/[，；。;\n]/)[0] ?? parameter.name;
};
function stringify(value: unknown) { return value == null ? "" : typeof value === "string" ? value : JSON.stringify(value); }
const result = computed(() => {
  const value = card.value?.execution?.result;
  if (value && typeof value === "object" && "result" in value) {
    const text = (value as { result: unknown }).result;
    try { return JSON.stringify(JSON.parse(String(text)), null, 2); } catch { return stringify(text); }
  }
  return value == null ? "" : JSON.stringify(value, null, 2);
});
async function load() {
  loading.value = true; error.value = "";
  try {
    card.value = assistantActionCardSchema.parse(await nodeApiGet(endpoint.value));
    values.value = Object.fromEntries(Object.entries(card.value.execution?.parameters ?? card.value.proposal.parameters).map(([name, value]) => [name, stringify(value)]));
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { loading.value = false; }
}
async function confirm() {
  if (!card.value || !editable.value || !ready.value) return;
  executing.value = true; error.value = "";
  try {
    const parameters = Object.fromEntries(card.value.action.parameters.map((parameter) => {
      const value = values.value[parameter.name] ?? "";
      const type = parameter.type.replace(/^TYPE_/, "").toLowerCase();
      return [parameter.name, ["string", "time", "date", "varchar", "text"].includes(type) ? value : JSON.parse(value)];
    }));
    card.value.execution = assistantActionExecutionSchema.parse(await nodeApiPost(`${endpoint.value}/confirm`, { parameters }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Recover the durable outcome if the response was lost after the server accepted confirmation.
    await load();
    error.value = message;
  }
  finally { executing.value = false; }
}
async function continueAction(mode: "edit" | "verify") {
  if (!card.value || !props.continueConversation || continuing.value) return;
  continuing.value = true; error.value = "";
  try {
    const context = JSON.stringify({ actionId: card.value.action.id, actionName: card.value.action.name,
      previousParameters: card.value.execution?.parameters, previousStatus: card.value.execution?.status });
    const message = mode === "edit"
      ? (zh.value ? "我想再次修改这条记录。请先重新查询当前数据，再使用当前已发布的同一个 Action 生成一张新的待确认卡片。以最新查询值更新原值参数，新值预填当前内容供我修改，保留原来的执行记录，不要直接执行。" : "I want to edit this record again. Query its current data first, then create a new confirmation card for the same currently published Action. Refresh expected values from the query and prefill new values with current content for editing. Preserve the previous execution and do not execute yet.")
      : (zh.value ? "请重新查询这条记录的最新数据，核实本次操作涉及的字段当前是什么值。本次只查询，不生成操作建议或执行写入。" : "Query the latest data for this record and verify the current values affected by this operation. Only read; do not propose or execute another Action.");
    await props.continueConversation(`${message}\n\n${context}`);
  } catch (e) { error.value = e instanceof Error ? e.message : (zh.value ? "暂时无法继续，请稍后重试" : "Unable to continue. Try again."); }
  finally { continuing.value = false; }
}
watch(() => props.artifact.id, load, { immediate: true });
</script>

<template>
  <section class="action-proposal" :class="[presentation, `is-${statusKind}`]" :aria-busy="loading || executing">
    <p v-if="loading">{{ t("common.loading") }}</p>
    <template v-if="card">
      <div class="proposal-heading"><span class="proposal-icon"><Sparkles :size="16" /></span><span class="proposal-kind">{{ zh ? "建议操作" : "Suggested action" }}</span><span class="proposal-status" :class="statusKind" role="status"><LoaderCircle v-if="statusKind === 'executing'" :size="14" class="status-spin" /><CheckCircle2 v-else-if="statusKind === 'succeeded'" :size="14" /><CircleAlert v-else-if="statusKind === 'failed' || statusKind === 'unknown'" :size="14" /><Clock3 v-else :size="14" />{{ statusLabel }}</span></div>
      <p class="reason">{{ detailed ? card.proposal.reason : (card.proposal.display?.summary || card.action.name) }}</p>
      <div class="target-summary"><span>{{ zh ? "操作对象" : "Target" }}</span><strong>{{ target }}</strong></div>
      <form @submit.prevent="confirm">
        <div v-if="values.expected_value !== undefined" class="current-value"><span>{{ zh ? "当前内容" : "Current value" }}</span><strong>{{ values.expected_value || '—' }}</strong><ArrowRight :size="16" /><span>{{ zh ? "更新为下方内容" : "Update below" }}</span></div>
        <label v-for="parameter in visibleParameters" :key="parameter.name" class="parameter">
          <span>{{ parameterLabel(parameter) }}</span>
          <el-input v-model="values[parameter.name]" :placeholder="parameterPlaceholder(parameter.name)" :required="parameter.required" :disabled="!editable" :aria-label="parameter.description || parameter.name" />
        </label>
        <p v-if="!card.execution && !missingContext" class="confirmation-note">{{ !ready ? (zh ? "补充新内容后即可确认，其他信息已自动填好。" : "Complete the new value to continue. Other details are prefilled.") : (zh ? "确认后更新这条记录" : "Confirm to update this record") }}</p>
        <p v-if="missingContext && !card.execution" class="error" role="alert">{{ zh ? "操作对象信息不完整，请先重新查询这条记录，获取完整信息后再生成操作建议。" : "Target details are incomplete. Query the record again before requesting a new suggestion." }}</p>
        <div class="proposal-actions">
        <el-button v-if="!card.execution" type="primary" native-type="submit" :loading="executing" :disabled="!ready || card.proposal.version !== card.action.version">{{ zh ? "确认更新" : "Confirm update" }}</el-button>
        <el-button v-if="!detailed && props.openDetails" text @click="props.openDetails">{{ zh ? "查看详情" : "View details" }}</el-button>
        <template v-if="card.execution && props.continueConversation">
          <el-button v-if="card.execution.status === 'succeeded' || card.execution.status === 'failed'" :loading="continuing" @click="continueAction('edit')">{{ zh ? (card.execution.status === 'failed' ? '修正后重新确认' : '再次修改') : 'Edit again' }}</el-button>
          <el-button v-if="card.execution.status !== 'executing'" text :disabled="continuing" @click="continueAction('verify')">{{ zh ? '查看最新数据' : 'Check latest data' }}</el-button>
        </template>
        </div>
        <p v-if="card.execution" class="execution-status" :class="card.execution.status" role="status">{{ card.execution.status === 'succeeded' ? (zh ? '已执行，数据已更新' : 'Executed; data updated') : card.execution.status === 'failed' ? (zh ? '执行失败' : 'Execution failed') : card.execution.status === 'executing' ? (zh ? '执行中' : 'Executing') : (zh ? '执行结果待核实，请先查询数据' : 'Outcome uncertain; check the data') }}</p>
        <el-button v-if="card.execution?.status === 'executing'" size="small" @click="load">{{ zh ? "刷新执行结果" : "Refresh result" }}</el-button>
        <p v-if="card.proposal.version !== card.action.version && !card.execution" class="error">{{ zh ? "Action 已变更，请重新生成操作建议。" : "The Action changed. Request a new proposal." }}</p>
        <div v-if="card.execution" class="outcome"><CheckCircle2 v-if="card.execution.status === 'succeeded'" :size="18" /><CircleAlert v-else :size="18" /><span>{{ card.execution.status === 'succeeded' ? (zh ? "操作已完成，可重新问我查看最新数据。" : "Completed. Ask again to see the latest data.") : (zh ? "尚未确认更新成功，请查看详情。" : "Update not confirmed. Review details.") }}</span></div>
        <details v-if="detailed" class="technical-details"><summary><ChevronRight :size="14" class="details-chevron" aria-hidden="true" /><span>{{ zh ? "操作说明与执行详情" : "Operation and execution details" }}</span></summary>
          <p>{{ card.action.description }}</p>
          <ul v-if="card.action.effects.length" class="effects"><li v-for="effect in card.action.effects" :key="effect">{{ effect }}</li></ul>
          <dl><div v-for="parameter in card.action.parameters" :key="parameter.name"><dt>{{ parameterLabel(parameter) }} · {{ parameter.name }}</dt><dd>{{ values[parameter.name] || '—' }}</dd></div></dl>
          <p v-if="card.execution?.error" class="error">{{ card.execution.error }}</p>
          <pre v-if="result" class="execution-result">{{ result }}</pre>
        </details>
      </form>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <el-button v-if="error && !card" size="small" @click="load">{{ zh ? "重试" : "Retry" }}</el-button>
  </section>
</template>

<style scoped>
.action-proposal { display: block; box-sizing: border-box; min-width: 0; font-size: var(--text-sm); line-height: var(--leading-sm); }
.action-proposal.inline { padding: var(--spacing-lg); background: var(--el-fill-color-extra-light); }
.action-proposal.panel { padding: 0; }
.proposal-heading { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-sm); margin-bottom: var(--spacing-md); color: var(--el-text-color-secondary); }
.proposal-icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--radius-sm); background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.proposal-kind { font-weight: var(--font-medium); color: var(--el-text-color-primary); }
.proposal-status { display: inline-flex; align-items: center; gap: var(--spacing-xs); min-height: 28px; box-sizing: border-box; margin-inline-start: auto; padding: var(--spacing-xs) var(--spacing-sm); border-radius: var(--radius-sm); font-size: var(--text-xs); line-height: var(--leading-xs); font-weight: var(--font-semibold); }
.proposal-status.pending { color: var(--el-color-warning-dark-2); background: var(--el-color-warning-light-9); }
.proposal-status.executing { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.proposal-status.succeeded { color: var(--el-color-success-dark-2); background: var(--el-color-success-light-9); }
.proposal-status.failed, .proposal-status.unknown { color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.status-spin { animation: action-spin 1s linear infinite; }
@keyframes action-spin { to { transform: rotate(360deg); } }
.reason { font-weight: var(--font-medium); }
.target-summary { display: flex; align-items: baseline; gap: var(--spacing-md); padding-block: var(--spacing-md); border-bottom: 1px solid var(--el-border-color-lighter); }
.target-summary > span, .current-value > span { color: var(--el-text-color-secondary); }
.target-summary strong, .current-value strong { font-weight: var(--font-medium); overflow-wrap: anywhere; }
.current-value { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-sm); }
.proposal-actions { display: flex; align-items: center; gap: var(--spacing-sm); }
.proposal-actions .el-button + .el-button { margin-left: 0; }
.outcome { display: flex; align-items: center; gap: var(--spacing-sm); padding: var(--spacing-md); background: var(--el-fill-color-light); width: 100%; box-sizing: border-box; border-radius: var(--radius-md); }
.technical-details { width: 100%; border-top: 1px solid var(--el-border-color-lighter); padding-top: var(--spacing-md); }
.technical-details summary { display: flex; align-items: center; gap: var(--spacing-sm); min-height: var(--control-height); box-sizing: border-box; padding: var(--spacing-xs) var(--spacing-sm); border-radius: var(--radius-sm); list-style: none; cursor: pointer; color: var(--el-text-color-secondary); transition: background-color var(--transition-fast), color var(--transition-fast); }
.technical-details summary::-webkit-details-marker { display: none; }
.technical-details summary:hover { background: var(--el-fill-color-light); color: var(--el-text-color-primary); }
.technical-details summary:active { background: var(--el-fill-color); }
.technical-details summary:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 1px; }
.details-chevron { flex-shrink: 0; transition: transform var(--transition-fast); }
.technical-details[open] > summary .details-chevron { transform: rotate(90deg); }
.technical-details dl { display: grid; gap: var(--spacing-sm); }
.technical-details dt { color: var(--el-text-color-secondary); }
.technical-details dd { margin: 0; overflow-wrap: anywhere; }
.reason, .description, .confirmation-note, .execution-status, .error { margin: 0; }
.description, .confirmation-note { color: var(--el-text-color-secondary); }
.description { margin-top: var(--spacing-xs); }
.effects { margin: var(--spacing-sm) 0; padding-left: var(--spacing-lg); }
form { display: flex; flex-direction: column; align-items: flex-start; gap: var(--spacing-md); margin-top: var(--spacing-md); }
.parameter { display: flex; flex-direction: column; gap: var(--spacing-xs); width: 100%; }
.parameter small { color: var(--el-text-color-secondary); margin-left: var(--spacing-xs); }
.error, .failed, .unknown { color: var(--el-color-danger); overflow-wrap: anywhere; }
.succeeded { color: var(--el-color-success); }
.execution-result { max-width: 100%; box-sizing: border-box; max-height: 240px; overflow: auto; margin: 0; padding: var(--spacing-sm); white-space: pre-wrap; background: var(--el-fill-color-light); border-radius: var(--radius-sm); font-size: var(--text-xs); }
@media (prefers-reduced-motion: reduce) {
  .technical-details summary, .details-chevron { transition: none; }
  .status-spin { animation: none; }
}
</style>
