<script setup lang="ts">
import { computed, ref } from "vue";
import { ElTag } from "element-plus";
import { useOntologyText } from "../../context";

const props = defineProps<{ action: any | null }>();
const { ot } = useOntologyText();
const root = ref<HTMLElement | null>(null);

const definition = computed(() => props.action?.definition ?? null);

const EFFECT_LABELS: Record<string, string> = {
  CREATE_OBJECT: "新建对象",
  UPDATE_OBJECT: "修改对象",
  DELETE_OBJECT: "删除对象",
  CREATE_EDGE: "建立关系",
  DELETE_EDGE: "删除关系",
  APPEND_VECTOR: "追加向量",
  UPDATE_VECTOR: "更新向量",
  DELETE_VECTOR: "删除向量",
  EXTERNAL_CALL: "外部调用",
};
const RULE_GROUPS: { key: string; label: string; kinds: string[] }[] = [
  { key: "create", label: "Create", kinds: ["CREATE_OBJECT"] },
  { key: "modify", label: "Modify", kinds: ["UPDATE_OBJECT"] },
  { key: "delete", label: "Delete", kinds: ["DELETE_OBJECT"] },
  { key: "link", label: "Link", kinds: ["CREATE_EDGE", "DELETE_EDGE"] },
  { key: "vector", label: "Vector", kinds: ["APPEND_VECTOR", "UPDATE_VECTOR", "DELETE_VECTOR"] },
  { key: "other", label: "Other", kinds: ["EXTERNAL_CALL"] },
];
const ruleGroups = computed(() => {
  const effects = definition.value?.effects || [];
  return RULE_GROUPS.map((group) => ({
    ...group,
    items: effects.filter((effect: any) => group.kinds.includes(effect.kind)),
  })).filter((group) => group.items.length > 0);
});
const ruleLabel = (kind: string) => EFFECT_LABELS[kind] || kind;
const ruleTarget = (rule: any) => {
  if (rule.relation) return `${rule.sourceClass || "?"} → ${rule.targetClass || "?"}（${rule.relation}）`;
  return rule.className || "—";
};

const parameterNames = computed(() =>
  (definition.value?.parameters || []).map((parameter: any) => parameter.name)
);

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] || ch
  );
}
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function renderValueFrom(valueFrom: string) {
  const text = escapeHtml(valueFrom || "");
  const names = parameterNames.value.slice().sort((a: string, b: string) => b.length - a.length);
  if (!names.length) return text;
  const pattern = new RegExp(`\\b(${names.map(escapeRegExp).join("|")})\\b`, "g");
  return text.replace(
    pattern,
    (name) => `<span class="param-link" data-param="${name}" title="查看参数说明">${name}</span>`
  );
}
function onParamClick(event: MouseEvent) {
  const target = (event.target as HTMLElement).closest("[data-param]");
  if (!target) return;
  const name = target.getAttribute("data-param");
  if (!name) return;
  const row = root.value?.querySelector(`[data-param-row="${CSS.escape(name)}"]`);
  if (!(row instanceof HTMLElement)) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("param-flash");
  window.setTimeout(() => row.classList.remove("param-flash"), 1400);
}

function guardText(condition: any): string {
  if (!condition) return "";
  if (condition.properties) return guardText(condition.properties);
  if (condition.operator === "logic") {
    const and = (condition.and || []).map(guardText).filter(Boolean);
    const or = (condition.or || []).map(guardText).filter(Boolean);
    if (and.length) return and.join(" 且 ");
    if (or.length) return or.join(" 或 ");
    return "";
  }
  if (!condition.field) return "";
  const value = condition.value === undefined ? "" : ` ${JSON.stringify(condition.value)}`;
  return `${condition.field} ${condition.operator}${value}`;
}

const submissionCriteria = computed(() => definition.value?.submissionCriteria ?? null);
const criteriaConditions = computed(() => submissionCriteria.value?.conditions || []);
const criteriaOperator = computed(() => submissionCriteria.value?.operator || "AND");
const criteriaUnrepresentable = computed(() => submissionCriteria.value?.unrepresentable || []);
function criterionText(condition: any): string {
  if (!condition) return "";
  if (condition.kind === "PROPERTY")
    return `${condition.className || condition.objectParameter || "?"}.${condition.field} ${condition.operator} ${JSON.stringify(condition.value)}`;
  if (condition.kind === "LINK_EXISTS")
    return `${condition.from || condition.objectParameter || "?"} 存在关系 ${condition.relation}`;
  return condition.description || condition.kind || "—";
}
function criterionMessage(condition: any): string {
  return condition?.message || condition?.failureMessage || "";
}

const negativeEffect = computed(() => definition.value?.businessMeaning?.negativeEffect ?? "");
</script>

<template>
  <section ref="root" class="definition-view" @click="onParamClick">
    <div v-if="!definition" class="empty">
      <p>{{ ot("actionDefinitionEmpty") }}</p>
    </div>
    <template v-else>
      <div class="section-title">
        <h2>Rules（规则）</h2>
        <el-tag size="small" type="info">派生 · 未验证</el-tag>
      </div>
      <p class="text-muted">
        从代码解释投影出的规则清单，仅用于阅读；平台不执行这些规则，运行时仍以 Python 代码为准。
      </p>
      <div v-if="definition.objects?.length" class="definition-objects">
        <el-tag v-for="name in definition.objects" :key="name" size="small">{{ name }}</el-tag>
      </div>

      <div v-for="group in ruleGroups" :key="group.key" class="rule-group">
        <h3 class="rule-group-title">
          {{ group.label }}
          <span class="rule-count">{{ group.items.length }}</span>
        </h3>
        <div v-for="(rule, index) in group.items" :key="index" class="rule-row">
          <div class="rule-head">
            <el-tag size="small">{{ ruleLabel(rule.kind) }}</el-tag>
            <span class="rule-target">{{ ruleTarget(rule) }}</span>
          </div>
          <div v-if="(rule.assignments || []).length" class="rule-line">
            <span class="rule-key">字段</span>
            <span class="rule-values">
              <span v-for="item in rule.assignments" :key="item.field" class="assignment">
                {{ item.field }} ← <span v-html="renderValueFrom(item.valueFrom)"></span>
              </span>
            </span>
          </div>
          <div v-if="rule.guards" class="rule-line">
            <span class="rule-key">条件</span>
            <code class="rule-guard">{{ guardText(rule.guards) }}</code>
          </div>
          <div v-if="rule.objectIdFrom || rule.sourceObjectIdFrom || rule.targetObjectIdFrom" class="rule-line">
            <span class="rule-key">定位</span>
            <span class="rule-values">
              <span v-if="rule.objectIdFrom">
                object ← <span v-html="renderValueFrom(rule.objectIdFrom)"></span>
              </span>
              <span v-if="rule.sourceObjectIdFrom">
                source ← <span v-html="renderValueFrom(rule.sourceObjectIdFrom)"></span>
              </span>
              <span v-if="rule.targetObjectIdFrom">
                target ← <span v-html="renderValueFrom(rule.targetObjectIdFrom)"></span>
              </span>
            </span>
          </div>
        </div>
      </div>

      <table class="param-table">
        <thead>
          <tr><th>参数</th><th>类型</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr
            v-for="parameter in definition.parameters || []"
            :key="parameter.name"
            :data-param-row="parameter.name"
          >
            <td><span class="param-chip">{{ parameter.name }}</span></td>
            <td>{{ parameter.type }}</td>
            <td>{{ parameter.description }}</td>
          </tr>
        </tbody>
      </table>

      <div class="criteria-block">
        <h4>Submission criteria</h4>
        <p class="desc">动作开始前统一判定；任一条失败则整个动作不执行。</p>
        <template v-if="submissionCriteria">
          <div v-if="criteriaConditions.length" class="criteria-list">
            <div v-for="(condition, index) in criteriaConditions" :key="index" class="criteria-row">
              <div class="criteria-main">
                <span class="kt">{{ criteriaOperator }}</span>
                <code class="rule-guard">{{ criterionText(condition) }}</code>
              </div>
              <div v-if="criterionMessage(condition)" class="criteria-msg">
                {{ criterionMessage(condition) }}
              </div>
            </div>
          </div>
          <div v-else class="empty-inline">已声明，但没有条件。</div>
          <div v-if="criteriaUnrepresentable.length" class="criteria-custom">
            <b>自定义校验（未结构化）</b>
            <div v-for="(item, index) in criteriaUnrepresentable" :key="index">
              {{ item.description }}
              <span v-if="item.reason" class="muted">（{{ item.reason }}）</span>
            </div>
          </div>
        </template>
        <div v-else class="empty-inline">未声明。当前 Action 没有结构化前置条件。</div>
      </div>

      <div v-if="negativeEffect" class="consequences">
        <h4>可能的后果</h4>
        <p>{{ negativeEffect }}</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.definition-view {
  height: 100%;
  overflow: auto;
  padding: 16px 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.empty {
  display: grid;
  place-items: center;
  min-height: 240px;
  padding: 24px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
  text-align: center;
}
.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.section-title h2 {
  margin: 0;
  font-size: var(--text-lg, 17px);
}
.text-muted,
.desc {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
  line-height: 1.55;
}
.definition-objects {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.rule-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rule-group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0 0;
  font-size: var(--text-xs, 12px);
  color: var(--el-text-color-secondary);
}
.rule-count {
  display: grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--el-fill-color);
  font-size: 10px;
}
.rule-row {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rule-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.rule-target {
  font-size: var(--text-xs, 12px);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.rule-line {
  display: flex;
  gap: 6px;
  font-size: var(--text-xs, 12px);
  overflow-wrap: anywhere;
}
.rule-key {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.rule-values {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rule-guard {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}
.param-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs, 12px);
}
.param-table th,
.param-table td {
  padding: 6px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  text-align: start;
  vertical-align: top;
}
.param-table th {
  color: var(--el-text-color-secondary);
  font-weight: 500;
}
.param-chip {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  font-weight: 500;
}
.criteria-block {
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.criteria-block h4,
.consequences h4 {
  margin: 0;
  font-size: var(--text-sm, 13px);
}
.criteria-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.criteria-row {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
}
.criteria-main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}
.kt {
  font-size: 10px;
  color: var(--el-text-color-secondary);
}
.criteria-msg {
  margin-top: 3px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 11px);
}
.criteria-custom {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: var(--text-xs, 12px);
}
.muted {
  color: var(--el-text-color-secondary);
}
.empty-inline {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
}
.consequences {
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.consequences p {
  margin: 6px 0 0;
  color: var(--el-text-color-regular);
  font-size: var(--text-xs, 12px);
  line-height: 1.6;
  white-space: pre-wrap;
}
.definition-view :deep(.param-link) {
  color: var(--el-color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.definition-view :deep(.param-link::after) {
  content: "↗";
  font-size: 10px;
  margin-left: 2px;
  opacity: 0.65;
}
.definition-view :deep(.param-link:hover) {
  color: var(--el-color-primary-dark-2);
}
.definition-view :deep(.param-flash) {
  animation: param-flash 1.4s ease;
}
@keyframes param-flash {
  from { background: var(--el-color-primary-light-8); }
  to { background: transparent; }
}
</style>
