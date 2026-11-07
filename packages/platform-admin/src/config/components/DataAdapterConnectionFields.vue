<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type {
  DataAdapterConnection,
  DataAdapterFieldInfo,
  DataAdapterInfo,
} from "@ontomato/contracts/data-adapters";
import type { BusinessConfigAdapterDisplay } from "../business-config";

// The fields one adapter type declares, rendered in declaration order. The
// provider is the source of truth: a new adapter adds account/warehouse/role/
// serverHostname/... on the server, with no per-adapter Vue component here.
const { t, te } = useI18n();

const props = defineProps<{
  adapter: DataAdapterInfo;
  adapterDisplay: BusinessConfigAdapterDisplay;
}>();

const connection = defineModel<DataAdapterConnection>("connection", { required: true });

/** Known field names -> translated labels; unknown names fall back to humanized text. */
const LABEL_KEYS: Record<string, string> = {
  url: "admin.connectionUrl",
  jdbcUrl: "admin.connectionUrl",
  company: "admin.company",
  user: "common.username",
  password: "common.password",
  account: "admin.account",
  warehouse: "admin.warehouse",
  role: "admin.role",
  database: "admin.databaseName",
  schema: "admin.databaseSchema",
  catalog: "admin.catalog",
  serverHostname: "admin.serverHostname",
  host: "admin.host",
  port: "admin.port",
  httpPath: "admin.httpPath",
  token: "admin.accessToken",
  accessToken: "admin.accessToken",
  privateKey: "admin.privateKey",
  clientId: "admin.clientId",
  clientSecret: "admin.clientSecret",
  tenantId: "admin.tenantId",
  project: "admin.project",
  dataset: "admin.dataset",
  region: "admin.region",
};

const SECRET_NAME = /(password|secret|token|private.?key|access.?key|api.?key)/i;

function humanize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toUpperCase());
}

function labelFor(field: DataAdapterFieldInfo): string {
  if (field.label) return field.label;
  const key = LABEL_KEYS[field.name];
  if (key && te(key)) return t(key);
  return humanize(field.name);
}

const fields = computed<DataAdapterFieldInfo[]>(() => {
  if (props.adapter.fieldInfos && props.adapter.fieldInfos.length > 0) {
    return props.adapter.fieldInfos;
  }
  return (props.adapter.fields ?? []).map((name) => ({
    name,
    label: null,
    required: false,
    secret: SECRET_NAME.test(name),
    example: props.adapter.examples?.[name] ?? null,
    fullWidth: false,
  }));
});

function valueOf(name: string): string {
  return connection.value[name] ?? "";
}

function setValue(name: string, value: string): void {
  connection.value[name] = value;
}
</script>

<template>
  <div v-if="fields.length > 0" class="connection-fields">
    <div
      v-for="field in fields"
      :key="field.name"
      :class="{ 'full-width': field.fullWidth || props.adapterDisplay.credentialSpan === 24 }"
    >
      <el-form-item :label="labelFor(field)" :required="Boolean(field.required)">
        <el-input
          :model-value="valueOf(field.name)"
          :placeholder="field.example ?? (field.secret ? '******' : undefined)"
          :type="field.secret ? 'password' : 'text'"
          :show-password="Boolean(field.secret)"
          clearable
          @update:model-value="setValue(field.name, $event)"
        />
      </el-form-item>
    </div>
  </div>
</template>

<style scoped>
.connection-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 var(--spacing-lg);
  min-width: 0;
}
.full-width { grid-column: 1 / -1; }
@container platform-page (max-width: 680px) {
  .connection-fields { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 680px) {
  .connection-fields { grid-template-columns: minmax(0, 1fr); }
}
</style>
