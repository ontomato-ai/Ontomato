<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElButton } from "element-plus/es/components/button/index";
import { ElDialog } from "element-plus/es/components/dialog/index";
import { ElInput } from "element-plus/es/components/input/index";
import type { PanelSecretDelivery } from "@ontomato/contracts/panel-agent";

const props = defineProps<{ deliveries: readonly PanelSecretDelivery[] }>();
const emit = defineEmits<{ close: [] }>();
const { t, te } = useI18n();
const dialogId = useId();
const copied = ref<string | null>(null);

function label(key: string, fallback: string) {
  return te(key) ? t(key) : fallback;
}

const title = computed(() => props.deliveries[0]?.title ?? label("platform.secretDeliveryTitle", "Generated secrets"));

watch(() => props.deliveries, () => { copied.value = null; });

async function copy(value: string, key: string) {
  await navigator.clipboard.writeText(value);
  copied.value = key;
}

function download(file: NonNullable<PanelSecretDelivery["download"]>) {
  const data = file.encoding === "base64" ? Uint8Array.from(atob(file.content), char => char.charCodeAt(0)) : file.content;
  const url = URL.createObjectURL(new Blob([data], { type: file.contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <el-dialog
    :model-value="deliveries.length > 0"
    :title="title"
    width="480px"
    class="sdk-secret-delivery-dialog"
    append-to-body
    destroy-on-close
    @update:model-value="open => { if (!open) emit('close'); }"
  >
    <p role="alert"><strong>{{ label("platform.secretDeliveryOnce", "Shown only once. You cannot view these secrets again after closing.") }}</strong></p>
    <section v-for="(delivery, index) in deliveries" :key="index">
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
      <el-button v-if="delivery.download" @click="download(delivery.download)">
        {{ te("platform.secretDeliveryDownload") ? t("platform.secretDeliveryDownload", { filename: delivery.download.filename }) : `Download ${delivery.download.filename}` }}
      </el-button>
    </section>
  </el-dialog>
</template>

<style scoped>
.sdk-secret-item {
  margin-block: var(--spacing-sm);
}
.sdk-secret-value {
  display: flex;
  gap: var(--spacing-sm);
}
</style>
