<script setup lang="ts">
import { computed, ref } from "vue";
import CodeMirrorEditor from "../../../components/CodeMirrorEditor.vue";


interface SearchableEditor {
  openSearch: () => void;
}


const props = defineProps<{
  content: string;
  filename: string;
  filePath?: string;
  truncated?: boolean;
}>();

const editorRef = ref<SearchableEditor | null>(null);

const ext = computed(() => {
  const dot = props.filename.lastIndexOf(".");
  return dot >= 0 ? props.filename.slice(dot + 1).toLowerCase() : "";
});

const mode = computed(() => {
  const e = ext.value;
  if (e === "json" || e === "jsonl") return "json";
  if (e === "csv" || e === "tsv") return "csv";
  if (e === "md" || e === "markdown") return "markdown";
  if (e === "log") return "text";
  return "text";
});

/* ---- JSON ---- */
const formattedJson = computed(() => {
  if (mode.value !== "json") return "";
  try {
    if (ext.value === "jsonl") {
      return props.content
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.stringify(JSON.parse(l), null, 2))
        .join("\n---\n");
    }
    return JSON.stringify(JSON.parse(props.content), null, 2);
  } catch {
    return props.content;
  }
});

const editorContent = computed(() => (mode.value === "json" ? formattedJson.value : props.content));

const editorLanguage = computed<"json" | "markdown" | "text">(() => {
  if (mode.value === "json") return "json";
  if (mode.value === "markdown") return "markdown";
  return "text";
});

/* ---- CSV ---- */
const csvRows = computed(() => {
  if (mode.value !== "csv") return [];
  const sep = ext.value === "tsv" ? "\t" : ",";
  return props.content
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => parseCsvLine(line, sep));
});

function parseCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function openSearch() { editorRef.value?.openSearch(); }
defineExpose({ openSearch });
</script>

<template>
  <div class="fp-root">
    <!-- CSV Table -->
    <div v-if="mode === 'csv'" class="fp-table-wrap">
      <table class="fp-table">
        <thead v-if="csvRows.length > 0">
          <tr>
            <th v-for="(cell, ci) in csvRows[0]" :key="ci">{{ cell }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in csvRows.slice(1)" :key="ri">
            <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Text-backed formats -->
    <div v-else class="fp-editor-wrap">
      <CodeMirrorEditor
        ref="editorRef"
        :model-value="editorContent"
        :language="editorLanguage"
        :readonly="true"
        :min-height="100"
      />
    </div>
  </div>
</template>

<style scoped>
.fp-root {
  width: 100%;
  height: 100%;
  overflow: auto;
}

.fp-prompt-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.fp-prompt-notice {
  flex: 0 0 auto;
  padding: 7px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
  font-size: 12px;
  line-height: 1.5;
}

.fp-reading-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  background: var(--observe-bg-main, var(--el-fill-color-extra-light));
}

/* Editor wrap for CodeMirror readonly preview */
.fp-editor-wrap {
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
}

.fp-editor-wrap :deep(.codemirror-editor) {
  height: 100%;
  min-height: 100px;
}

.fp-prompt-wrap :deep(.codemirror-editor) {
  flex: 1 1 auto;
  min-height: 0;
}

.fp-editor-wrap :deep(.cm-editor) {
  height: 100% !important;
}

/* CSV table */
.fp-table-wrap {
  overflow: auto;
  max-height: 100%;
}

.fp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.fp-table th,
.fp-table td {
  padding: 6px 10px;
  border: 1px solid var(--el-border-color-lighter);
  text-align: left;
  white-space: nowrap;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fp-table th {
  background: var(--el-fill-color);
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}

.fp-table tbody tr:hover {
  background: var(--el-fill-color-lighter);
}
</style>
