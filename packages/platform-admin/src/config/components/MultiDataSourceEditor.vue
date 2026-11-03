<script setup lang="ts">
import { computed, reactive } from "vue";
import { useI18n } from "vue-i18n";
import {
  multiDataSourceType,
  type DataAdapterInfo,
  type DataAdapterRequest,
} from "@ontomato/contracts/data-adapters";
import {
  dataAdapterRequest,
  type DataAdapterTestOutcome,
  type MultiDataSourceDraft,
  type OntologyOutline,
  type TestConnection,
} from "../types";
import type { BusinessConfigAdapterDisplay } from "../business-config";
import { usePlatformHost } from "../../context";
import DataAdapterConnectionFields from "./DataAdapterConnectionFields.vue";
import DataAdapterTestReport from "./DataAdapterTestReport.vue";

// Multi-source mode of the data adapter card: the data sources, the source of each ontology class, and the
// relationships with the source their end classes put them in. Rejection rules belong to the data engine's save;
// this editor only derives what it shows.
const { t } = useI18n();
const { separators } = usePlatformHost();

const props = defineProps<{
  adapters: DataAdapterInfo[];
  adapterDisplay: BusinessConfigAdapterDisplay;
  /** The current ontology; null until it has been read. */
  ontology: OntologyOutline | null;
  ontologyLoadError: string;
  testConnection: TestConnection;
}>();

const draft = defineModel<MultiDataSourceDraft>("draft", { required: true });

const emit = defineEmits<{
  retryOntology: [];
}>();

/** A data source is one of the installed adapters other than the multi-source adapter itself. */
const sourceAdapters = computed(() => props.adapters.filter(({ type }) => type !== multiDataSourceType));

// A test result belongs to the values it ran with: editing a source's type or connection hides it, and an answer
// arriving after such an edit is not shown for the edited source.
const outcomes = reactive(new Map<string, DataAdapterTestOutcome>());
const testing = reactive(new Set<string>());

const sourceRows = computed(() =>
  draft.value.dataSources.map((source) => {
    const adapter = sourceAdapters.value.find(({ type }) => type === source.adapterType);
    const request = adapter && dataAdapterRequest(adapter, source.connection);
    return { source, adapter, test: request && { request, key: JSON.stringify(request) } };
  })
);

function addSource() {
  draft.value.dataSources.push({ id: "", label: "", adapterType: "", readOnly: false, connection: {} });
}

function removeSource(index: number) {
  draft.value.dataSources.splice(index, 1);
}

async function test(request: DataAdapterRequest, key: string) {
  testing.add(key);
  outcomes.delete(key);
  const outcome = await props.testConnection(request);
  testing.delete(key);
  outcomes.set(key, outcome);
}

/** Sources a class can be routed to: those with an id. */
const routableIds = computed(() =>
  draft.value.dataSources.map(({ id }) => id).filter((id) => id !== "")
);

/** With exactly one data source the data engine puts every unrouted class in it. */
const fallbackSource = computed(() =>
  draft.value.dataSources.length === 1 ? draft.value.dataSources[0] : null
);

function sourceOfClass(className: string): string | undefined {
  return draft.value.classSources[className] || fallbackSource.value?.id;
}

const relationshipRows = computed(() =>
  (props.ontology === null ? [] : props.ontology.relationships).map((relationship) => {
    const from = sourceOfClass(relationship.fromClass);
    const to = sourceOfClass(relationship.toClass);
    const sourceId = from !== undefined && from === to ? from : undefined;
    const sourceType = draft.value.dataSources.find(({ id }) => id === sourceId)?.adapterType;
    const graph =
      sourceAdapters.value.find(({ type }) => type === sourceType)?.requiresJoinFields === false;
    return {
      ...relationship,
      from,
      to,
      sourceId,
      crossSource: from !== undefined && to !== undefined && from !== to,
      // A given edge name is saved whatever the source, so it stays visible and editable.
      edgeEditable: graph || Boolean(draft.value.realEdges[relationship.name]?.trim()),
    };
  })
);
</script>

<template>
  <section class="multi-source-section">
    <div class="multi-source-heading">{{ t("admin.multiSourceDataSources") }}</div>
    <p v-if="sourceRows.length === 0" class="card-empty">{{ t("admin.multiSourceNoSources") }}</p>
    <div v-for="(row, index) in sourceRows" :key="index" class="multi-source-entry">
      <el-row :gutter="24">
        <el-col :span="adapterDisplay.credentialSpan">
          <el-form-item :label="t('admin.multiSourceId')">
            <el-input v-model="row.source.id" />
          </el-form-item>
        </el-col>
        <el-col :span="adapterDisplay.credentialSpan">
          <el-form-item :label="t('admin.multiSourceLabel')">
            <el-input v-model="row.source.label" />
          </el-form-item>
        </el-col>
        <el-col :span="adapterDisplay.credentialSpan">
          <el-form-item :label="t('admin.multiSourceAdapterType')">
            <el-select v-model="row.source.adapterType">
              <el-option
                v-for="adapter in sourceAdapters"
                :key="adapter.type"
                :label="adapter.label"
                :value="adapter.type"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="adapterDisplay.credentialSpan">
          <el-form-item :label="t('admin.multiSourceReadOnly')">
            <el-switch v-model="row.source.readOnly" />
          </el-form-item>
        </el-col>
      </el-row>
      <DataAdapterConnectionFields
        v-if="row.adapter"
        v-model:connection="row.source.connection"
        :adapter="row.adapter"
        :adapter-display="adapterDisplay"
      />
      <div class="multi-source-entry-actions">
        <el-button
          v-if="row.test"
          :loading="testing.has(row.test.key)"
          @click="test(row.test.request, row.test.key)"
        >
          {{ t("common.testConnection") }}
        </el-button>
        <el-button type="danger" plain @click="removeSource(index)">
          {{ t("common.delete") }}
        </el-button>
      </div>
      <DataAdapterTestReport
        v-if="row.test && outcomes.has(row.test.key)"
        :test="outcomes.get(row.test.key)!"
      />
    </div>
    <el-button class="multi-source-add" @click="addSource">{{ t("admin.multiSourceAdd") }}</el-button>
  </section>

  <div v-if="!ontology && ontologyLoadError" class="load-error" role="alert">
    <span>{{ t("admin.multiSourceOntologyLoadFailed") }}{{ separators.detail }}{{ ontologyLoadError }}</span>
    <el-button size="small" @click="emit('retryOntology')">{{ t("common.retry") }}</el-button>
  </div>
  <p v-else-if="!ontology" class="card-empty">{{ t("common.loading") }}</p>
  <template v-else>
    <section class="multi-source-section">
      <div class="multi-source-heading">{{ t("admin.multiSourceClassRoutes") }}</div>
      <p v-if="fallbackSource" class="multi-source-hint">
        {{ t("admin.multiSourceSingleFallback", { id: fallbackSource.id }) }}
      </p>
      <p v-if="ontology.classNames.length === 0" class="card-empty">
        {{ t("admin.multiSourceNoClasses") }}
      </p>
      <div v-else class="multi-source-table-wrap">
        <table class="multi-source-table">
          <thead>
            <tr>
              <th>{{ t("admin.multiSourceClass") }}</th>
              <th>{{ t("admin.multiSourceSource") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="className in ontology.classNames" :key="className">
              <td class="multi-source-name">{{ className }}</td>
              <td>
                <el-select
                  v-model="draft.classSources[className]"
                  clearable
                  :aria-label="className"
                  :placeholder="fallbackSource ? fallbackSource.id : t('admin.multiSourceUnrouted')"
                >
                  <el-option v-for="id in routableIds" :key="id" :label="id" :value="id" />
                </el-select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="multi-source-section">
      <div class="multi-source-heading">{{ t("admin.multiSourceRelationships") }}</div>
      <p v-if="relationshipRows.length === 0" class="card-empty">
        {{ t("admin.multiSourceNoRelationships") }}
      </p>
      <div v-else class="multi-source-table-wrap">
        <table class="multi-source-table">
          <thead>
            <tr>
              <th>{{ t("admin.multiSourceRelationship") }}</th>
              <th>{{ t("admin.multiSourceEnds") }}</th>
              <th>{{ t("admin.multiSourceSource") }}</th>
              <th>{{ t("admin.multiSourceRealEdge") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in relationshipRows" :key="row.name" :data-relationship="row.name">
              <td class="multi-source-name">{{ row.name }}</td>
              <td>{{ row.fromClass }} → {{ row.toClass }}</td>
              <td class="multi-source-derived">
                <template v-if="row.crossSource">
                  <el-tag type="warning" size="small">{{ t("admin.multiSourceCrossSource") }}</el-tag>
                  {{ row.from }} → {{ row.to }}
                </template>
                <span v-else-if="row.sourceId">{{ row.sourceId }}</span>
                <span v-else class="multi-source-muted">{{ t("admin.multiSourceUnrouted") }}</span>
              </td>
              <td>
                <el-input
                  v-if="row.edgeEditable"
                  v-model="draft.realEdges[row.name]"
                  :aria-label="t('admin.multiSourceRealEdge')"
                  :placeholder="row.name"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>

<style scoped src="./config.css"></style>
