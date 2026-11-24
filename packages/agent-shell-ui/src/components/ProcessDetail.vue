<script setup lang="ts">
import { computed, inject, ref } from "vue";
import {
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Cpu,
  FileMinus,
  FilePen,
  FilePlus,
  Info,
  LoaderCircle,
  Minimize2,
  Paperclip,
  ShieldAlert,
  TriangleAlert,
  Zap,
} from "lucide-vue-next";
import type { RuntimeRunDetail } from "@ontomato/contracts/agent-runtime-details";
import { shellContextKey } from "../context";

/** Engine-neutral view of one `run_detail` process entry, reusing the shell's tool-step row styling. */
const props = defineProps<{
  detail: RuntimeRunDetail;
  running?: boolean;
}>();

const shell = inject(shellContextKey)!;
const open = ref(false);

const inProgress = computed(() => {
  if (props.running === false) return false;
  switch (props.detail.category) {
    case "compaction":
    case "hook":
    case "review":
      return props.detail.status === "started";
    default:
      return false;
  }
});

const icon = computed(() => {
  if (inProgress.value) return LoaderCircle;
  switch (props.detail.category) {
    case "file_change":
      if (props.detail.operation === "added") return FilePlus;
      if (props.detail.operation === "deleted") return FileMinus;
      return FilePen;
    case "compaction":
      return Minimize2;
    case "diagnostic":
      if (props.detail.level === "error") return CircleAlert;
      if (props.detail.level === "warning") return TriangleAlert;
      return Info;
    case "attachment":
      return Paperclip;
    case "hook":
      return Zap;
    case "model":
      return Cpu;
    case "moderation":
      return ShieldAlert;
    case "review":
      return ClipboardCheck;
    default:
      return Info;
  }
});

const tone = computed<"neutral" | "warning" | "error">(() => {
  if (props.detail.category === "diagnostic") {
    if (props.detail.level === "error") return "error";
    if (props.detail.level === "warning") return "warning";
  }
  if (props.detail.category === "moderation") return "warning";
  return "neutral";
});

const label = computed(() => {
  const dict = shell.labels.value.runDetails;
  switch (props.detail.category) {
    case "file_change":
      if (props.detail.operation === "added") return dict?.fileAdded ?? "Added file";
      if (props.detail.operation === "deleted") return dict?.fileDeleted ?? "Deleted file";
      return dict?.fileModified ?? "Modified file";
    case "compaction":
      return dict?.compaction ?? "Context compaction";
    case "diagnostic":
      return dict?.diagnostic ?? "Diagnostic";
    case "attachment":
      return dict?.attachment ?? "Attachment";
    case "hook":
      return dict?.hook ?? "Hook";
    case "model":
      return dict?.model ?? "Model";
    case "moderation":
      return dict?.moderation ?? "Moderation";
    case "review":
      return dict?.review ?? "Review";
    default:
      return dict?.diagnostic ?? "Diagnostic";
  }
});

const subject = computed(() => {
  switch (props.detail.category) {
    case "file_change":
      return props.detail.path;
    case "attachment":
      return props.detail.object;
    case "hook":
    case "review":
      return props.detail.name;
    case "model":
      return props.detail.model;
    case "moderation":
      return props.detail.stage;
    default:
      return "";
  }
});

const subtext = computed(() => {
  if (props.detail.category === "diagnostic" && props.detail.action) return props.detail.action;
  if (props.detail.category === "moderation" && props.detail.reason) return props.detail.reason;
  return "";
});

const patch = computed(() =>
  props.detail.category === "file_change" && props.detail.patch ? props.detail.patch : "",
);
</script>

<template>
  <div class="run-detail" :class="[tone, { open }]" :data-detail-category="detail.category">
    <button
      v-if="patch"
      type="button"
      class="detail-row interactive"
      :aria-expanded="open"
      @click="open = !open"
    >
      <component :is="icon" :size="13" class="detail-icon" :class="{ spin: inProgress }" />
      <span class="detail-label">{{ label }}</span>
      <span v-if="subject" class="detail-subject">{{ subject }}</span>
      <span class="detail-text">{{ detail.text }}</span>
      <ChevronRight :size="14" class="chevron" />
    </button>
    <div v-else class="detail-row">
      <component :is="icon" :size="13" class="detail-icon" :class="{ spin: inProgress }" />
      <span class="detail-label">{{ label }}</span>
      <span v-if="subject" class="detail-subject">{{ subject }}</span>
      <span class="detail-text">{{ detail.text }}</span>
    </div>
    <p v-if="subtext" class="detail-subtext">{{ subtext }}</p>
    <div v-if="patch && open" class="detail-body">
      <div class="body-label">{{ shell.labels.value.runDetails?.patch ?? "Patch" }}</div>
      <pre>{{ patch }}</pre>
    </div>
  </div>
</template>

<style scoped>
.run-detail {
  margin: 0 0 0 -8px;
  font-size: var(--text-sm, 13px);
  line-height: var(--leading-sm);
}
.detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  text-align: left;
}
button.detail-row.interactive {
  cursor: pointer;
  transition: background-color var(--transition-fast, 150ms);
}
button.detail-row.interactive:hover {
  background: var(--el-fill-color-light);
}
button.detail-row.interactive:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.detail-icon {
  color: var(--el-text-color-tertiary);
  flex-shrink: 0;
}
.run-detail.warning .detail-icon,
.run-detail.warning .detail-label {
  color: var(--el-color-warning);
}
.run-detail.error .detail-icon,
.run-detail.error .detail-label {
  color: var(--el-color-danger);
}
.detail-label {
  flex-shrink: 0;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}
.detail-subject {
  flex-shrink: 0;
  max-width: 45%;
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  background: var(--el-fill-color);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-xs, 12px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-text {
  flex: 1;
  min-width: 0;
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}
.detail-subtext {
  margin: 2px 8px 0 29px;
  font-size: var(--text-xs, 12px);
  color: var(--el-text-color-tertiary);
  overflow-wrap: anywhere;
}
.chevron {
  flex-shrink: 0;
  color: var(--el-text-color-tertiary);
  transition: transform var(--transition-fast, 150ms);
}
.detail-row[aria-expanded="true"] > .chevron {
  transform: rotate(90deg);
}
.detail-body {
  margin: var(--spacing-xs) var(--spacing-sm) var(--spacing-sm) 29px;
}
.body-label {
  margin: var(--spacing-xs) 0;
  font-size: var(--text-xs, 11px);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--el-text-color-tertiary);
}
pre {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
