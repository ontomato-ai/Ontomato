<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { TreeInstance } from "element-plus";
import { useI18n } from "vue-i18n";
import { ArrowLeft, Download, FileCode, Folder, FolderOpen, Trash2 } from "lucide-vue-next";
import type { SkillFile, SkillInfo } from "@ontomato/contracts/skills";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { CodeEditor } from "@ontomato/foundation-ui/code";
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import { skillsApi } from "../api";
import { deleteSkill, exportSkill } from "../actions";

/**
 * One skill, read as its package: the package's folders and files as a tree on the left, the chosen file on the right. Markdown is drawn with its
 * frontmatter shown as written above it; every other file is text in the read-only code view (packages are UTF-8
 * throughout). The page only reads: a package changes by importing it again, and a built-in one cannot be deleted.
 */
const props = defineProps<{ skillId: string }>();
const { t, locale } = useI18n();
const router = useRouter();

const LANGUAGES: Record<string, "html" | "javascript" | "json" | "markdown" | "python" | "text"> = {
  html: "html", htm: "html", svg: "html", xml: "html",
  js: "javascript", mjs: "javascript", cjs: "javascript", ts: "javascript",
  json: "json", md: "markdown", py: "python",
};
const languageOf = (path: string) => LANGUAGES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "text";

interface TreeNode { key: string; label: string; file: boolean; children?: TreeNode[] }

const skill = ref<SkillInfo | null>(null);
const files = ref<SkillFile[]>([]);
const file = ref<string | null>(null);
const content = ref<string | null>(null);
const loadFailed = ref(false);
const readFailed = ref(false);

async function load() {
  loadFailed.value = false;
  try {
    const [response, list] = await Promise.all([skillsApi.fetchSkills(), skillsApi.listFiles(props.skillId)]);
    skill.value = (response.skills as SkillInfo[]).find((item) => item.id === props.skillId) ?? null;
    files.value = list;
    // A read again (another language, for one) keeps the file being read; a new skill opens at its SKILL.md.
    const kept = list.some((item) => item.path === file.value) ? file.value : null;
    file.value = kept ?? (list.some((item) => item.path === "SKILL.md") ? "SKILL.md" : (list[0]?.path ?? null));
  } catch {
    loadFailed.value = true;
  }
}
watch(() => props.skillId, () => { file.value = null; });
watch([() => props.skillId, locale], load, { immediate: true });

/** The package's paths as folders and files: folders first, then files, each in name order. */
const tree = computed<TreeNode[]>(() => {
  const root: TreeNode[] = [];
  for (const { path } of files.value) {
    const parts = path.split("/");
    let level = root;
    parts.forEach((label, index) => {
      const key = parts.slice(0, index + 1).join("/");
      const file = index === parts.length - 1;
      let node = level.find((item) => item.key === key);
      if (!node) {
        node = file ? { key, label, file } : { key, label, file, children: [] };
        level.push(node);
      }
      if (!file) level = node.children!;
    });
  }
  const order = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(a.file) - Number(b.file) || (a.label < b.label ? -1 : 1));
    for (const node of nodes) if (node.children) order(node.children);
  };
  order(root);
  return root;
});
const treeRef = ref<TreeInstance | null>(null);
/** A file opens; a folder only folds. */
function pick(node: TreeNode) {
  if (node.file) file.value = node.key;
}
// The open file is the tree's current row, also when the page chose it.
watch(file, async (key) => {
  await nextTick();
  treeRef.value?.setCurrentKey(key ?? undefined);
});

let reads = 0;
async function read() {
  const path = file.value;
  const attempt = ++reads;
  content.value = null;
  readFailed.value = false;
  if (!path) return;
  try {
    const text = await skillsApi.readFile(props.skillId, path);
    if (attempt === reads) content.value = text;
  } catch {
    if (attempt === reads) readFailed.value = true;
  }
}
watch([file, locale], read);

/** A Markdown file's frontmatter, as written, and the body drawn under it. */
const markdown = computed(() => {
  if (content.value === null) return null;
  const sections = content.value.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  return sections ? { frontmatter: sections[1]!, body: sections[2]! } : { frontmatter: null, body: content.value };
});

function back() {
  void router.push({ name: platformRoutes.ontologySkills.name });
}

async function remove() {
  if (await deleteSkill(props.skillId, t)) back();
}
</script>

<template>
  <div class="skill-detail platform-page">
    <!-- The way back leads the bar, as in the object detail; the skill's own actions close it. -->
    <header class="detail-titlebar platform-page-gutter">
      <el-button text :icon="ArrowLeft" @click="back">{{ t("capabilities.backToSkills") }}</el-button>
      <span class="title-divider" aria-hidden="true"></span>
      <h1 class="title-name">{{ skill ? skill.title || skill.id : skillId }}</h1>
      <el-tag v-if="skill" size="small" :type="skill.isPublic ? 'info' : 'primary'" effect="plain" disable-transitions>
        {{ skill.isPublic ? t("capabilities.sourcePublic") : t("capabilities.sourceDomain") }}
      </el-tag>
      <span v-if="skill?.description" class="title-description">{{ skill.description }}</span>
      <span class="title-spacer"></span>
      <el-button :icon="Download" @click="exportSkill(skillId)">{{ t("common.export") }}</el-button>
      <el-button v-if="skill && !skill.isPublic" type="danger" plain :icon="Trash2" @click="remove">
        {{ t("common.delete") }}
      </el-button>
    </header>
    <div class="detail-body platform-page-gutter">
      <el-alert v-if="loadFailed" type="error" :closable="false" show-icon :title="t('capabilities.loadFailed')">
        <el-button text @click="load">{{ t("common.retry") }}</el-button>
      </el-alert>
      <div v-else class="package">
        <el-tree
          ref="treeRef"
          class="tree"
          :aria-label="t('capabilities.files')"
          :data="tree"
          node-key="key"
          default-expand-all
          highlight-current
          :expand-on-click-node="true"
          @node-click="pick"
        >
          <template #default="{ node, data }">
            <span class="tree-node">
              <component :is="data.file ? FileCode : node.expanded ? FolderOpen : Folder" :size="14" aria-hidden="true" />
              <span class="tree-name">{{ data.label }}</span>
            </span>
          </template>
        </el-tree>
        <!-- The tree's highlighted row names the open file; the content needs no second title. -->
        <div class="viewer">
          <div v-if="readFailed" class="viewer-state" role="alert">
            {{ t("capabilities.fileLoadFailed") }}
            <el-button size="small" @click="read">{{ t("common.retry") }}</el-button>
          </div>
          <template v-else-if="file && content !== null">
            <div v-if="languageOf(file) === 'markdown' && markdown" class="markdown">
              <pre v-if="markdown.frontmatter" class="frontmatter">{{ markdown.frontmatter }}</pre>
              <MarkdownView :content="markdown.body" />
            </div>
            <div v-else class="code">
              <CodeEditor :key="file" :model-value="content" :language="languageOf(file)" readonly :min-height="120" />
            </div>
          </template>
          <div v-else-if="file" class="viewer-state" aria-busy="true">{{ t("assistant.loading") }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skill-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
}
.detail-titlebar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-sm);
  min-height: var(--page-header-height);
  padding-block: var(--spacing-sm);
  box-sizing: border-box;
  border-bottom: 1px solid var(--el-border-color);
}
.detail-titlebar :deep(.el-button) {
  margin: 0;
}
.title-divider {
  width: 1px;
  height: 22px;
  margin: 0 var(--spacing-xs);
  background: var(--el-border-color);
}
.title-name {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-primary);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
}
.title-description {
  flex: 1 1 200px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.title-spacer {
  flex: 1 0 0;
}
.detail-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding-block: var(--page-content-gap) var(--spacing-xl);
}
/* The tree and the open file sit together as one block of the page, with a hairline between them. */
.package {
  display: flex;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.tree {
  flex: 0 0 240px;
  padding: var(--spacing-sm);
  overflow: auto;
  border-right: 1px solid var(--el-border-color-lighter);
  background: transparent;
  --el-tree-node-content-height: 30px;
  --el-tree-node-hover-bg-color: var(--el-fill-color-light);
}
.tree :deep(.el-tree-node__content) {
  border-radius: var(--radius-sm);
}
.tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--el-text-color-regular);
  font-size: var(--text-xs);
}
.tree-node svg {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.tree-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}
.viewer {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.markdown {
  padding: var(--spacing-md) var(--spacing-lg);
}
.frontmatter {
  margin: 0 0 var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.code {
  flex: 1;
  min-height: 0;
  padding: var(--spacing-md);
}
.code :deep(.code-editor),
.code :deep(.cm-editor) {
  height: 100%;
}
.viewer-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: auto;
  padding: var(--spacing-xl);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  text-align: center;
}
@container page (max-width: 640px) {
  .package {
    flex-direction: column;
  }
  .tree {
    flex: 0 0 auto;
    max-height: 160px;
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }
}
</style>
