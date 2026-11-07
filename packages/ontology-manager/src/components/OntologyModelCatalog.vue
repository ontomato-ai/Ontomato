<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElButton, ElEmpty, ElInput, ElOption, ElSelect, vLoading } from "element-plus";
import { ChevronDown, ChevronRight, ChevronUp, Plus, Search } from "lucide-vue-next";
import type { OntologyAttribute, OntologyObject, OntologyRelation } from "../api";
import OntologyAttributeCreateDialog from "./OntologyAttributeCreateDialog.vue";
import OntologyAttributeEditor from "./OntologyAttributeEditor.vue";
import OntologyRelationCreateDialog from "./OntologyRelationCreateDialog.vue";
import type { ModelResource } from "../workspace";
import { useManagerClient, useOntologyText } from "../context";
import { PlatformPageHeader } from "@ontomato/platform-shell";

const { ot } = useOntologyText();
const { loadOntology } = useManagerClient();

const props = defineProps<{ resource: ModelResource }>();

const emit = defineEmits<{
  createObject: [];
  editObject: [className: string];
  editRelation: [relationship: string];
}>();

const query = ref("");
const ownerFilter = ref("");
const expandedAttributeKey = ref("");
const loading = ref(false);
const objects = ref<OntologyObject[]>([]);
const relations = ref<OntologyRelation[]>([]);
const attributeCreateVisible = ref(false);
const relationCreateVisible = ref(false);

const labelKeys: Record<
  ModelResource,
  {
    title: Parameters<typeof ot>[0];
    description: Parameters<typeof ot>[0];
    search: Parameters<typeof ot>[0];
  }
> = {
  objects: {
    title: "objectTypesTitle",
    description: "objectTypesDesc",
    search: "filterObjectTypes",
  },
  attributes: {
    title: "attributesTitle",
    description: "attributesDesc",
    search: "filterAttributes",
  },
  relations: {
    title: "relationTypesTitle",
    description: "relationTypesDesc",
    search: "filterRelationTypes",
  },
};

const meta = computed(() => {
  const keys = labelKeys[props.resource];
  return { title: ot(keys.title), description: ot(keys.description), search: ot(keys.search) };
});
const normalizedQuery = computed(() => query.value.trim().toLowerCase());

const objectRows = computed(() =>
  objects.value.filter((object) => {
    const text = `${object.showName} ${object.className} ${object.classDesc}`.toLowerCase();
    return !normalizedQuery.value || text.includes(normalizedQuery.value);
  })
);

const attributeRows = computed(() =>
  objects.value
    .flatMap((object) => object.attrs.map((attribute) => ({ object, attribute })))
    .filter(({ object, attribute }) => {
      if (ownerFilter.value && object.className !== ownerFilter.value) return false;
      const text =
        `${attribute.showName} ${attribute.name} ${attribute.type} ${object.showName}`.toLowerCase();
      return !normalizedQuery.value || text.includes(normalizedQuery.value);
    })
);

const relationRows = computed(() =>
  relations.value.filter((relation) => {
    const text =
      `${relation.relationship} ${relation.fromclass} ${relation.toclass} ${relation.desc}`.toLowerCase();
    return !normalizedQuery.value || text.includes(normalizedQuery.value);
  })
);

function objectLabel(className: string) {
  return objects.value.find((object) => object.className === className)?.showName || className;
}

function businessKeyCount(object: OntologyObject) {
  return object.attrs.filter((attribute) => attribute.bizzkeyBool).length;
}

function attributeLabel(attribute: OntologyAttribute) {
  return attribute.showName || attribute.name;
}

function attributeKey(className: string, attributeName: string) {
  return `${className}-${attributeName}`;
}

function isAttributeExpanded(row: { object: OntologyObject; attribute: OntologyAttribute }) {
  return expandedAttributeKey.value === attributeKey(row.object.className, row.attribute.name);
}

function toggleAttribute(row: { object: OntologyObject; attribute: OntologyAttribute }) {
  const key = attributeKey(row.object.className, row.attribute.name);
  expandedAttributeKey.value = expandedAttributeKey.value === key ? "" : key;
}

async function loadCatalog() {
  loading.value = true;
  try {
    const ontology = await loadOntology();
    objects.value = ontology.objects;
    relations.value = ontology.relations;
  } catch {
    objects.value = [];
    relations.value = [];
  } finally {
    loading.value = false;
  }
}

async function handleAttributeCreated(className: string, attributeName: string) {
  await loadCatalog();
  expandedAttributeKey.value = attributeKey(className, attributeName);
}

async function handleRelationCreated(relationship: string) {
  await loadCatalog();
  emit("editRelation", relationship);
}

onMounted(() => {
  void loadCatalog();
});
</script>

<template>
  <section v-loading="loading" class="model-catalog">
    <!-- The platform's one page header: the title, its line of description, and this page's own button. -->
    <PlatformPageHeader compact :title="meta.title" :description="meta.description">
      <template #actions>
        <el-button
          v-if="resource === 'objects'"
          type="primary"
          :icon="Plus"
          @click="emit('createObject')"
        >
          {{ ot("createObjectType") }}
        </el-button>
        <el-button
          v-else-if="resource === 'attributes'"
          type="primary"
          :icon="Plus"
          @click="attributeCreateVisible = true"
        >
          {{ ot("createAttribute") }}
        </el-button>
        <el-button v-else type="primary" :icon="Plus" @click="relationCreateVisible = true">
          {{ ot("createRelationType") }}
        </el-button>
      </template>
    </PlatformPageHeader>

    <!-- The page under the header takes the page gutter, so the filters and the table start where the title does. -->
    <div class="catalog-body platform-page-gutter">
      <div class="catalog-toolbar">
        <el-input v-model="query" :prefix-icon="Search" :placeholder="meta.search" clearable />
        <el-select
          v-if="resource === 'attributes'"
          v-model="ownerFilter"
          class="owner-filter"
          :placeholder="ot('allObjectTypes')"
          clearable
        >
          <el-option
            v-for="object in objects"
            :key="object.className"
            :label="`${object.showName} (${object.className})`"
            :value="object.className"
          />
        </el-select>
        <span class="resource-count">
          {{
            resource === "objects"
              ? objectRows.length
              : resource === "attributes"
                ? attributeRows.length
                : relationRows.length
          }}
          {{ ot("items") }}
        </span>
      </div>

      <div class="resource-table">
        <template v-if="resource === 'objects'">
          <div class="resource-table-head object-grid">
            <span>{{ ot("objectTypesTitle") }}</span>
            <span>{{ ot("businessDescription") }}</span>
            <span>{{ ot("attributes") }}</span>
            <span>{{ ot("businessKey") }}</span>
            <span></span>
          </div>
          <button
            v-for="object in objectRows"
            :key="object.className"
            class="resource-table-row object-grid"
            @click="emit('editObject', object.className)"
          >
            <span class="resource-name">
              <span>
                <strong>{{ object.showName }}</strong>
                <small>{{ object.className }}</small>
              </span>
            </span>
            <span class="resource-description">{{ object.classDesc }}</span>
            <span>{{ object.attrs.length }}</span>
            <span>{{ businessKeyCount(object) }}</span>
            <ChevronRight :size="16" class="row-chevron" />
          </button>
          <el-empty
            v-if="!loading && objectRows.length === 0"
            :description="ot('notFoundObjectTypes')"
          />
        </template>

        <template v-else-if="resource === 'attributes'">
          <div class="resource-table-head attribute-grid">
            <span>{{ ot("attributes") }}</span>
            <span>{{ ot("ownerObjectType") }}</span>
            <span>{{ ot("dataType") }}</span>
            <span>{{ ot("businessKey") }}</span>
            <span>{{ ot("primaryKey") }}</span>
            <span></span>
          </div>
          <div
            v-for="row in attributeRows"
            :key="`${row.object.className}-${row.attribute.name}`"
            class="attribute-row-group"
            :class="{ expanded: isAttributeExpanded(row) }"
          >
            <div
              class="resource-table-row attribute-grid"
              role="button"
              tabindex="0"
              :aria-expanded="isAttributeExpanded(row)"
              @click="toggleAttribute(row)"
              @keydown.enter.prevent="toggleAttribute(row)"
              @keydown.space.prevent="toggleAttribute(row)"
            >
              <span class="resource-name">
                <span>
                  <strong>{{ attributeLabel(row.attribute) }}</strong>
                  <small>{{ row.attribute.name }}</small>
                </span>
              </span>
              <button
                class="inline-link"
                @click.stop="emit('editObject', row.object.className)"
                @keydown.stop
              >
                {{ row.object.showName }}
              </button>
              <span>{{ row.attribute.type }}</span>
              <span>{{ row.attribute.bizzkeyBool ? ot("yes") : "-" }}</span>
              <span>{{ row.attribute.primaryKey ? ot("yes") : "-" }}</span>
              <ChevronUp v-if="isAttributeExpanded(row)" :size="16" class="row-chevron" />
              <ChevronDown v-else :size="16" class="row-chevron" />
            </div>
            <OntologyAttributeEditor
              v-if="isAttributeExpanded(row)"
              :class-name="row.object.className"
              :attribute="row.attribute"
              @saved="loadCatalog"
              @deleted="loadCatalog"
            />
          </div>
          <el-empty
            v-if="!loading && attributeRows.length === 0"
            :description="ot('notFoundAttributes')"
          />
        </template>

        <template v-else>
          <div class="resource-table-head relation-grid">
            <span>{{ ot("relationTypesTitle") }}</span>
            <span>{{ ot("sourceObject") }}</span>
            <span>{{ ot("targetObject") }}</span>
            <span>{{ ot("description") }}</span>
            <span></span>
          </div>
          <button
            v-for="relation in relationRows"
            :key="relation.relationship"
            class="resource-table-row relation-grid"
            @click="emit('editRelation', relation.relationship)"
          >
            <span class="resource-name">
              <span>
                <strong>{{ relation.desc || relation.relationship }}</strong>
              </span>
            </span>
            <span>{{ objectLabel(relation.fromclass) }}</span>
            <span>{{ objectLabel(relation.toclass) }}</span>
            <span class="resource-description">{{ relation.desc || "-" }}</span>
            <ChevronRight :size="16" class="row-chevron" />
          </button>
          <el-empty
            v-if="!loading && relationRows.length === 0"
            :description="ot('notFoundRelationTypes')"
          />
        </template>
      </div>
    </div>
    <OntologyAttributeCreateDialog
      v-model="attributeCreateVisible"
      :objects="objects"
      @created="handleAttributeCreated"
    />
    <OntologyRelationCreateDialog
      v-model="relationCreateVisible"
      :objects="objects"
      :relations="relations.map((relation) => relation.relationship)"
      @created="handleRelationCreated"
    />
  </section>
</template>

<style scoped>
/*
 * The page paints no background of its own: it sits on the application's area, the darkest band in dark mode
 * (DESIGN.md "Colour roles"); the table keeps its own surface.
 */
.model-catalog {
  /* The value is supplied by the host presentation (open source: auto). */
  min-height: var(--manager-model-catalog-min-height);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}
.catalog-toolbar {
  display: flex;
  flex-wrap: wrap;
  min-height: 40px;
  align-items: center;
  gap: var(--spacing-sm);
  margin-top: var(--manager-content-gap);
}
.catalog-toolbar :deep(.el-input) {
  width: 260px;
  max-width: 100%;
}
.catalog-toolbar .owner-filter {
  width: 220px;
}
.resource-count {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.resource-table {
  overflow: auto;
  margin: var(--manager-content-gap) 0 var(--manager-module-gap);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
}
.resource-table-head,
.resource-table-row {
  display: grid;
  box-sizing: border-box;
  width: 100%;
  align-items: center;
  column-gap: var(--spacing-md);
  text-align: left;
}
.resource-table-head {
  min-height: var(--table-head-height);
  padding: 0 var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color);
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  letter-spacing: 0.02em;
}
.resource-table-row {
  min-height: var(--list-row-height);
  padding: 8px var(--spacing-md);
  border: 0;
  border-bottom: 1px solid var(--el-border-color-light);
  color: var(--el-text-color-regular);
  background: var(--el-bg-color);
  cursor: pointer;
  font-size: var(--text-sm);
  transition: background-color var(--transition-fast);
}
.resource-table-row:last-child {
  border-bottom: 0;
}
.resource-table-row:hover {
  background: var(--el-fill-color-light);
}
.attribute-row-group {
  border-bottom: 1px solid var(--el-border-color-light);
}
.attribute-row-group:last-child {
  border-bottom: 0;
}
.attribute-row-group .resource-table-row {
  border-bottom: 0;
}
.attribute-row-group.expanded .resource-table-row {
  background: var(--el-fill-color-light);
}
.object-grid {
  grid-template-columns: minmax(220px, 1.4fr) minmax(240px, 2fr) 88px 88px 20px;
}
.attribute-grid {
  grid-template-columns: minmax(220px, 1.4fr) minmax(160px, 1fr) minmax(120px, 1fr) 88px 88px 20px;
}
.relation-grid {
  grid-template-columns:
    minmax(220px, 1.35fr) minmax(140px, 1fr) minmax(140px, 1fr) minmax(180px, 1.6fr)
    20px;
}
.resource-name {
  display: flex;
  min-width: 0;
  align-items: center;
}
.resource-name > span:last-child {
  min-width: 0;
}
.resource-name strong,
.resource-name small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.resource-name strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.resource-name small {
  margin-top: 2px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.resource-description {
  overflow: hidden;
  color: var(--el-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inline-link {
  justify-self: start;
  align-self: center;
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  color: var(--brand-link);
  background: transparent;
  font: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inline-link:hover {
  text-decoration: underline;
}
.row-chevron {
  color: var(--el-text-color-tertiary);
}
@container ontology-manager (max-width: 900px) {
  .object-grid {
    grid-template-columns: minmax(190px, 1fr) 64px 20px;
  }
  .attribute-grid {
    grid-template-columns: minmax(150px, 1.4fr) minmax(100px, 1fr) minmax(80px, 0.8fr) 20px;
  }
  .relation-grid {
    grid-template-columns: minmax(190px, 1fr) minmax(100px, 1fr) 20px;
  }
  .object-grid > :nth-child(2),
  .object-grid > :nth-child(4),
  .attribute-grid > :nth-child(4),
  .attribute-grid > :nth-child(5),
  .relation-grid > :nth-child(2),
  .relation-grid > :nth-child(4) {
    display: none;
  }
}
@container ontology-manager (max-width: 560px) {
  .attribute-grid {
    grid-template-columns: minmax(140px, 1fr) minmax(80px, 0.8fr) 20px;
  }
  .attribute-grid > :nth-child(2) {
    display: none;
  }
  .catalog-toolbar :deep(.el-input),
  .catalog-toolbar .owner-filter {
    width: 100%;
  }
  .catalog-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
