<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { ElMessage } from "element-plus";
import { Download, ImagePlus, LayoutDashboard, Loader2, Presentation } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { reportCoverImage, reportCoverMaxBytes, reportCoverPathSchema } from "@ontomato/contracts/report-cover";
import { ApiRequestError, nodeApiFetch, nodeApiPost } from "../../../utils/api";

const props = defineProps<{
  artifact: RuntimeArtifact;
  title: string;
  canGeneratePpt: boolean;
  requestPpt: (sessionId: string, message: string) => Promise<void>;
}>();
const emit = defineEmits<{ openDashboard: [id: string] }>();
const { t, locale } = useI18n();
const text = computed(() => locale.value === "zh-CN" ? {
  download: "下载报告", ppt: "生成 PPT", dashboard: "生成仪表盘", prompt: "自定义提示词",
  promptPlaceholder: "例如：面向管理层，突出关键变化和下一步建议",
  defaultPrompt: "请把分析报告提炼成面向管理层的汇报。保留可验证的结论、关键数字、趋势、异常和行动建议，不补造数据。每页只讲一个观点，使用结论式标题，给出一条核心结论和最多四条要点。有对应图表时优先展示图表，保留证据与适用范围。建议正文 5–9 页，按执行摘要、关键指标与趋势、重点发现、风险和行动建议组织。",
  resetPrompt: "恢复默认", coverImage: "封面图片", chooseImage: "上传图片", replaceImage: "更换图片", removeImage: "移除",
  imageHint: "支持 PNG、JPG，最大 5 MB。", invalidImage: "请选择可打开的 PNG 或 JPG 图片，最大 5 MB、2500 万像素。",
  cover: "添加封面", coverTitle: "封面标题", subtitle: "封面副标题", style: "封面样式",
  business: "商务深色", minimal: "简约浅色", dashboardName: "仪表盘名称",
  noSources: "该报告没有可用于生成仪表盘的图表或数据集。",
} : locale.value === "zh-TW" ? {
  download: "下載報告", ppt: "產生 PPT", dashboard: "產生儀表板", prompt: "自訂提示詞",
  promptPlaceholder: "例如：面向管理層，強調關鍵變化與下一步建議",
  defaultPrompt: "請將分析報告濃縮成面向管理層的簡報。保留可驗證的結論、關鍵數字、趨勢、異常和行動建議，不編造資料。每頁只講一個觀點，使用結論式標題，提供一條核心結論和最多四條重點。有對應圖表時優先展示圖表，保留證據與適用範圍。建議正文 5–9 頁，按執行摘要、關鍵指標與趨勢、重點發現、風險和行動建議組織。",
  resetPrompt: "恢復預設", coverImage: "封面圖片", chooseImage: "上傳圖片", replaceImage: "更換圖片", removeImage: "移除",
  imageHint: "支援 PNG、JPG，最大 5 MB。", invalidImage: "請選擇可開啟的 PNG 或 JPG 圖片，最大 5 MB、2500 萬像素。",
  cover: "加入封面", coverTitle: "封面標題", subtitle: "封面副標題", style: "封面樣式",
  business: "商務深色", minimal: "簡約淺色", dashboardName: "儀表板名稱",
  noSources: "此報告沒有可用於產生儀表板的圖表或資料集。",
} : {
  download: "Download report", ppt: "Generate PPT", dashboard: "Generate dashboard", prompt: "Custom instructions",
  promptPlaceholder: "For example, focus on key changes and recommendations for management",
  defaultPrompt: "Turn the report into a management presentation. Keep verifiable conclusions, key figures, trends, anomalies, and recommended actions. Do not invent data. Give each slide one point, a conclusion-led title, one takeaway, and up to four bullets. Use charts where available and keep their evidence and scope. Aim for 5–9 slides excluding the cover, ordered as executive summary, key metrics and trends, findings, risks, and recommended actions.",
  resetPrompt: "Restore default", coverImage: "Cover image", chooseImage: "Upload image", replaceImage: "Replace image", removeImage: "Remove",
  imageHint: "PNG or JPG, up to 5 MB.", invalidImage: "Choose a valid PNG or JPG under 5 MB and 25 megapixels.",
  cover: "Include a cover", coverTitle: "Cover title", subtitle: "Cover subtitle", style: "Cover style",
  business: "Business dark", minimal: "Minimal light", dashboardName: "Dashboard name",
  noSources: "This report has no charts or datasets to use in a dashboard.",
});

const modal = ref<"ppt" | "dashboard" | null>(null);
const busy = ref<"pdf" | "ppt" | "dashboard" | null>(null);
const options = ref({ instructions: text.value.defaultPrompt, includeCover: true, title: "", subtitle: "", style: "business" });
const toolbar = ref<HTMLElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);
const coverImage = ref<{ file: File; preview: string } | null>(null);
const checkingImage = ref(false);
let draftActive = true;
onBeforeUnmount(() => {
  draftActive = false;
  removeImage();
});
const dashboardName = ref("");
const reportTitle = computed(() => {
  const fileName = props.artifact.path.split("/").at(-1) ?? "";
  return props.title.trim().replace(/\.md$/i, "") || fileName.replace(/\.md$/i, "") || text.value.download;
});
const endpoint = computed(() => `/assistant/sessions/${props.artifact.sessionId}/artifacts/${props.artifact.id}/report`);
const dialogOpen = computed({
  get: () => modal.value !== null,
  set: (open: boolean) => { if (!open) modal.value = null; },
});

function showPpt() {
  options.value.title ||= reportTitle.value.slice(0, 120);
  modal.value = "ppt";
}

function removeImage() {
  if (coverImage.value) URL.revokeObjectURL(coverImage.value.preview);
  coverImage.value = null;
}

async function pickImage(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || checkingImage.value) return;
  checkingImage.value = true;
  let preview: string | undefined;
  try {
    if (file.size > reportCoverMaxBytes) throw new Error();
    const format = reportCoverImage(new Uint8Array(await file.arrayBuffer()));
    if (!format) throw new Error();
    preview = URL.createObjectURL(file.slice(0, file.size, format.extension === "jpg" ? "image/jpeg" : "image/png"));
    const image = new Image();
    image.src = preview;
    await image.decode();
    if (!draftActive) return;
    removeImage();
    coverImage.value = { file, preview };
    preview = undefined;
  } catch {
    if (draftActive) ElMessage.error(text.value.invalidImage);
  } finally {
    if (preview) URL.revokeObjectURL(preview);
    checkingImage.value = false;
  }
}

function imageBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function showDashboard() {
  dashboardName.value = reportTitle.value.slice(0, 50);
  modal.value = "dashboard";
}

function failed(error: unknown) {
  if (error instanceof ApiRequestError && error.code === "REPORT_NO_DASHBOARD_SOURCES") {
    ElMessage.warning(text.value.noSources);
    return;
  }
  ElMessage.error(error instanceof Error ? error.message : t("common.requestFailed"));
}

async function download() {
  if (busy.value) return;
  busy.value = "pdf";
  try {
    const response = await nodeApiFetch(`${endpoint.value}/pdf`, "GET");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `${reportTitle.value.replace(/[\\/:*?"<>|]/g, "_")}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    failed(error);
  } finally {
    busy.value = null;
  }
}

async function submitPpt() {
  if (busy.value || checkingImage.value || !props.canGeneratePpt) return;
  busy.value = "ppt";
  const { instructions, includeCover, title, subtitle, style } = options.value;
  const source = JSON.stringify({ path: props.artifact.path, runId: props.artifact.runId });
  try {
    const accent = toolbar.value && getComputedStyle(toolbar.value).getPropertyValue("--report-ppt-accent").trim();
    const file = includeCover ? coverImage.value?.file : undefined;
    const image = file ? reportCoverPathSchema.parse((await nodeApiPost(`${endpoint.value}/cover`, { image: await imageBase64(file) })).path) : undefined;
    if (!draftActive) return;
    const cover = includeCover ? {
      title: title.trim() || reportTitle.value.slice(0, 120), subtitle: subtitle.trim(), style, image,
      accent: accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent : undefined,
    } : false;
    const settings = JSON.stringify({ cover, instructions: instructions.trim() });
    await props.requestPpt(props.artifact.sessionId, locale.value.startsWith("zh")
      ? `请使用报告技能将当前会话的源报告 ${source} 转为 PPT。按照以下选项编排内容，将 cover 的值原样写入渲染计划的 cover 字段，并在回复中提供生成的 .pptx 文件链接。选项：${settings}`
      : `Use the report skill to create a PPT from this conversation's source report ${source}. Apply these options, copy the cover value verbatim into the render plan's cover field, and link the resulting .pptx in your reply. Options: ${settings}`);
    modal.value = null;
  } catch (error) {
    failed(error);
  } finally {
    busy.value = null;
  }
}

async function submitDashboard() {
  const name = dashboardName.value.trim();
  if (busy.value || !name) return;
  busy.value = "dashboard";
  try {
    const board = await nodeApiPost(`${endpoint.value}/dashboard`, { name });
    if (!board?.id) throw new Error(t("common.requestFailed"));
    modal.value = null;
    emit("openDashboard", board.id);
  } catch (error) {
    failed(error);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div ref="toolbar" class="report-actions">
    <button type="button" :disabled="Boolean(busy)" :title="text.download" :aria-label="text.download" @click="download">
      <Loader2 v-if="busy === 'pdf'" :size="14" class="report-spinner" aria-hidden="true" />
      <Download v-else :size="14" aria-hidden="true" />
      <span>{{ text.download }}</span>
    </button>
    <button type="button" :disabled="Boolean(busy)" :title="text.dashboard" :aria-label="text.dashboard" @click="showDashboard">
      <LayoutDashboard :size="14" aria-hidden="true" />
      <span>{{ text.dashboard }}</span>
    </button>
    <button type="button" :disabled="Boolean(busy) || !canGeneratePpt" :title="text.ppt" :aria-label="text.ppt" @click="showPpt">
      <Presentation :size="14" aria-hidden="true" />
      <span>{{ text.ppt }}</span>
    </button>
  </div>
  <el-dialog
    v-model="dialogOpen" append-to-body width="min(480px, calc(100vw - 24px))"
    :title="modal === 'dashboard' ? text.dashboard : text.ppt"
    :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy"
  >
    <el-form v-if="modal === 'ppt'" label-position="top" :disabled="Boolean(busy)" @submit.prevent="submitPpt">
      <el-form-item>
        <template #label>
          <span class="report-prompt-label">
            {{ text.prompt }}
            <el-button type="primary" link :disabled="options.instructions === text.defaultPrompt" @click="options.instructions = text.defaultPrompt">{{ text.resetPrompt }}</el-button>
          </span>
        </template>
        <el-input v-model="options.instructions" :aria-label="text.prompt" type="textarea" :rows="5" maxlength="2000" show-word-limit :placeholder="text.promptPlaceholder" />
      </el-form-item>
      <el-checkbox v-model="options.includeCover" class="report-cover-toggle">{{ text.cover }}</el-checkbox>
      <template v-if="options.includeCover">
        <el-form-item :label="text.coverTitle">
          <el-input v-model="options.title" maxlength="120" />
        </el-form-item>
        <el-form-item :label="text.subtitle">
          <el-input v-model="options.subtitle" maxlength="160" />
        </el-form-item>
        <el-form-item :label="text.style">
          <el-select v-model="options.style" :teleported="false">
            <el-option :label="text.business" value="business" />
            <el-option :label="text.minimal" value="minimal" />
          </el-select>
        </el-form-item>
        <el-form-item :label="text.coverImage">
          <div class="report-image-control">
            <input ref="imageInput" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" hidden @change="pickImage" />
            <div v-if="coverImage" class="report-image-preview">
              <img :src="coverImage.preview" :alt="text.coverImage" />
              <span :title="coverImage.file.name">{{ coverImage.file.name }}</span>
            </div>
            <div class="report-image-buttons">
              <el-button type="primary" plain :loading="checkingImage" @click="imageInput?.click()">
                <ImagePlus :size="14" aria-hidden="true" />
                <span>{{ coverImage ? text.replaceImage : text.chooseImage }}</span>
              </el-button>
              <el-button v-if="coverImage" link :disabled="checkingImage" @click="removeImage">{{ text.removeImage }}</el-button>
              <span v-else class="report-image-hint">{{ text.imageHint }}</span>
            </div>
          </div>
        </el-form-item>
      </template>
    </el-form>
    <el-form v-else-if="modal === 'dashboard'" label-position="top" :disabled="Boolean(busy)" @submit.prevent="submitDashboard">
      <el-form-item :label="text.dashboardName">
        <el-input v-model="dashboardName" maxlength="50" show-word-limit />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="Boolean(busy)" @click="modal = null">{{ t("common.cancel") }}</el-button>
      <el-button v-if="modal === 'dashboard'" type="primary" :loading="busy === 'dashboard'" :disabled="!dashboardName.trim()" @click="submitDashboard">{{ text.dashboard }}</el-button>
      <el-button v-else type="primary" :loading="busy === 'ppt'" :disabled="!canGeneratePpt || checkingImage" @click="submitPpt">{{ text.ppt }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.report-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.report-actions button {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 6px 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 14px;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.report-actions button:hover, .report-actions button:focus-visible {
  border-color: var(--el-color-primary);
  background: var(--el-bg-color);
  color: var(--el-color-primary);
}
.report-actions button:disabled { opacity: .55; cursor: default; }
.report-cover-toggle { margin-bottom: 12px; }
.report-prompt-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.report-image-control { display: grid; gap: 8px; width: 100%; min-width: 0; }
.report-image-buttons, .report-image-preview { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.report-image-preview { flex-wrap: nowrap; padding: 6px; border: 1px solid var(--el-border-color); border-radius: var(--radius-sm); }
.report-image-preview img { width: 68px; height: 42px; object-fit: contain; border-radius: 4px; background: var(--el-fill-color); }
.report-image-preview span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.report-image-buttons svg { margin-inline-end: 5px; }
.report-image-buttons .el-button + .el-button { margin-left: 0; }
.report-image-hint { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.4; }
.report-spinner { animation: report-spin 1s linear infinite; }
@keyframes report-spin { to { transform: rotate(360deg); } }
@container artifact-header (max-width: 520px) {
  .report-actions { gap: 3px; }
  .report-actions button { gap: 4px; padding: 4px 8px; font-size: 12px; }
}
</style>
