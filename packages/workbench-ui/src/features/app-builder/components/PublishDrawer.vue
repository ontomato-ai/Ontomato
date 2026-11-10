<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { CircleAlert, ExternalLink, ShieldCheck, Table2 } from "lucide-vue-next";
import type { HostedRelease } from "@ontomato/contracts/workspaces";
import { formatRelativeTime } from "../../../utils/relative-time";
import { builderApi } from "../api";
import { errorText, shortCommit } from "../panel";
import type { AppBuilderPlatform } from "../platform";
import { applicationName, catalogDeclaration, newDeclaration, publishable } from "../publication";
import type { LoadState, WorkspaceView } from "../workspace-view";

/**
 * Publishing the workspace as an application on the platform's rail, beside the page so the preview stays usable.
 *
 * It puts together facts that already have owners: the workbench's export records of the workspace (each commit is
 * exported once, as a release of the workspace's application) and Java's catalog, the one the rail draws, which alone
 * says which release the application opens now. A release is marked current only when it is that one; while the catalog
 * cannot be read, the failure shows and nothing is marked. Publishing exports a commit and makes it current; rolling
 * back makes an exported release current again. Neither touches the workspace's files or commits: going back to an old
 * commit is the history's, not this. After either, the catalog is read again and the rail follows.
 *
 * The first publication names the application, by default after the workspace; later ones keep the name it has in the
 * catalog. Where the edition manages permissions, it says who can open the application and leads to where an
 * administrator grants it; the open-source edition says nothing about access.
 */
const props = defineProps<{ view: WorkspaceView; platform: AppBuilderPlatform }>();
const open = defineModel<boolean>("open", { required: true });
const { t, locale } = useI18n();
const router = useRouter();
const { catalog, permissions } = props.platform;
const workspace = computed(() => props.view.workspace!);

/* ---- The workspace's releases and the application they belong to ---- */
const releases = ref<HostedRelease[]>([]);
const releasesState = ref<LoadState>("loading");
const releasesError = ref<string | null>(null);
let reads = 0;
async function loadReleases() {
  const read = ++reads;
  releasesState.value = "loading";
  try {
    const items = await builderApi.releases(workspace.value.id);
    if (read !== reads) return;
    releases.value = items;
    releasesState.value = "ready";
  } catch (error) {
    if (read !== reads) return;
    releasesError.value = errorText(error);
    releasesState.value = "error";
  }
}

const appId = computed(() => releases.value[0]?.appId ?? null);
const application = computed(() => (appId.value && catalog.applications.value.find((app) => app.id === appId.value)) || null);
/**
 * Where the application stands. Releases the catalog does not list are exports Java never took (a rejected first
 * publication), so the next publication names the application as a new one.
 */
const status = computed<"loading" | "failed" | "new" | "published">(() => {
  if (releasesState.value === "loading") return "loading";
  if (releasesState.value === "error") return "failed";
  if (!appId.value) return "new";
  if (catalog.loading.value) return "loading";
  if (catalog.error.value) return "failed";
  return application.value ? "published" : "new";
});
const failure = computed(() => (releasesState.value === "error" ? releasesError.value : catalog.error.value));
function retry() {
  if (releasesState.value === "error") void loadReleases();
  else void catalog.refresh();
}
/** The release the application opens now, by Java's catalog. */
const currentRelease = computed(() =>
  status.value === "published" ? releases.value.find((release) => release.releaseId === application.value!.releaseId) ?? null : null,
);
const appName = computed(() => (application.value ? applicationName(application.value, locale.value) : ""));

/* ---- What to publish ---- */
const commits = computed(() => props.view.commits.filter(publishable));
const commitOf = (id: string) => props.view.commits.find((commit) => commit.id === id);
const commit = ref<string | null>(null);
const name = ref("");
// The newest commit until the reader picks another, and the next newest when the picked one is gone.
watch(commits, (list) => {
  if (!list.some((item) => item.id === commit.value)) commit.value = list[0]?.id ?? null;
}, { immediate: true });
watch(open, (value) => {
  if (!value) return;
  name.value = workspace.value.name;
  commit.value = commits.value[0]?.id ?? null;
  void loadReleases();
}, { immediate: true });

/** Why the chosen commit cannot be published now; null when it can, or while the commits are still being read. */
const blocked = computed(() => {
  if (!commits.value.length) return props.view.commitsState === "ready" ? t("appBuilder.noPublishableCommit") : null;
  if (status.value === "new" && !name.value.trim()) return t("appBuilder.nameTheApp");
  if (currentRelease.value && currentRelease.value.commit === commit.value) return t("appBuilder.alreadyCurrent");
  return null;
});

const publishing = ref(false);
const rollingBack = ref<string | null>(null);
const canPublish = computed(() =>
  (status.value === "new" || status.value === "published") && commit.value !== null && !blocked.value && rollingBack.value === null,
);
async function publish() {
  const app = application.value;
  const declaration = app ? catalogDeclaration(app) : newDeclaration(name.value.trim());
  const exported = new Set(releases.value.map((release) => release.releaseId));
  publishing.value = true;
  try {
    const release = await builderApi.publish(workspace.value.id, commit.value!, declaration);
    await Promise.all([loadReleases(), catalog.refresh()]);
    const values = { name: declaration.names[locale.value] ?? declaration.names.en!, commit: shortCommit(release.commit) };
    if (!app) ElMessage.success(t("appBuilder.published", values));
    else ElMessage.success(t(exported.has(release.releaseId) ? "appBuilder.publishedAgain" : "appBuilder.publishedVersion", values));
  } catch (error) {
    ElMessage.error(errorText(error));
  } finally {
    publishing.value = false;
  }
}
async function rollback(release: HostedRelease) {
  const app = application.value!;
  const values = { name: appName.value, time: formatRelativeTime(release.createdAt), commit: shortCommit(release.commit) };
  try {
    await ElMessageBox.confirm(t("appBuilder.rollbackConfirm", values), t("appBuilder.rollbackTitle"), {
      confirmButtonText: t("appBuilder.rollbackAction"),
      cancelButtonText: t("common.cancel"),
    });
  } catch {
    return;
  }
  rollingBack.value = release.releaseId;
  try {
    await builderApi.rollback(workspace.value.id, release.releaseId, catalogDeclaration(app));
    await catalog.refresh();
    ElMessage.success(t("appBuilder.rolledBack", values));
  } catch (error) {
    ElMessage.error(errorText(error));
  } finally {
    rollingBack.value = null;
  }
}
</script>

<template>
  <el-drawer
    v-model="open"
    :title="t('appBuilder.publish')"
    size="min(440px, 100vw)"
    :modal="false"
    modal-penetrable
    append-to-body
    class="publish-drawer"
  >
    <div class="publish">
      <section class="section">
        <h3>{{ t("appBuilder.application") }}</h3>
        <div v-if="status === 'loading'" class="state" aria-busy="true">{{ t("assistant.loading") }}</div>
        <div v-else-if="status === 'failed'" class="failure" role="alert">
          <CircleAlert :size="16" aria-hidden="true" />
          <span>{{ failure }}</span>
          <el-button size="small" @click="retry">{{ t("common.retry") }}</el-button>
        </div>
        <template v-else-if="status === 'new'">
          <label class="field-label" for="publish-name">{{ t("appBuilder.appName") }}</label>
          <el-input id="publish-name" v-model="name" maxlength="200" :placeholder="t('appBuilder.appNamePlaceholder')" />
          <p class="help">{{ t("appBuilder.appNameHint") }}</p>
        </template>
        <div v-else class="app">
          <span class="app-icon"><Table2 :size="18" aria-hidden="true" /></span>
          <span class="app-text">
            <strong>{{ appName }}</strong>
            <span class="hash">{{ application!.id }}</span>
          </span>
        </div>
      </section>

      <section v-if="permissions" class="section access">
        <ShieldCheck :size="16" aria-hidden="true" />
        <div class="access-body">
          <p class="access-title">{{ t("appBuilder.whoCanOpen") }}</p>
          <p>{{ t("appBuilder.accessHint") }}</p>
          <a v-if="permissions.open" class="link" :href="router.resolve(permissions.path).href" target="_blank" rel="noopener">
            <span>{{ t("appBuilder.grantAccess") }}</span>
            <ExternalLink :size="13" aria-hidden="true" />
          </a>
          <p v-else>{{ t("appBuilder.askAdministrator") }}</p>
        </div>
      </section>

      <section class="section">
        <h3>{{ t(status === "published" ? "appBuilder.publishNewVersion" : "appBuilder.publishCommit") }}</h3>
        <div v-if="view.commitsState === 'error' && !commits.length" class="failure" role="alert">
          <CircleAlert :size="16" aria-hidden="true" />
          <span>{{ t("assistant.loadFailed") }}</span>
          <el-button size="small" @click="view.loadCommits()">{{ t("common.retry") }}</el-button>
        </div>
        <el-select
          v-else
          v-model="commit"
          class="commit-select"
          :placeholder="t('appBuilder.chooseCommit')"
          :aria-label="t('appBuilder.chooseCommit')"
          :loading="view.commitsState === 'loading'"
          :disabled="!commits.length"
        >
          <el-option v-for="item in commits" :key="item.id" :value="item.id" :label="`${shortCommit(item.id)} · ${item.message}`">
            <span class="option">
              <span class="hash">{{ shortCommit(item.id) }}</span>
              <span class="option-message">{{ item.message }}</span>
              <span v-if="item.id === currentRelease?.commit" class="pill">{{ t("appBuilder.currentRelease") }}</span>
              <span class="option-time">{{ formatRelativeTime(item.createdAt) }}</span>
            </span>
          </el-option>
        </el-select>
        <p class="help">{{ t("appBuilder.publishHint") }}</p>
        <div class="go">
          <span v-if="blocked" class="help">{{ blocked }}</span>
          <el-button type="primary" :loading="publishing" :disabled="!canPublish" @click="publish">
            {{ t(publishing ? "appBuilder.exporting" : "appBuilder.publish") }}
          </el-button>
        </div>
      </section>

      <section v-if="releases.length" class="section">
        <h3>{{ t("appBuilder.versions") }}</h3>
        <ol class="releases">
          <li v-for="release in releases" :key="release.releaseId" class="release" :class="{ current: release === currentRelease }">
            <span class="dot" aria-hidden="true" />
            <span class="release-main">
              <span class="release-time">{{ t("appBuilder.exportedAt", { time: formatRelativeTime(release.createdAt) }) }}</span>
              <span class="release-meta">
                <span class="hash">{{ shortCommit(release.commit) }}</span>
                <span v-if="commitOf(release.commit)">{{ commitOf(release.commit)!.message }}</span>
              </span>
            </span>
            <span v-if="release === currentRelease" class="pill">{{ t("appBuilder.current") }}</span>
            <el-button
              v-else-if="status === 'published'"
              size="small"
              :loading="rollingBack === release.releaseId"
              :disabled="rollingBack !== null || publishing"
              @click="rollback(release)"
            >
              {{ t("appBuilder.rollback") }}
            </el-button>
          </li>
        </ol>
        <p class="help">{{ t("appBuilder.rollbackHint") }}</p>
      </section>
    </div>
  </el-drawer>
</template>

<style scoped>
.publish {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}
.section h3 {
  margin: 0 0 var(--spacing-sm);
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  font-weight: var(--font-semibold);
}
.state {
  color: var(--el-text-color-secondary);
}
.failure {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
.failure svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.failure span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.field-label {
  display: block;
  margin-bottom: 6px;
  color: var(--el-text-color-primary);
  font-weight: var(--font-medium);
}
.help {
  margin: var(--spacing-sm) 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
.app {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
}
.app-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: var(--brand-primary-tint);
  color: var(--brand-link);
}
.app-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.app-text strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--font-semibold);
}
.hash {
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
.access {
  display: flex;
  gap: 10px;
  padding: var(--spacing-md);
  border-radius: var(--radius-md);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
}
.access > svg {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--el-text-color-secondary);
}
.access-body p {
  margin: 0 0 var(--spacing-sm);
}
.access-body .access-title {
  margin-bottom: 4px;
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
}
.link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--brand-link);
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.link:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
  border-radius: var(--radius-xs);
}
.commit-select {
  width: 100%;
}
.option {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
}
.option-message {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.option-time {
  flex-shrink: 0;
  color: var(--el-text-color-placeholder);
  font-size: var(--text-xs);
}
.go {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacing-md);
  margin-top: var(--spacing-md);
}
.go .help {
  margin: 0;
  text-align: right;
}
.pill {
  display: inline-flex;
  align-items: center;
  height: 18px;
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-xs);
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
  font-size: 11px;
  font-weight: var(--font-medium);
  white-space: nowrap;
}
.releases {
  margin: 0;
  padding: 0;
  list-style: none;
}
.release {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.release:first-child {
  border-top: 1px solid var(--el-border-color-lighter);
}
.dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--el-border-color-darker);
}
.release.current .dot {
  background: var(--el-color-success);
}
.release-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.release-time {
  color: var(--el-text-color-primary);
  font-weight: var(--font-medium);
}
.release-meta {
  display: flex;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  white-space: nowrap;
}
.release-meta > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
