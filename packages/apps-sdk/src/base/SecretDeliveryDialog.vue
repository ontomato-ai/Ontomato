<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElDialog } from "element-plus/es/components/dialog/index";
import { ElInput } from "element-plus/es/components/input/index";
import { ElMessageBox } from "element-plus/es/components/message-box/index";
import type { PanelSecretDelivery } from "@ontomato/contracts/panel-agent";
import { usePanelContext } from "../panel/context";

const panel = (() => {
  try {
    return usePanelContext();
  } catch {
    return null;
  }
})();
const props = defineProps<{ deliveries: readonly PanelSecretDelivery[] }>();
const emit = defineEmits<{ close: [] }>();
const { t, te } = useI18n();
const dialogId = useId();
const copied = ref<string | null>(null);
const downloaded = ref<Set<number>>(new Set());

function label(key: string, fallback: string, params?: Record<string, unknown>) {
  if (te(key)) return params ? t(key, params) : t(key);
  if (!params) return fallback;
  return fallback.replace(/\{(\w+)\}/g, (_, token: string) => String(params[token] ?? ""));
}

const title = computed(() => props.deliveries[0]?.title ?? label("platform.secretDeliveryTitle", "Generated secrets"));
const hasPendingDownload = computed(() =>
  props.deliveries.some((delivery, index) => Boolean(delivery.download) && !downloaded.value.has(index)),
);

function download(file: NonNullable<PanelSecretDelivery["download"]>, index: number): boolean {
  if (typeof document === "undefined") return false;
  try {
    const data = file.encoding === "base64" ? Uint8Array.from(atob(file.content), char => char.charCodeAt(0)) : file.content;
    const url = URL.createObjectURL(new Blob([data], { type: file.contentType }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    link.click();
    URL.revokeObjectURL(url);
    const next = new Set(downloaded.value);
    next.add(index);
    downloaded.value = next;
    return true;
  } catch {
    return false;
  }
}

watch(
  () => props.deliveries,
  (next) => {
    copied.value = null;
    downloaded.value = new Set();
    if (!next.length) return;
    next.forEach((delivery, index) => {
      if (delivery.download?.autoDownload) {
        download(delivery.download, index);
      }
    });
  },
  { immediate: true },
);

async function copy(value: string, key: string) {
  await navigator.clipboard.writeText(value);
  copied.value = key;
}

async function confirmPendingClose(): Promise<boolean> {
  if (!hasPendingDownload.value) return true;
  try {
    await ElMessageBox.confirm(
      label(
        "platform.secretDeliveryConfirmCloseMessage",
        "You have not downloaded the generated secret file yet. After closing, you cannot retrieve it again. Close anyway?",
      ),
      label("platform.secretDeliveryConfirmCloseTitle", "Secret file not downloaded"),
      {
        type: "warning",
        confirmButtonText: label("platform.secretDeliveryConfirmCloseAction", "Close anyway"),
        cancelButtonText: label("platform.secretDeliveryStayOpen", "Keep open"),
        appendTo: panel?.overlayRoot ?? undefined,
      },
    );
    return true;
  } catch {
    return false;
  }
}

async function handleBeforeClose(done: () => void) {
  if (await confirmPendingClose()) {
    done();
    emit("close");
  }
}

async function requestClose() {
  if (await confirmPendingClose()) {
    emit("close");
  }
}
</script>

<template>
  <el-dialog
    :model-value="deliveries.length > 0"
    :title="title"
    width="480px"
    class="sdk-secret-delivery-dialog"
    :append-to="panel?.overlayRoot ?? 'body'"
    :append-to-body="!panel?.overlayRoot"
    :close-on-press-escape="panel?.overlayShown?.value ?? true"
    :before-close="handleBeforeClose"
    destroy-on-close
  >
    <p role="alert"><strong>{{ label("platform.secretDeliveryOnce", "Shown only once. You cannot view these secrets again after closing.") }}</strong></p>
    <section v-for="(delivery, index) in deliveries" :key="index" class="sdk-secret-section">
      <p v-if="delivery.summary">{{ delivery.summary }}</p>
      <div v-for="(item, itemIndex) in delivery.items" :key="itemIndex" class="sdk-secret-item">
        <label :for="`${dialogId}-${index}-${itemIndex}`">{{ item.label }}</label>
        <div class="sdk-secret-value">
          <el-input :id="`${dialogId}-${index}-${itemIndex}`" :model-value="item.value" type="password" show-password readonly />
          <el-button @click="copy(item.value, `${index}/${itemIndex}`)">
            {{ copied === `${index}/${itemIndex}` ? label("platform.secretDeliveryCopied", "Copied") : label("platform.secretDeliveryCopy", "Copy") }}
          </el-button>
        </div>
        <p v-if="item.hint">{{ item.hint }}</p>
      </div>
      <div v-if="delivery.download" class="sdk-secret-download-row">
        <el-button type="primary" :plain="downloaded.has(index)" @click="download(delivery.download, index)">
          {{ label("platform.secretDeliveryDownload", `Download ${delivery.download.filename}`, { filename: delivery.download.filename }) }}
        </el-button>
        <span v-if="downloaded.has(index)" class="sdk-secret-downloaded-tag">
          {{ label("platform.secretDeliveryDownloaded", "Downloaded") }}
        </span>
      </div>
    </section>
    <template #footer>
      <el-button @click="requestClose">{{ label("platform.secretDeliveryClose", "Close") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.sdk-secret-section + .sdk-secret-section {
  margin-top: var(--spacing-md);
}
.sdk-secret-item {
  margin-block: var(--spacing-sm);
}
.sdk-secret-value {
  display: flex;
  gap: var(--spacing-sm);
}
.sdk-secret-download-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);
}
.sdk-secret-downloaded-tag {
  color: var(--el-color-success);
  font-size: var(--text-xs);
}
</style>
