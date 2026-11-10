<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useLocale } from "element-plus";
import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { python } from "@codemirror/lang-python";
import { search } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { placeholder as editorPlaceholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { useDarkMode } from "../theme";

/**
 * Edits code and structured text (CodeMirror 6): line numbers, folding, highlighting for its language and wrapping.
 * Read-only, it still takes the focus, selects and searches (Ctrl/Cmd-F). It follows the page's dark mode, and takes
 * its one word of text, the search field's prompt, from the Element Plus locale the host installs. A placeholder is
 * only shown, never content.
 */
const props = defineProps<{
  /** The text being edited; bind it with `v-model`. */
  modelValue: string;
  /** The language the text is highlighted as; JavaScript when not given. */
  language?: "javascript" | "json" | "markdown" | "html" | "python" | "text";
  /** Shown while the text is empty; it never becomes the text. */
  placeholder?: string;
  /** The editor's least height in pixels; 300 when not given. */
  minHeight?: number;
  /** The text can be selected, searched and copied, but not changed. */
  readonly?: boolean;
}>();

const emit = defineEmits<{
  /** The text after each change the reader makes. */
  "update:modelValue": [value: string];
}>();

const isDark = useDarkMode();
const { t } = useLocale();

const editorRef = ref<HTMLDivElement | null>(null);
let editor: EditorView | null = null;

const selectionSelector =
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, " +
  ".cm-selectionBackground, .cm-content ::selection";
const lightSelectionBackground = "var(--el-color-primary-light-8)";
const darkSelectionBackground = "var(--el-color-primary-light-8)";

const lightTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--el-fill-color-lighter)",
    },
    ".cm-content": {
      caretColor: "var(--el-text-color-primary)",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--el-text-color-primary)",
    },
    [selectionSelector]: {
      backgroundColor: lightSelectionBackground,
    },
    ".cm-activeLine": {
      backgroundColor: "var(--el-fill-color-light)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--el-fill-color-lighter)",
      color: "var(--el-text-color-secondary)",
      border: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--el-fill-color-light)",
    },
  },
  { dark: false }
);

const getLanguageExtension = () => {
  switch (props.language) {
    case "json":
      return json();
    case "html":
      return html();
    case "markdown":
      return markdown();
    case "javascript":
      return javascript();
    case "python":
      return python();
    case "text":
      return [];
    default:
      return javascript();
  }
};

const readonlyThemeLight = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--el-fill-color-lighter)",
    },
    ".cm-content": {
      caretColor: "transparent",
    },
    ".cm-cursor": {
      display: "none",
    },
    [selectionSelector]: {
      backgroundColor: lightSelectionBackground,
    },
    ".cm-activeLine": {
      backgroundColor: "transparent",
    },
    ".cm-gutters": {
      backgroundColor: "var(--el-fill-color-lighter)",
      color: "var(--el-text-color-secondary)",
      border: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
    },
  },
  { dark: false }
);

const readonlyThemeDark = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--el-bg-color)",
    },
    ".cm-content": {
      caretColor: "transparent",
    },
    ".cm-cursor": {
      display: "none",
    },
    [selectionSelector]: {
      backgroundColor: darkSelectionBackground,
    },
    ".cm-activeLine": {
      backgroundColor: "transparent",
    },
    ".cm-gutters": {
      backgroundColor: "var(--el-bg-color)",
      color: "var(--el-text-color-secondary)",
      border: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
    },
  },
  { dark: true }
);

const createEditor = () => {
  if (!editorRef.value) return;

  const extensions = [
    basicSetup,
    editorPlaceholder(props.placeholder ?? ""),
    getLanguageExtension(),
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
  ];

  if (props.readonly) {
    // Content that is not editable takes no focus by itself, and the search keys only reach a focused editor.
    extensions.push(EditorView.contentAttributes.of({ tabindex: "0" }));
    extensions.push(search({ top: true }));
    extensions.push(EditorState.phrases.of({ Find: t("el.transfer.filterPlaceholder") }));
    extensions.push(EditorView.editable.of(false));
    extensions.push(EditorState.readOnly.of(true));
    if (isDark.value) {
      extensions.push(oneDark, readonlyThemeDark);
    } else {
      extensions.push(readonlyThemeLight);
    }
  } else {
    extensions.push(isDark.value ? oneDark : lightTheme);
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit("update:modelValue", update.state.doc.toString());
        }
      })
    );
  }

  const doc = props.modelValue;

  editor = new EditorView({
    doc,
    extensions,
    parent: editorRef.value,
  });
};

const destroyEditor = () => {
  if (editor) {
    editor.destroy();
    editor = null;
  }
};

const recreateEditor = () => {
  destroyEditor();
  createEditor();
};

watch(
  () => props.modelValue,
  (newValue) => {
    if (editor && newValue !== editor.state.doc.toString()) {
      editor.dispatch({
        changes: {
          from: 0,
          to: editor.state.doc.length,
          insert: newValue,
        },
      });
    }
  }
);

// The extensions are fixed when the editor is made, so a new theme, mode, language or placeholder makes a new editor.
watch([isDark, () => props.readonly, () => props.language, () => props.placeholder], () => {
  recreateEditor();
});

onMounted(() => {
  createEditor();
});

onUnmounted(() => {
  destroyEditor();
});
</script>

<template>
  <div
    ref="editorRef"
    class="code-editor"
    :class="{ 'readonly-mode': readonly }"
    :style="{ minHeight: `${minHeight || 300}px` }"
  />
</template>

<style scoped>
.code-editor {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  overflow: hidden;
  font-family: var(--font-mono);
  background: var(--el-fill-color-lighter);
}

.code-editor.readonly-mode {
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
}

.code-editor :deep(.cm-editor) {
  height: 100%;
  outline: none;
  color: var(--el-text-color-primary);
}

.code-editor :deep(.cm-scroller) {
  overflow: auto;
}

.code-editor :deep(.cm-content) {
  padding: 8px 0;
}

.code-editor :deep(.cm-line) {
  padding: 0 8px;
}

.code-editor.readonly-mode :deep(.cm-editor) {
  font-size: 12px;
}

.code-editor.readonly-mode :deep(.cm-scroller) {
  font-family: var(--font-mono);
  line-height: 1.65;
}

.code-editor.readonly-mode :deep(.cm-content) {
  padding: 12px 0;
}

.code-editor.readonly-mode :deep(.cm-line) {
  padding: 0 12px;
}

.code-editor.readonly-mode :deep(.cm-gutters) {
  border-right: 1px solid var(--el-border-color-lighter);
}

.code-editor.readonly-mode :deep(.cm-lineNumbers .cm-gutterElement) {
  padding: 0 8px 0 10px;
  min-width: 34px;
}

.code-editor :deep(.cm-foldGutter span) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 4px;
  color: var(--el-text-color-secondary);
  font-family: var(--el-font-family, sans-serif);
  font-size: 17px;
  font-weight: 500;
  line-height: 1;
  transition:
    color 160ms ease,
    background-color 160ms ease;
}

.code-editor :deep(.cm-foldGutter span:hover) {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.code-editor.readonly-mode :deep(.cm-panels-top:has(.cm-search)) {
  position: absolute;
  top: 8px !important;
  right: 8px;
  left: auto;
  width: min(520px, calc(100% - 16px));
  border: 0;
  background: transparent;
  color: var(--el-text-color-primary);
  z-index: 50;
}

.code-editor.readonly-mode :deep(.cm-panel.cm-search) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  width: 100%;
  padding: 6px 36px 6px 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);
  font-family: var(--el-font-family, sans-serif);
}

.code-editor.readonly-mode :deep(.cm-search input[name="search"]) {
  flex: 1 1 160px;
  min-width: 120px;
  height: 28px;
  box-sizing: border-box;
  margin: 0;
  padding: 0 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  outline: none;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-primary);
  font: inherit;
}

.code-editor.readonly-mode :deep(.cm-search input[name="search"]:focus) {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
}

.code-editor.readonly-mode :deep(.cm-search .cm-button) {
  height: 28px;
  min-width: 28px;
  box-sizing: border-box;
  margin: 0;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  background-image: none;
  color: var(--el-text-color-regular);
  box-shadow: none;
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background-color 160ms ease;
}

.code-editor.readonly-mode :deep(.cm-search .cm-button:hover),
.code-editor.readonly-mode :deep(.cm-search label:hover),
.code-editor.readonly-mode :deep(.cm-search button[name="close"]:hover) {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.code-editor.readonly-mode :deep(.cm-search .cm-button:focus-visible),
.code-editor.readonly-mode :deep(.cm-search button[name="close"]:focus-visible),
.code-editor.readonly-mode :deep(.cm-search label:has(input:focus-visible)) {
  outline: 2px solid var(--el-color-primary-light-5);
  outline-offset: 1px;
}

.code-editor.readonly-mode :deep(.cm-search button[name="next"]),
.code-editor.readonly-mode :deep(.cm-search button[name="prev"]) {
  width: 28px;
  padding: 0;
  border-color: var(--el-border-color-lighter);
  font-size: 0;
}

.code-editor.readonly-mode :deep(.cm-search button[name="next"]::before),
.code-editor.readonly-mode :deep(.cm-search button[name="prev"]::before) {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
}

.code-editor.readonly-mode :deep(.cm-search button[name="next"]::before) {
  transform: translateY(-2px) rotate(45deg);
}

.code-editor.readonly-mode :deep(.cm-search button[name="prev"]::before) {
  transform: translateY(2px) rotate(225deg);
}

.code-editor.readonly-mode :deep(.cm-search label) {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  box-sizing: border-box;
  margin: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--el-text-color-regular);
  font-size: 0;
  cursor: pointer;
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background-color 160ms ease;
}

.code-editor.readonly-mode :deep(.cm-search label::after) {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1;
}

.code-editor.readonly-mode :deep(.cm-search label:has(input[name="case"])::after) {
  content: "Aa";
}

.code-editor.readonly-mode :deep(.cm-search label:has(input[name="re"])::after) {
  content: ".*";
}

.code-editor.readonly-mode :deep(.cm-search label:has(input[name="word"])::after) {
  content: "ab";
  text-decoration: underline;
  text-underline-offset: 2px;
}

.code-editor.readonly-mode :deep(.cm-search label:has(input:checked)) {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.code-editor.readonly-mode :deep(.cm-search input[type="checkbox"]) {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.code-editor.readonly-mode :deep(.cm-search button[name="close"]) {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition:
    color 160ms ease,
    background-color 160ms ease;
}
</style>
