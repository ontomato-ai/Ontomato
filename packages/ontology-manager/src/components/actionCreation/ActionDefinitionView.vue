<script setup lang="ts">
import { computed } from "vue";
import { ElAlert, ElTag } from "element-plus";
import { useOntologyText } from "../../context";
import type { MessageKey } from "../../i18n";

const props = defineProps<{ action: any | null }>();
const { ot } = useOntologyText();

const definition = computed(() => props.action?.definition ?? null);

const GROUP_LABELS: Record<string, MessageKey> = {
  CREATE_OBJECT: "actionDefinitionCreateObject",
  UPDATE_OBJECT: "actionDefinitionUpdateObject",
  DELETE_OBJECT: "actionDefinitionDeleteObject",
  CREATE_EDGE: "actionDefinitionCreateEdge",
  DELETE_EDGE: "actionDefinitionDeleteEdge",
  APPEND_VECTOR: "actionDefinitionVector",
  UPDATE_VECTOR: "actionDefinitionVector",
  DELETE_VECTOR: "actionDefinitionVector",
  EXTERNAL_CALL: "actionDefinitionExternal",
};

const groups = computed(() => {
  const effects = Array.isArray(definition.value?.effects) ? definition.value.effects : [];
  const grouped = new Map<string, any[]>();
  for (const effect of effects) {
    const kind = String(effect?.kind ?? "");
    const label = GROUP_LABELS[kind] ?? "actionDefinitionOther";
    grouped.set(label, [...(grouped.get(label) ?? []), effect]);
  }
  return [...grouped.entries()].map(([label, items]) => ({ label, items }));
});

const parameters = computed(() =>
  Array.isArray(definition.value?.parameters) ? definition.value.parameters : []
);
const conditions = computed(() =>
  Array.isArray(definition.value?.submissionCriteria?.conditions)
    ? definition.value.submissionCriteria.conditions
    : []
);
const unrepresentable = computed(() =>
  Array.isArray(definition.value?.submissionCriteria?.unrepresentable)
    ? definition.value.submissionCriteria.unrepresentable
    : []
);
const reads = computed(() => (Array.isArray(definition.value?.reads) ? definition.value.reads : []));
const negativeEffect = computed(() => definition.value?.businessMeaning?.negativeEffect ?? "");

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function guardText(value: unknown): string {
  if (!value) return "";
  return JSON.stringify(value);
}

function effectTitle(effect: any): string {
  return text(effect?.title) || text(effect?.className) || text(effect?.relation) || "—";
}

function groupLabel(label: string): string {
  return ot(label as MessageKey);
}
</script>

<template>
  <section class="definition-view">
    <div v-if="!definition" class="empty">
      <p>{{ ot("actionDefinitionEmpty") }}</p>
    </div>
    <template v-else>
      <header class="definition-head">
        <div class="title-line">
          <h3>{{ action?.name || definition.name || "—" }}</h3>
          <el-tag size="small" type="warning">{{ ot("actionWizardDerived") }}</el-tag>
        </div>
        <p v-if="action?.description || definition.description" class="description">
          {{ action?.description || definition.description }}
        </p>
        <div class="meta">
          <span v-if="definition.target?.objectType || definition.target?.operation">
            {{ ot("actionDefinitionTarget") }}:
            {{ definition.target?.objectType || "—" }} · {{ definition.target?.operation || "—" }}
          </span>
          <span v-if="definition.codeHash" class="hash">
            {{ ot("actionDefinitionCodeHash") }}: {{ definition.codeHash.slice(0, 12) }}
          </span>
        </div>
      </header>

      <section class="block">
        <h4>{{ ot("actionWizardStepParameters") }}</h4>
        <p v-if="!parameters.length" class="muted">{{ ot("actionDefinitionNoParameters") }}</p>
        <table v-else>
          <thead>
            <tr>
              <th>{{ ot("actionWizardParameterName") }}</th>
              <th>{{ ot("actionWizardParameterType") }}</th>
              <th>{{ ot("actionWizardDescription") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="parameter in parameters" :key="parameter.name">
              <td>{{ parameter.name }}</td>
              <td>{{ parameter.type }}</td>
              <td>{{ parameter.description || "—" }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="block">
        <h4>{{ ot("actionWizardStepRules") }}</h4>
        <p v-if="!groups.length" class="muted">{{ ot("actionDefinitionNoRules") }}</p>
        <div v-for="group in groups" :key="group.label" class="rule-group">
          <h5>{{ groupLabel(group.label) }}</h5>
          <article v-for="(effect, index) in group.items" :key="index" class="effect">
            <div class="effect-title">{{ effectTitle(effect) }}</div>
            <ul v-if="effect.assignments?.length" class="assignments">
              <li v-for="assignment in effect.assignments" :key="assignment.field">
                <code>{{ assignment.field }}</code>
                <span>←</span>
                <span>{{ assignment.valueFrom }}</span>
              </li>
            </ul>
            <div v-if="effect.relation" class="line">
              {{ ot("actionDefinitionRelation") }}: {{ effect.relation }}
              <span v-if="effect.sourceClass"> · {{ effect.sourceClass }} → {{ effect.targetClass }}</span>
            </div>
            <div v-if="effect.attrName" class="line">
              {{ ot("actionDefinitionAttribute") }}: {{ effect.attrName }}
              <span v-if="effect.textFrom"> · {{ effect.textFrom }}</span>
              <span v-else-if="effect.fileIdFrom"> · {{ effect.fileIdFrom }}</span>
            </div>
            <div v-if="effect.narrative" class="line">{{ effect.narrative }}</div>
            <div v-if="effect.guards" class="line guard">
              {{ ot("actionDefinitionGuard") }}: <code>{{ guardText(effect.guards) }}</code>
            </div>
          </article>
        </div>
      </section>

      <section class="block">
        <h4>{{ ot("actionWizardStepConditions") }}</h4>
        <p v-if="!conditions.length && !unrepresentable.length" class="muted">
          {{ ot("actionWizardNoCriteria") }}
        </p>
        <template v-else>
          <div class="operator">
            {{ ot("actionWizardCriteriaOperator") }}:
            {{ definition.submissionCriteria?.operator || "AND" }}
          </div>
          <ul class="conditions">
            <li v-for="(condition, index) in conditions" :key="index">
              <code>{{ condition.className || condition.object }}.{{ condition.field }}</code>
              {{ condition.operator }} {{ condition.value }}
              <span v-if="condition.message" class="message">— {{ condition.message }}</span>
            </li>
          </ul>
          <el-alert
            v-if="unrepresentable.length"
            :title="ot('actionWizardUnrepresentable')"
            type="info"
            :closable="false"
            show-icon
          >
            <ul class="conditions">
              <li v-for="(item, index) in unrepresentable" :key="index">
                {{ typeof item === "string" ? item : `${item.description} — ${item.reason}` }}
              </li>
            </ul>
          </el-alert>
        </template>
      </section>

      <section v-if="reads.length" class="block">
        <h4>{{ ot("actionDefinitionReads") }}</h4>
        <ul class="conditions">
          <li v-for="(read, index) in reads" :key="index">
            {{ read.className || read.class || "—" }}
          </li>
        </ul>
      </section>

      <section v-if="negativeEffect" class="block">
        <h4>{{ ot("actionDefinitionConsequences") }}</h4>
        <p class="negative">{{ negativeEffect }}</p>
      </section>
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
  gap: 16px;
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
.definition-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.title-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.title-line h3 {
  margin: 0;
  font-size: var(--text-lg, 17px);
}
.description {
  margin: 0;
  color: var(--el-text-color-regular);
  line-height: 1.55;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 11px);
}
.hash {
  font-family: var(--font-mono, monospace);
}
.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-light);
}
.block h4 {
  margin: 0;
  font-size: var(--text-sm, 13px);
  color: var(--el-text-color-primary);
}
.block h5 {
  margin: 8px 0 4px;
  font-size: var(--text-xs, 12px);
  color: var(--el-text-color-secondary);
  font-weight: 600;
}
.muted {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs, 12px);
}
th,
td {
  padding: 5px 6px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  text-align: start;
  vertical-align: top;
}
th {
  color: var(--el-text-color-secondary);
  font-weight: 500;
}
.effect {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
}
.effect-title {
  font-weight: 600;
  font-size: var(--text-xs, 12px);
  margin-bottom: 4px;
}
.assignments {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: var(--text-xs, 12px);
}
.assignments li {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: baseline;
}
.line {
  margin-top: 3px;
  color: var(--el-text-color-regular);
  font-size: var(--text-xs, 12px);
  overflow-wrap: anywhere;
}
.guard code {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.operator {
  font-size: var(--text-xs, 12px);
  color: var(--el-text-color-secondary);
}
.conditions {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--text-xs, 12px);
}
.message {
  color: var(--el-text-color-secondary);
}
.negative {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: var(--text-xs, 12px);
  line-height: 1.55;
  white-space: pre-wrap;
}
</style>
