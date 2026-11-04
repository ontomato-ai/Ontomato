<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { Plus as PlusIcon, Trash2 as Trash2Icon } from "lucide-vue-next";
import { MCP_HEADER_MASK, mcpServiceWriteSchema } from "@ontomato/contracts/agent-runtime-mcp";
import { saveMcpService, type McpServiceView } from "../api";
import { ApiRequestError } from "../../../utils/api";

/**
 * Add or edit one external MCP service. Both the capability library and the agents page's capability section use it, so
 * the address, the header rows and their validation live in one place; the caller reloads its list after `saved`.
 */
const props = defineProps<{ service: McpServiceView | null }>();
const visible = defineModel<boolean>("visible", { required: true });
const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();

const saving = ref(false);
const form = ref({
  name: "",
  url: "",
  headers: [] as Array<{ name: string; value: string; storedName?: string }>,
});

function open(service: McpServiceView | null) {
  form.value = {
    name: service?.name || "",
    url: service?.url || "",
    headers: Object.keys(service?.headers || {}).map((name) => ({ name, value: "", storedName: name })),
  };
}
open(props.service);

async function save() {
  const name = form.value.name.trim();
  const url = form.value.url.trim();
  if (!name || !url) return ElMessage.warning(t("hotData.fillNameAndAddress"));
  try {
    if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error();
  } catch {
    return ElMessage.warning(t("hotData.addressFormatHint"));
  }
  const headers: Record<string, string | null> = {};
  const names = new Set<string>();
  for (const row of form.value.headers) {
    const key = row.name.trim();
    if (!key && !row.value) continue;
    if (!key || names.has(key.toLowerCase())) return ElMessage.warning(t("mcp.invalidHeaders"));
    names.add(key.toLowerCase());
    // A stored header keeps its value unless a new one is typed; its name cannot change without a new value.
    if (row.storedName && !row.value && row.storedName !== key.toLowerCase())
      return ElMessage.warning(t("mcp.invalidHeaders"));
    headers[key] = row.storedName && !row.value ? null : row.value;
  }
  const parsed = mcpServiceWriteSchema.safeParse({ name, url, headers });
  if (!parsed.success) return ElMessage.warning(t("mcp.invalidHeaders"));

  saving.value = true;
  try {
    await saveMcpService(parsed.data, props.service?.id);
    ElMessage.success(t("admin.saveSuccess"));
    visible.value = false;
    emit("saved");
  } catch (error) {
    ElMessage.error(
      t(error instanceof ApiRequestError && error.code === "MCP_NAME_EXISTS" ? "mcp.nameExists" : "admin.saveFailed"),
    );
  } finally {
    saving.value = false;
  }
}

const title = computed(() => (props.service ? t("mcp.editService") : t("hotData.addService")));
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="600px" class="mcp-editor" :close-on-click-modal="false" append-to-body>
    <el-form label-position="top" @submit.prevent="save">
      <el-form-item :label="t('hotData.serviceName')" required>
        <el-input v-model="form.name" maxlength="100" :aria-label="t('hotData.serviceName')" />
      </el-form-item>
      <el-form-item :label="t('hotData.serviceAddress')" required>
        <el-input v-model="form.url" placeholder="https://example.com/mcp" :aria-label="t('hotData.serviceAddress')" />
        <p class="form-hint">{{ t("mcp.urlHint") }}</p>
      </el-form-item>
      <el-form-item :label="t('mcp.headers')">
        <div class="headers-editor">
          <p class="form-hint">{{ t("mcp.headersHint") }}</p>
          <div v-for="(header, index) in form.headers" :key="index" class="header-row">
            <el-input v-model="header.name" :placeholder="t('mcp.headerName')" :aria-label="t('mcp.headerName')" />
            <el-input
              v-model="header.value"
              type="password"
              show-password
              :placeholder="header.storedName ? MCP_HEADER_MASK : t('mcp.headerValue')"
              :aria-label="t('mcp.headerValue')"
            />
            <el-button :icon="Trash2Icon" :aria-label="t('common.delete')" @click="form.headers.splice(index, 1)" />
          </div>
          <el-button text type="primary" :icon="PlusIcon" @click="form.headers.push({ name: '', value: '' })">
            {{ t("mcp.addHeader") }}
          </el-button>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" :loading="saving" @click="save">{{ t("common.save") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.headers-editor {
  width: 100%;
}
.header-row {
  display: grid;
  grid-template-columns: 1fr 1.3fr auto;
  gap: 8px;
  margin: 10px 0;
}
.form-hint {
  margin: 6px 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}
:global(.mcp-editor) {
  max-width: calc(100vw - 32px);
}
@media (max-width: 768px) {
  .header-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .header-row > :first-child {
    grid-column: 1 / -1;
  }
}
</style>
