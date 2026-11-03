<script setup lang="ts">
import { computed } from "vue";
import { Link2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import {
  multiDataSourceType,
  type DataAdapterConnection,
  type DataAdapterInfo,
} from "@ontomato/contracts/data-adapters";
import type {
  DataAdapterTestOutcome,
  MultiDataSourceDraft,
  MultiDataSourceSaveFailure,
  OntologyOutline,
  SystemSettings,
  TestConnection,
} from "../types";
import type { BusinessConfigAdapterDisplay } from "../business-config";
import DataAdapterConnectionFields from "./DataAdapterConnectionFields.vue";
import DataAdapterTestReport from "./DataAdapterTestReport.vue";
import MultiDataSourceEditor from "./MultiDataSourceEditor.vue";

const { t } = useI18n();

const props = defineProps<{
  saving: boolean;
  testing: boolean;
  /** Outcome of the last connection test; null when none is shown. */
  test: DataAdapterTestOutcome | null;
  disabled: boolean;
  adapters: DataAdapterInfo[];
  adapterDisplay: BusinessConfigAdapterDisplay;
  /** The current ontology for the multi-source editor; null until it has been read. */
  ontology: OntologyOutline | null;
  ontologyLoadError: string;
  testConnection: TestConnection;
  /** Why the last multi-source save failed; null when it has not failed. */
  multiSaveFailure: MultiDataSourceSaveFailure | null;
}>();

const config = defineModel<SystemSettings>("config", { required: true });
const mode = defineModel<string>("mode", { required: true });
const multiDraft = defineModel<MultiDataSourceDraft>("multiDraft", { required: true });

const emit = defineEmits<{
  save: [];
  test: [];
  retryOntology: [];
}>();

const selected = computed(() => props.adapters.find(({ type }) => type === mode.value));

function connection(type: string): DataAdapterConnection {
  config.value.dataAdapterConnections[type] ??= {};
  return config.value.dataAdapterConnections[type];
}
</script>

<template>
  <div class="admin-card config-card">
    <div class="card-header">
      <el-icon :size="20"><Link2 /></el-icon>
      <span>{{ t("admin.dataAdapterConfig") }}</span>
    </div>
    <div class="card-body">
      <el-form
        class="config-form"
        :disabled="disabled"
        :label-width="adapterDisplay.labelWidth"
        label-position="left"
        size="default"
      >
        <el-form-item :label="t('admin.adapterMode')">
          <el-radio-group v-model="mode">
            <el-radio v-for="adapter in adapters" :key="adapter.type" :value="adapter.type">{{
              adapter.label
            }}</el-radio>
          </el-radio-group>
        </el-form-item>

        <MultiDataSourceEditor
          v-if="mode === multiDataSourceType"
          v-model:draft="multiDraft"
          :adapters="adapters"
          :adapter-display="adapterDisplay"
          :ontology="ontology"
          :ontology-load-error="ontologyLoadError"
          :test-connection="testConnection"
          @retry-ontology="emit('retryOntology')"
        />
        <DataAdapterConnectionFields
          v-else-if="selected"
          :connection="connection(selected.type)"
          :adapter="selected"
          :adapter-display="adapterDisplay"
        />

        <el-form-item class="form-actions">
          <el-button
            v-if="selected && mode !== multiDataSourceType"
            :loading="testing"
            :disabled="disabled"
            @click="emit('test')"
          >
            {{ t("common.testConnection") }}
          </el-button>
          <!-- The multi-source definition is saved with the routes of the current ontology, so it waits for the ontology. -->
          <el-button
            type="primary"
            :loading="saving"
            :disabled="disabled || (mode === multiDataSourceType && !ontology)"
            @click="emit('save')"
          >
            {{ t("common.saveAdapterConfig") }}
          </el-button>
        </el-form-item>
      </el-form>

      <DataAdapterTestReport v-if="test" :test="test" />
      <el-alert
        v-if="mode === multiDataSourceType && multiSaveFailure"
        class="multi-source-failure"
        type="error"
        :title="t('admin.multiSourceSaveRejected')"
        :closable="false"
        show-icon
      >
        <ul v-if="multiSaveFailure.problems.length > 0" class="multi-source-problems">
          <li v-for="(problem, index) in multiSaveFailure.problems" :key="index">
            <code>{{ problem.path }}</code>
            <span>{{ problem.detail }}</span>
          </li>
        </ul>
        <pre v-else class="adapter-test-message">{{ multiSaveFailure.message }}</pre>
      </el-alert>
    </div>
  </div>
</template>

<style scoped src="./config.css"></style>
