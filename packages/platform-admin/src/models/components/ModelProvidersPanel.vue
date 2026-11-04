<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import AddProviderDialog from "./AddProviderDialog.vue";
import ProviderDetail from "./ProviderDetail.vue";
import ProviderList from "./ProviderList.vue";
import { useModelDraft } from "../draft";

/*
 * Where the models come from: the providers of the draft on the left, the selected provider's connection and models on
 * the right. Every change stays in the page draft until the page is saved.
 */
const props = defineProps<{ selectedId: string | null }>();
const emit = defineEmits<{
  select: [id: string];
  /** A model of the provider was renamed: references to `from` follow it to `to`. */
  renamed: [from: string, to: string];
  removed: [];
}>();
const { t } = useI18n();
const draft = useModelDraft();
const addProviderVisible = ref(false);
const selectedProvider = computed(() => draft.providers.find((p) => p.id === props.selectedId) ?? null);
const providerIds = computed(() => draft.providers.map((p) => p.id));
/** Add a provider and open it; the page's selection follows, so the panel shows the new one. */
function addProvider(input: { id: string; name: string; api: (typeof draft.providers)[number]["api"] }) {
  draft.providers.push({
    id: input.id,
    savedKeyMask: null,
    name: input.name,
    baseUrl: "",
    api: input.api,
    apiKey: "",
    headers: [],
    models: [],
  });
  emit("select", input.id);
}
</script>

<template>
  <div class="providers-split">
    <ProviderList
      class="providers-list"
      :providers="draft.providers"
      :selected-id="props.selectedId"
      @select="emit('select', $event)"
      @add="addProviderVisible = true"
    />
    <div class="providers-detail">
      <ProviderDetail
        v-if="selectedProvider"
        :key="selectedProvider.id"
        :provider-id="selectedProvider.id"
        @renamed="(from, to) => emit('renamed', from, to)"
        @removed="emit('removed')"
      />
      <div v-else class="empty-detail">
        <p class="empty-title">{{ t("admin.noProviders") }}</p>
        <p class="empty-text">{{ t("admin.noProvidersHint") }}</p>
        <el-button type="primary" @click="addProviderVisible = true">{{ t("admin.addProvider") }}</el-button>
      </div>
    </div>

    <AddProviderDialog
      v-model:visible="addProviderVisible"
      :taken-ids="providerIds"
      @add="addProvider"
    />
  </div>
</template>

<style scoped src="../models.css"></style>
