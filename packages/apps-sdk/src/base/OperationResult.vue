<script setup lang="ts">
import { computed, defineAsyncComponent, inject, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElAlert } from "element-plus/es/components/alert/index";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElRadio, ElRadioGroup } from "element-plus/es/components/radio/index";
import { ElTable, ElTableColumn } from "element-plus/es/components/table/index";
import { ElTabPane, ElTabs } from "element-plus/es/components/tabs/index";
import type {
  PanelReadOperationRecordCell,
  PanelReadOperationResult,
  PanelReadOperationSectionDeclaration,
} from "@ontomato/contracts/panel-operations";
import { panelContextKey } from "../panel/context";
import { panelMemberKey } from "../panel/member";
import { admittedOperations } from "../panel/member-operations";
import type { PanelProjectionRegistration } from "../panel/ports";
import {
  defaultOperationSectionId,
  formatOperationJson,
  formatOperationRecordCell,
  operationResultSections,
  resolveOperationCodeLanguage,
} from "./operation-result-sections";

/**
 * Displays what a read-only operation returned, as its owner described it: Markdown with a preview/source toggle, a
 * JSON value with optional truncation warning shown as formatted read-only JSON, a multi-section tabbed result
 * (tabular records, language-tagged code/text, or JSON per section), or the name of the file the reader saved (an
 * export). When `operationSlot` is provided and `result` is absent, pre-declared `resultSections` from the owner's
 * operation descriptor render the section tabs with their empty-state prompts ahead of execution. Nothing is written
 * and nothing is reported as changed. Heavy renderers are fetched the first time a result of their kind is shown, never
 * with the panel.
 */
const props = withDefaults(
  defineProps<{
    /** The read-only operation result returned by the platform coordinator, or null/undefined before execution. */
    result?: PanelReadOperationResult | null;
    /** Optional panel member slot declaring the read operation whose pre-declared `resultSections` should be displayed before execution. */
    operationSlot?: string;
    /** Optional operation local name within `operationSlot` (defaults to the slot's sole operation when omitted). */
    operationName?: string;
    /** Optional empty-state text or message key shown when neither a result nor section-specific empty text is present. */
    emptyText?: string;
  }>(),
  {
    result: null,
    operationSlot: undefined,
    operationName: undefined,
    emptyText: undefined,
  },
);

const { t, te } = useI18n();
const panel = inject(panelContextKey, null);
const memberGetter = inject(panelMemberKey, null);
const MarkdownView = defineAsyncComponent(() => import("@ontomato/foundation-ui/markdown").then((module) => module.MarkdownView));
const CodeEditor = defineAsyncComponent(() => import("@ontomato/foundation-ui/code").then((module) => module.CodeEditor));
const markdownMode = ref<"preview" | "source">("preview");

const declaredSections = computed<readonly PanelReadOperationSectionDeclaration[]>(() => {
  const slotName = props.operationSlot?.trim();
  const opName = props.operationName?.trim();
  let ops: PanelProjectionRegistration["operations"] | null = null;
  if (slotName && panel) {
    const registrations = (panel.instance.projections as unknown as { readonly value?: readonly PanelProjectionRegistration[] } | undefined)?.value;
    const registration = registrations?.find((item) => item.slot === slotName);
    if (registration) ops = registration.operations;
    else if (memberGetter && memberGetter().key === slotName) ops = admittedOperations(memberGetter().operations.value);
  } else if (!slotName && opName && memberGetter) {
    ops = admittedOperations(memberGetter().operations.value);
  }
  if (!ops) return [];
  if (opName) {
    return ops[opName]?.resultSections ?? [];
  }
  const entries = Object.values(ops);
  if (entries.length === 1) return entries[0]?.resultSections ?? [];
  const readOpsWithSections = entries.filter((op) => op.effect === "read" && Boolean(op.resultSections?.length));
  return readOpsWithSections.length === 1 ? (readOpsWithSections[0]?.resultSections ?? []) : [];
});

const activeSectionId = ref<string>(
  props.result ? defaultOperationSectionId(props.result) : (declaredSections.value[0]?.id ?? ""),
);

watch(
  () => props.result,
  (next) => {
    markdownMode.value = "preview";
    activeSectionId.value = next
      ? defaultOperationSectionId(next)
      : (declaredSections.value[0]?.id ?? "");
  },
);

watch(declaredSections, (next) => {
  if (props.result) return;
  if (!activeSectionId.value || !next.some((section) => section.id === activeSectionId.value)) {
    activeSectionId.value = next[0]?.id ?? "";
  }
});

const resolvedEmptyText = computed(() => {
  const custom = props.emptyText?.trim();
  if (!custom) return t("platform.operationNoResult");
  if (te(custom)) return t(custom);
  return panel ? panel.t(custom) : custom;
});

const hasMarkdown = computed(() => props.result?.kind === "markdown" && props.result.markdown.trim().length > 0);
const json = computed(() => (props.result?.kind === "json" ? formatOperationJson(props.result.value) : ""));
const truncation = computed(() => (props.result?.kind === "json" ? props.result.truncation ?? null : null));
const sections = computed(() => operationResultSections(props.result));

function cellText(row: Record<string, PanelReadOperationRecordCell>, key: string): string {
  return formatOperationRecordCell(row[key]);
}
</script>

<template>
  <div class="sdk-operation-result" role="status">
    <div v-if="!result && declaredSections.length > 0" class="sdk-operation-sections-wrap sdk-operation-sections-placeholder">
      <el-tabs v-model="activeSectionId" class="sdk-operation-sections">
        <el-tab-pane
          v-for="section in declaredSections"
          :key="section.id"
          :label="section.label"
          :name="section.id"
        >
          <div class="sdk-operation-section-body">
            <el-empty :description="section.emptyText || resolvedEmptyText"></el-empty>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
    <div v-else-if="!result" class="sdk-operation-empty-wrap">
      <el-empty :description="resolvedEmptyText"></el-empty>
    </div>
    <p v-else-if="result.kind === 'file'" class="sdk-operation-file">{{ t("platform.operationDownloaded", { name: result.name }) }}</p>
    <div v-else-if="result.kind === 'markdown'" class="sdk-operation-markdown">
      <template v-if="hasMarkdown">
        <el-radio-group v-model="markdownMode" size="small" class="sdk-operation-markdown-toggle">
          <el-radio value="preview">{{ t("platform.operationPreview") }}</el-radio>
          <el-radio value="source">{{ t("platform.operationSource") }}</el-radio>
        </el-radio-group>
        <div v-if="markdownMode === 'preview'" class="sdk-operation-markdown-preview">
          <markdown-view :content="result.markdown"></markdown-view>
        </div>
        <code-editor v-else :model-value="result.markdown" language="markdown" readonly :min-height="200"></code-editor>
      </template>
      <p v-else class="sdk-operation-empty">{{ t("platform.operationNoResult") }}</p>
    </div>
    <div v-else-if="result.kind === 'sections'" class="sdk-operation-sections-wrap">
      <el-tabs v-model="activeSectionId" class="sdk-operation-sections">
        <el-tab-pane
          v-for="section in sections"
          :key="section.id"
          :label="section.label"
          :name="section.id"
        >
          <div v-if="section.kind === 'records'" class="sdk-operation-section-body sdk-operation-section-records">
            <el-empty
              v-if="section.rows.length === 0 || section.columns.length === 0"
              :description="section.emptyText || t('platform.operationNoResult')"
            ></el-empty>
            <el-table
              v-else
              :data="section.rows"
              border
              stripe
              class="sdk-operation-records-table"
            >
              <el-table-column
                v-for="col in section.columns"
                :key="col.key"
                :prop="col.key"
                :label="col.label"
                min-width="140"
                show-overflow-tooltip
              >
                <template #default="{ row }">
                  {{ cellText(row, col.key) }}
                </template>
              </el-table-column>
            </el-table>
          </div>
          <div v-else-if="section.kind === 'code'" class="sdk-operation-section-body sdk-operation-section-code">
            <el-empty
              v-if="section.content.trim().length === 0"
              :description="section.emptyText || t('platform.operationNoResult')"
            ></el-empty>
            <code-editor
              v-else-if="activeSectionId === section.id"
              :model-value="section.content"
              :language="resolveOperationCodeLanguage(section.language)"
              readonly
              :min-height="200"
            ></code-editor>
          </div>
          <div v-else class="sdk-operation-section-body sdk-operation-section-json">
            <el-alert
              v-if="section.truncation"
              type="warning"
              :closable="false"
              :title="t('platform.operationTruncated', { rows: section.truncation.rowLimit ?? '—' })"
              :description="section.truncation.hint || undefined"
            ></el-alert>
            <code-editor
              v-if="activeSectionId === section.id"
              :model-value="formatOperationJson(section.value)"
              language="json"
              readonly
              :min-height="200"
            ></code-editor>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
    <div v-else class="sdk-operation-json">
      <el-alert
        v-if="truncation"
        type="warning"
        :closable="false"
        :title="t('platform.operationTruncated', { rows: truncation.rowLimit ?? '—' })"
        :description="truncation.hint || undefined"
      ></el-alert>
      <code-editor :model-value="json" language="json" readonly :min-height="120"></code-editor>
    </div>
  </div>
</template>

<style scoped>
.sdk-operation-result {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  margin-block-start: var(--spacing-sm);
}
.sdk-operation-markdown,
.sdk-operation-json,
.sdk-operation-sections-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}
.sdk-operation-sections {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}
.sdk-operation-sections :deep(.el-tabs__header) {
  margin-block-end: var(--spacing-sm);
  flex-shrink: 0;
}
.sdk-operation-sections :deep(.el-tabs__content) {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.sdk-operation-sections :deep(.el-tab-pane) {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}
.sdk-operation-section-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}
.sdk-operation-section-records {
  overflow: auto;
}
.sdk-operation-records-table {
  width: 100%;
}
.sdk-operation-section-code :deep(.code-editor),
.sdk-operation-section-json :deep(.code-editor) {
  flex: 1 1 auto;
  min-height: 200px;
}
.sdk-operation-markdown-preview {
  max-height: 28rem;
  overflow: auto;
  padding: var(--spacing-md);
  border: 1px solid var(--ui-divider, var(--el-border-color-lighter));
  border-radius: var(--radius-sm, 6px);
  background: var(--sdk-bg-color, var(--el-bg-color));
}
.sdk-operation-empty {
  margin: 0;
  color: var(--sdk-text-color-secondary, var(--el-text-color-secondary));
  font-size: var(--text-xs);
}
</style>
