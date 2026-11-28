<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElAlert } from "element-plus/es/components/alert/index";
import { ElButton } from "element-plus/es/components/button/index";
import { ElDescriptions, ElDescriptionsItem } from "element-plus/es/components/descriptions/index";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElInput } from "element-plus/es/components/input/index";
import { ElPopover } from "element-plus/es/components/popover/index";
import { ElTable, ElTableColumn } from "element-plus/es/components/table/index";
import { ElTabPane, ElTabs } from "element-plus/es/components/tabs/index";
import { ElTag } from "element-plus/es/components/tag/index";
import { ElTooltip } from "element-plus/es/components/tooltip/index";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { curatedIcon } from "@ontomato/platform-shell/icons";
import { useMember, useMemberData } from "../panel/member";import type { PlatformObjectRecord } from "../panel/platform-objects";
import { useDataStateLabels } from "./data-state-labels";
import { rawRecordField } from "./record-field";
import type {
  EffectiveManagementOperationItem,
  EffectivePermissionDataRow,
  EffectivePermissionOrgRoleGrant,
  EffectivePermissionOrgShareItem,
  EffectivePermissionShareRole,
  EffectivePermissionShareRoleRule,
} from "./effective-permissions-types";

/**
 * Governance-domain read-only effective permissions inspector.
 *
 * Shared across Organization Management ("View effective permissions" dialog) and Member Detail ("Effective
 * permissions" tab) without bloating the generic `ObjectSummary` component with permission-specific layouts.
 *
 * One display reads once: a record or list handed by a parent is drawn alone and its datum is not read again.
 */
const props = withDefaults(
  defineProps<{
    /** Direct effective-permissions summary record (standalone usage outside `data.record` binding). */
    record?: PlatformObjectRecord | Record<string, unknown> | null;
    /** Direct organization share source records (standalone usage outside `data.orgShares` binding). */
    orgShares?: readonly (PlatformObjectRecord | Record<string, unknown>)[] | null;
    /** Direct management operation records (standalone usage outside `data.managementOperations` binding). */
    managementOperations?: readonly (PlatformObjectRecord | Record<string, unknown>)[] | null;
    /** Direct personal data permission records (standalone usage outside `data.subjectData` binding). */
    subjectData?: readonly (PlatformObjectRecord | Record<string, unknown>)[] | null;
    /** Direct managed-organization data permission records (standalone usage outside `data.managedData` binding). */
    managedData?: readonly (PlatformObjectRecord | Record<string, unknown>)[] | null;
    /** Direct final effective data permission records (standalone usage outside `data.effectiveData` binding). */
    effectiveData?: readonly (PlatformObjectRecord | Record<string, unknown>)[] | null;
    /** Initial active data permission tab (`subject`, `managed`, or `effective`). */
    defaultDataTab?: "subject" | "managed" | "effective";
  }>(),
  {
    record: undefined,
    orgShares: undefined,
    managementOperations: undefined,
    subjectData: undefined,
    managedData: undefined,
    effectiveData: undefined,
    defaultDataTab: "effective",
  },
);

const member = (() => {
  try {
    return useMember();
  } catch {
    return null;
  }
})();

function bindDatum(name: string) {
  if (!member?.projection.data?.[name]) return null;
  try {
    return useMemberData(name);
  } catch {
    return null;
  }
}

// Each list a parent hands over is drawn alone; only the datums it leaves to this view are read, once each.
const recordDatum = props.record === undefined ? bindDatum("record") : null;
const orgSharesDatum = props.orgShares === undefined ? bindDatum("orgShares") : null;
const managementOperationsDatum = props.managementOperations === undefined ? bindDatum("managementOperations") : null;
const subjectDataDatum = props.subjectData === undefined ? bindDatum("subjectData") : null;
const managedDataDatum = props.managedData === undefined ? bindDatum("managedData") : null;
const effectiveDataDatum = props.effectiveData === undefined ? bindDatum("effectiveData") : null;

const i18n = (() => {
  try {
    return useI18n();
  } catch {
    return null;
  }
})();

function translate(key: string, fallback: string, params?: Record<string, unknown>): string {
  if (i18n && i18n.te(key)) {
    return params ? i18n.t(key, params) : i18n.t(key);
  }
  if (!params) return fallback;
  return fallback.replace(/\{(\w+)\}/g, (_, token: string) => String(params[token] ?? ""));
}

const helpIcon = curatedIcon("circle-help");
const apiExpanded = ref(false);
const apiKeyword = ref("");
const activeDataTab = ref<"subject" | "managed" | "effective">(props.defaultDataTab);

function readField(record: Record<string, unknown>, key: string): unknown {
  if (record.fields && typeof record.fields === "object") {
    return rawRecordField(record as unknown as PlatformObjectRecord, key);
  }
  return record[key];
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readField(record, key);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readStringList(record: Record<string, unknown>, key: string): string[] {
  const value = readField(record, key);
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const label = typeof obj.label === "string" ? obj.label : typeof obj.roleName === "string" ? obj.roleName : undefined;
      if (label?.trim()) out.push(label.trim());
    }
  }
  return out;
}

function resolveList(
  propValue: readonly (PlatformObjectRecord | Record<string, unknown>)[] | null | undefined,
  datum: ReturnType<typeof bindDatum>,
): readonly Record<string, unknown>[] {
  if (propValue !== undefined) return (propValue ?? []) as readonly Record<string, unknown>[];
  if (!datum) return [];
  const state = datum.value;
  if (state.status !== "ready" || !Array.isArray(state.value)) return [];
  return state.value as readonly Record<string, unknown>[];
}

const recordState = computed<DataStateResult<Record<string, unknown>>>(() => {
  if (props.record !== undefined) {
    return props.record ? { status: "ready", value: props.record as Record<string, unknown> } : { status: "empty" };
  }
  if (!recordDatum) return { status: "empty" };
  const state = recordDatum.value;
  if (state.status !== "ready") return state as DataStateResult<Record<string, unknown>>;
  if (!state.value || typeof state.value !== "object") return { status: "empty" };
  return { status: "ready", value: state.value as unknown as Record<string, unknown> };
});

const summaryRecord = computed<Record<string, unknown> | null>(() =>
  recordState.value.status === "ready" ? recordState.value.value : null,
);

const directRoles = computed<string[]>(() => (
  summaryRecord.value ? readStringList(summaryRecord.value, "directRoles") : []
));

const orgRoleGrants = computed<EffectivePermissionOrgRoleGrant[]>(() => {
  if (!summaryRecord.value) return [];
  const raw = readField(summaryRecord.value, "organizationRoleGrants");
  if (!Array.isArray(raw)) return [];
  const grants: EffectivePermissionOrgRoleGrant[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim()) {
      const trimmed = entry.trim();
      const splitIndex = trimmed.indexOf(" — ");
      if (splitIndex > 0) {
        grants.push({
          role: trimmed.slice(0, splitIndex).trim(),
          recipient: trimmed.slice(splitIndex + 3).trim(),
        });
      } else {
        grants.push({ role: trimmed });
      }
    } else if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      const role = typeof obj.role === "string" ? obj.role : typeof obj.roleName === "string" ? obj.roleName : "";
      if (!role.trim()) continue;
      const recipient = typeof obj.recipient === "string"
        ? obj.recipient
        : typeof obj.source === "string"
          ? obj.source
          : undefined;
      grants.push({ role: role.trim(), recipient: recipient?.trim() || undefined });
    }
  }
  return grants;
});

function looksLikeJsonRule(text: string): boolean {
  const trimmed = text.trim();
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

function parseShareRoleContribution(entry: unknown): EffectivePermissionShareRole | null {
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    const roleName = typeof obj.roleName === "string" ? obj.roleName : typeof obj.role === "string" ? obj.role : "";
    if (!roleName.trim()) return null;
    const contributors = typeof obj.contributors === "number" || typeof obj.contributors === "string" ? obj.contributors : undefined;
    const fullRowClasses = Array.isArray(obj.fullRowClasses)
      ? obj.fullRowClasses.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const rowRules: EffectivePermissionShareRoleRule[] = Array.isArray(obj.rowRules)
      ? obj.rowRules.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const rec = item as Record<string, unknown>;
          const className = typeof rec.className === "string" ? rec.className : "";
          const rule = typeof rec.rule === "string" ? rec.rule : typeof rec.customMqlFragment === "string" ? rec.customMqlFragment : "";
          return className && rule ? [{ className, rule }] : [];
        })
      : [];
    return {
      roleName: roleName.trim(),
      contributors,
      fullRowClasses,
      rowRules,
      summary: typeof obj.summary === "string" ? obj.summary : undefined,
    };
  }
  if (typeof entry !== "string" || !entry.trim()) return null;
  const trimmed = entry.trim();
  const dashIdx = trimmed.indexOf(" — ");
  const head = dashIdx > 0 ? trimmed.slice(0, dashIdx).trim() : trimmed;
  const tail = dashIdx > 0 ? trimmed.slice(dashIdx + 3).trim() : "";
  const parenMatch = head.match(/^(.+?)\s*\(([^()]+)\)$/);
  const roleName = parenMatch ? parenMatch[1]!.trim() : head;
  const contributors = parenMatch ? parenMatch[2]!.trim() : undefined;
  const fullRowClasses: string[] = [];
  const rowRules: EffectivePermissionShareRoleRule[] = [];
  const summaryParts: string[] = [];
  if (tail) {
    for (const segment of tail.split(" · ")) {
      const part = segment.trim();
      if (!part) continue;
      const segDash = part.indexOf(" — ");
      if (segDash > 0) {
        const className = part.slice(0, segDash).trim();
        const detail = part.slice(segDash + 3).trim();
        if (looksLikeJsonRule(detail)) {
          rowRules.push({ className, rule: detail });
        } else {
          fullRowClasses.push(`${className} · ${detail}`);
        }
      } else {
        summaryParts.push(part);
      }
    }
  }
  return {
    roleName,
    contributors,
    fullRowClasses,
    rowRules,
    summary: summaryParts.length ? summaryParts.join(" · ") : undefined,
  };
}

const orgShareItems = computed<EffectivePermissionOrgShareItem[]>(() => {
  const rows = resolveList(props.orgShares, orgSharesDatum);
  return rows.map((row, index) => {
    const scope = readString(row, "shareScope") ?? (typeof row.title === "string" ? row.title : "") ?? "";
    const recipient = readString(row, "recipient") ?? (typeof row.subtitle === "string" ? row.subtitle : undefined);
    const shareBase = readString(row, "shareBase");
    const coveredOrganizations = readStringList(row, "coveredOrganizations");
    const rawCovered = readField(row, "coveredUsers");
    const coveredUsers = typeof rawCovered === "number" ? rawCovered : undefined;
    const rawRoles = readField(row, "roleContributions");
    const roles = Array.isArray(rawRoles)
      ? rawRoles.map(parseShareRoleContribution).filter((item): item is EffectivePermissionShareRole => item !== null)
      : [];
    const key = typeof row.id === "string" ? row.id : typeof row.primaryKey === "string" ? row.primaryKey : `${scope}:${index}`;
    return { key, scope, recipient, shareBase, coveredOrganizations, coveredUsers, roles };
  });
});

const grantedTargets = computed(() => summaryRecord.value ? [
  ...readStringList(summaryRecord.value, "entryPermissions"),
  ...readStringList(summaryRecord.value, "objectPermissions"),
] : []);

const apiItems = computed<EffectiveManagementOperationItem[]>(() => {
  const rows = resolveList(props.managementOperations, managementOperationsDatum);
  return rows.map((row, index) => {
    const access = readString(row, "access");
    const operationId = readString(row, "id");
    const label = readString(row, "name") ?? operationId ?? String(index + 1);
    return { key: operationId ?? label, access, operationId, label };
  });
});

const apiTotalCount = computed<number>(() => {
  if (apiItems.value.length > 0) return apiItems.value.length;
  const count = summaryRecord.value ? readField(summaryRecord.value, "managementOperationCount") : undefined;
  return typeof count === "number" ? count : 0;
});

const filteredApiItems = computed(() => {
  const query = apiKeyword.value.trim().toLowerCase();
  if (!query) return apiItems.value;
  return apiItems.value.filter(item =>
    [item.access, item.operationId, item.label]
      .some(text => text?.toLowerCase().includes(query)),
  );
});

function parseColumnDetails(raw: unknown): { visible: string[]; groupOnly: string[] } {
  const visible: string[] = [];
  const groupOnly: string[] = [];
  if (!Array.isArray(raw)) return { visible, groupOnly };
  for (const entry of raw) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    const trimmed = entry.trim();
    const level1 = trimmed.indexOf(" · 1 —");
    if (level1 > 0) {
      visible.push(trimmed.slice(0, level1).trim());
      continue;
    }
    const level2 = trimmed.indexOf(" · 2 —");
    if (level2 > 0) {
      groupOnly.push(trimmed.slice(0, level2).trim());
      continue;
    }
    const level0 = trimmed.indexOf(" · 0 —");
    if (level0 > 0) continue;
    visible.push(trimmed);
  }
  return { visible, groupOnly };
}

function parseDataRows(rows: readonly Record<string, unknown>[]): { explanation?: string; items: EffectivePermissionDataRow[] } {
  let explanation: string | undefined;
  const items: EffectivePermissionDataRow[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    if (!explanation) {
      explanation = readString(row, "scopeExplanation");
    }
    const key = typeof row.id === "string" ? row.id : typeof row.primaryKey === "string" ? row.primaryKey : String(index);
    const className = readString(row, "className");
    if (key === "no-rules" && !className) continue;
    const fullData = readField(row, "fullData") === true;
    const fullRows = fullData || readField(row, "fullRows") === true;
    const fullColumns = fullData || readField(row, "fullColumns") === true;
    const rowRulesRaw = readField(row, "rowFilter") ?? readField(row, "rowRules");
    const rowRules = Array.isArray(rowRulesRaw)
      ? rowRulesRaw.filter((rule): rule is string => typeof rule === "string" && rule.trim().length > 0)
      : [];
    const directVisible = readStringList(row, "visibleFields");
    const directGroupOnly = readStringList(row, "groupableColumns");
    const parsedColumns = directVisible.length || directGroupOnly.length
      ? { visible: directVisible, groupOnly: directGroupOnly }
      : parseColumnDetails(readField(row, "columnDetails"));
    const classLabel = readString(row, "classLabel")
      ?? className
      ?? (typeof row.title === "string" ? row.title : key);
    items.push({
      key,
      className: className ?? classLabel,
      classLabel,
      fullRows,
      fullColumns,
      rowRules,
      visibleFields: parsedColumns.visible,
      groupableColumns: parsedColumns.groupOnly,
    });
  }
  return { explanation, items };
}

const hasDataTabs = computed(() =>
  props.subjectData !== undefined
  || props.managedData !== undefined
  || props.effectiveData !== undefined
  || subjectDataDatum !== null
  || managedDataDatum !== null
  || effectiveDataDatum !== null,
);

const dataTabs = computed(() => {
  const specs: Array<{
    name: "subject" | "managed" | "effective";
    label: string;
    parsed: { explanation?: string; items: EffectivePermissionDataRow[] };
  }> = [
    {
      name: "subject",
      label: translate("platform.effectivePermissionsTabSubject", "Personal data permissions"),
      parsed: parseDataRows(resolveList(props.subjectData, subjectDataDatum)),
    },
    {
      name: "managed",
      label: translate("platform.effectivePermissionsTabManaged", "Managed organization data permissions"),
      parsed: parseDataRows(resolveList(props.managedData, managedDataDatum)),
    },
    {
      name: "effective",
      label: translate("platform.effectivePermissionsTabEffective", "Effective data permissions"),
      parsed: parseDataRows(resolveList(props.effectiveData, effectiveDataDatum)),
    },
  ];
  return specs;
});

function formatRule(rule: string): string {
  try {
    return JSON.stringify(JSON.parse(rule), null, 2);
  } catch {
    return rule;
  }
}

const stateLabels = useDataStateLabels();
</script>

<template>
  <div class="sdk-epv">
    <data-state :result="recordState" :labels="stateLabels">
      <template #default>
        <el-descriptions :column="1" border size="small" class="sdk-epv-descriptions">
          <el-descriptions-item :label="translate('platform.effectivePermissionsDirectRoles', 'Direct roles')">
            <div v-if="directRoles.length" class="sdk-epv-tag-list">
              <el-tag v-for="role in directRoles" :key="role" size="small">{{ role }}</el-tag>
            </div>
            <span v-else class="sdk-epv-muted">{{ translate("platform.effectivePermissionsNone", "None") }}</span>
          </el-descriptions-item>

          <el-descriptions-item :label="translate('platform.effectivePermissionsOrgRoles', 'Organization roles')">
            <template v-if="orgRoleGrants.length">
              <div v-for="(grant, index) in orgRoleGrants" :key="index" class="sdk-epv-grant-line">
                <el-tag type="success" size="small">{{ grant.role }}</el-tag>
                <span v-if="grant.recipient" class="sdk-epv-muted">{{ grant.recipient }}</span>
              </div>
            </template>
            <span v-else class="sdk-epv-muted">{{ translate("platform.effectivePermissionsNone", "None") }}</span>
          </el-descriptions-item>

          <el-descriptions-item>
            <template #label>
              <span class="sdk-epv-label-with-help">
                <span>{{ translate("platform.effectivePermissionsSharedData", "Shared data") }}</span>
                <el-tooltip
                  :content="translate('platform.effectivePermissionsSharedDataHint', 'Data scope shared with this member through organization and position grants.')"
                  placement="top-start"
                >
                  <span class="sdk-epv-help-icon" tabindex="0">
                    <component :is="helpIcon" :size="14" aria-hidden="true" />
                  </span>
                </el-tooltip>
              </span>
            </template>
            <template v-if="orgShareItems.length">
              <div v-for="share in orgShareItems" :key="share.key" class="sdk-epv-share-source">
                <div class="sdk-epv-grant-line">
                  <el-tag type="warning" size="small">{{ share.scope }}</el-tag>
                  <span v-if="share.recipient" class="sdk-epv-muted">{{ share.recipient }}</span>
                </div>
                <div
                  v-if="share.shareBase || share.coveredOrganizations.length || share.coveredUsers !== undefined"
                  class="sdk-epv-grant-line sdk-epv-share-coverage"
                >
                  <span v-if="share.shareBase" class="sdk-epv-muted">
                    {{ translate("platform.effectivePermissionsShareBase", `Base: ${share.shareBase}`, { org: share.shareBase }) }}
                  </span>
                  <el-tag
                    v-for="orgName in share.coveredOrganizations"
                    :key="orgName"
                    type="info"
                    size="small"
                  >{{ orgName }}</el-tag>
                  <span v-if="share.coveredUsers !== undefined" class="sdk-epv-muted">
                    {{ translate("platform.effectivePermissionsShareCovered", `Covers ${share.coveredUsers} members`, { n: share.coveredUsers }) }}
                  </span>
                </div>
                <div
                  v-for="(role, roleIndex) in share.roles"
                  :key="roleIndex"
                  class="sdk-epv-grant-line sdk-epv-share-role"
                >
                  <el-tag type="success" size="small">{{ role.roleName }}</el-tag>
                  <span v-if="role.contributors !== undefined" class="sdk-epv-muted">{{ role.contributors }}</span>
                  <el-tag
                    v-for="fullClass in role.fullRowClasses"
                    :key="fullClass"
                    type="warning"
                    size="small"
                  >{{ fullClass }}</el-tag>
                  <el-popover
                    v-for="(rule, ruleIndex) in role.rowRules"
                    :key="ruleIndex"
                    placement="top"
                    :width="520"
                    trigger="click"
                  >
                    <pre class="sdk-epv-rule-code">{{ formatRule(rule.rule) }}</pre>
                    <template #reference>
                      <el-button link type="primary" size="small">
                        {{ rule.className }} · {{ translate("platform.effectivePermissionsRowRule", `Rule ${ruleIndex + 1}`, { n: ruleIndex + 1 }) }}
                      </el-button>
                    </template>
                  </el-popover>
                  <span
                    v-if="role.summary && !role.fullRowClasses?.length && !role.rowRules?.length"
                    class="sdk-epv-muted"
                  >{{ role.summary }}</span>
                </div>
              </div>
            </template>
            <span v-else class="sdk-epv-muted">{{ translate("platform.effectivePermissionsNone", "None") }}</span>
          </el-descriptions-item>

          <el-descriptions-item :label="translate('platform.effectivePermissionsEntryAndObject', 'Entry and object permissions')">
            <div v-if="grantedTargets.length" class="sdk-epv-menu-group">
              <el-tag v-for="target in grantedTargets" :key="target" size="small">{{ target }}</el-tag>
            </div>
            <span v-else class="sdk-epv-muted">{{ translate("platform.effectivePermissionsNone", "None") }}</span>
          </el-descriptions-item>

          <el-descriptions-item :label="translate('platform.effectivePermissionsManagementOperations', 'Management operations')">
            <div class="sdk-epv-api-head">
              <span>{{ translate("platform.effectivePermissionsOperationCount", `${apiTotalCount} operations`, { count: apiTotalCount }) }}</span>
              <el-button
                v-if="apiItems.length > 0"
                link
                type="primary"
                size="small"
                @click="apiExpanded = !apiExpanded"
              >
                {{ apiExpanded
                  ? translate("platform.effectivePermissionsCollapse", "Collapse")
                  : translate("platform.effectivePermissionsExpand", "Expand") }}
              </el-button>
            </div>
            <template v-if="apiExpanded && apiItems.length > 0">
              <el-input
                v-model="apiKeyword"
                size="small"
                clearable
                :placeholder="translate('platform.effectivePermissionsSearchOperations', 'Search operations')"
                class="sdk-epv-api-search"
              />
              <ul class="sdk-epv-api-list">
                <li v-for="api in filteredApiItems" :key="api.key" class="sdk-epv-api-row">
                  <span v-if="api.access" class="sdk-epv-api-method">{{ api.access }}</span>
                  <span class="sdk-epv-api-url">{{ api.label }}</span>
                  <span v-if="api.operationId && api.operationId !== api.label" class="sdk-epv-api-code">{{ api.operationId }}</span>
                </li>
              </ul>
            </template>
          </el-descriptions-item>
        </el-descriptions>

        <el-tabs v-if="hasDataTabs" v-model="activeDataTab" class="sdk-epv-data-tabs">
          <el-tab-pane v-for="tab in dataTabs" :key="tab.name" :name="tab.name" :label="tab.label">
            <el-alert
              v-if="tab.parsed.explanation"
              :title="tab.parsed.explanation"
              type="info"
              :closable="false"
              class="sdk-epv-section-hint"
            />
            <el-table
              v-if="tab.parsed.items.length > 0"
              :data="tab.parsed.items"
              border
              size="small"
              class="sdk-epv-data-table"
            >
              <el-table-column
                :label="translate('platform.effectivePermissionsDataClass', 'Data class')"
                prop="classLabel"
                min-width="160"
              />
              <el-table-column
                :label="translate('platform.effectivePermissionsRowScope', 'Row scope')"
                min-width="180"
              >
                <template #default="{ row }">
                  <div class="sdk-epv-tag-list">
                    <el-tag v-if="row.fullRows" type="warning" size="small">
                      {{ translate("platform.effectivePermissionsAllRows", "All rows") }}
                    </el-tag>
                    <el-popover
                      v-for="(rule, index) in row.rowRules"
                      :key="index"
                      placement="top"
                      :width="520"
                      trigger="click"
                    >
                      <pre class="sdk-epv-rule-code">{{ formatRule(rule) }}</pre>
                      <template #reference>
                        <el-button link type="primary" size="small">
                          {{ translate("platform.effectivePermissionsRowRule", `Rule ${Number(index) + 1}`, { n: Number(index) + 1 }) }}
                        </el-button>
                      </template>
                    </el-popover>
                    <span v-if="!row.fullRows && !row.rowRules.length" class="sdk-epv-muted">
                      {{ translate("platform.effectivePermissionsNone", "None") }}
                    </span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column
                :label="translate('platform.effectivePermissionsColumnScope', 'Column scope')"
                min-width="260"
              >
                <template #default="{ row }">
                  <div class="sdk-epv-tag-list">
                    <el-tag v-if="row.fullColumns" size="small">
                      {{ translate("platform.effectivePermissionsAll", "All") }}
                    </el-tag>
                    <el-tag v-for="field in row.visibleFields" :key="`vis-${field}`" size="small">
                      {{ field }}
                    </el-tag>
                    <el-tag
                      v-for="field in row.groupableColumns"
                      :key="`grp-${field}`"
                      type="warning"
                      size="small"
                    >
                      {{ field }} · {{ translate("platform.effectivePermissionsGroupOnly", "Group only") }}
                    </el-tag>
                    <span
                      v-if="!row.fullColumns && !row.visibleFields.length && !row.groupableColumns.length"
                      class="sdk-epv-muted"
                    >
                      {{ translate("platform.effectivePermissionsNone", "None") }}
                    </span>
                  </div>
                </template>
              </el-table-column>
            </el-table>
            <el-empty
              v-else
              :description="translate('platform.effectivePermissionsNoData', 'No effective data permission rules')"
              :image-size="56"
            />
          </el-tab-pane>
        </el-tabs>
      </template>
    </data-state>
  </div>
</template>

<style scoped>
.sdk-epv {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  min-width: 0;
}
.sdk-epv-descriptions :deep(.el-descriptions__label) {
  width: 1%;
  white-space: nowrap;
}
.sdk-epv-descriptions :deep(.el-descriptions__content) {
  overflow-wrap: anywhere;
}
.sdk-epv :deep(.el-tag) {
  height: auto;
  min-height: 20px;
  line-height: 1.4;
  white-space: normal;
  overflow-wrap: anywhere;
}
.sdk-epv-tag-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.sdk-epv-muted {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.sdk-epv-label-with-help {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.sdk-epv-help-icon {
  display: inline-flex;
  align-items: center;
  color: var(--el-text-color-secondary);
  cursor: help;
}
.sdk-epv-grant-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sdk-epv-grant-line + .sdk-epv-grant-line {
  margin-top: 6px;
}
.sdk-epv-share-source + .sdk-epv-share-source {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--el-border-color-lighter);
}
.sdk-epv-share-coverage,
.sdk-epv-share-role {
  padding-inline-start: var(--spacing-lg);
}
.sdk-epv-menu-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.sdk-epv-menu-group + .sdk-epv-menu-group {
  margin-top: 6px;
}
.sdk-epv-menu-group-name {
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
}
.sdk-epv-api-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}
.sdk-epv-api-search {
  display: block;
  max-width: 320px;
  margin-top: var(--spacing-sm);
}
.sdk-epv-api-list {
  max-height: 240px;
  margin: var(--spacing-sm) 0 0;
  padding: var(--spacing-xs) var(--spacing-sm);
  overflow: auto;
  list-style: none;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.7;
}
.sdk-epv-api-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs);
  padding-block: 2px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}
.sdk-epv-api-row:last-child {
  border-bottom: 0;
}
.sdk-epv-api-method {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 50px;
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: var(--font-medium);
}
.sdk-epv-api-url {
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}
.sdk-epv-api-code {
  margin-inline-start: auto;
  color: var(--el-text-color-secondary);
}
.sdk-epv-data-tabs {
  margin-top: var(--spacing-xs);
}
.sdk-epv-section-hint {
  margin-bottom: var(--spacing-sm);
}
.sdk-epv-rule-code {
  max-height: min(320px, 40vh);
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
</style>
