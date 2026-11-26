<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { applicationIconKeys } from "@ontomato/contracts/application-icons";
import type { DashboardMetricOutput } from "@ontomato/contracts/dashboard";
import type { PanelFieldTone, PanelRecordFieldValue } from "@ontomato/contracts/panel-projection";
import { appIcon } from "@ontomato/platform-shell";
import { panelContextKey, projectionKey } from "../panel/context";
import { panelMemberKey } from "../panel/member";
import type { PlatformFieldReference, PlatformObjectRecord } from "../panel/platform-objects";
import { projectionElement } from "../panel/projection-element";
import {
  asTone,
  extractMetricRow,
  useMemberDatumWhenNotGiven,
  type DisplayDataStateKind,
} from "./display-value";
import { resolveLocalizedText } from "./localized-text";
import { displayFieldText, isRecordReference, rawRecordField, toFieldReference } from "./record-field";

const KNOWN_ICONS = new Set<string>(applicationIconKeys);

/**
 * Displays a compact object reference card — leading icon or monogram, optional role caption (such as "Source" or
 * "Target"), localized primary name, secondary monospace API name / identifier, and optional status badge — clickable
 * to navigate to that object's detail entry. Reads a reference field (`field`) or the bound object itself from its
 * `record` (`panelRecord`) or metric `result` (`metricOutput`) datum, or accepts a direct `reference` / `record` prop
 * standalone or inside a slot. Directly composes blocks such as a relationship's "Source card → Target card".
 *
 * One display reads once: a `reference` or `record` handed by a parent is drawn alone and no datum is read; `null` says
 * the parent has nothing yet, `undefined` leaves the read to this card.
 */
const props = withDefaults(
  defineProps<{
    /** Direct object reference (`{ className, primaryKey, label? }`) when used standalone or inside a slot. */
    reference?: PlatformFieldReference | null;
    /** Direct `PlatformObjectRecord` when used standalone or inside a slot. */
    record?: PlatformObjectRecord | null;
    /** Field key holding a `reference` value on `record` (or a reference/identifier column on `result`). */
    field?: string;
    /** Optional small overline caption above the title (for example `"Source"` or `"Target"`). */
    caption?: string;
    /** Panel message key (resolved via `panel.t`) or platform i18n key for `caption`. */
    captionKey?: string;
    /** Explicit primary display name override. */
    title?: string;
    /** Field/column key providing the primary display name when reading from `record` or metric `result`. */
    titleField?: string;
    /** Explicit secondary monospace identifier / API name override. */
    subtitle?: string;
    /** Field/column key providing the secondary identifier (defaults to `reference.primaryKey` or `record.subtitle`). */
    subtitleField?: string;
    /** Optional icon key (platform `appIcon` key or short glyph) shown in the leading badge. */
    icon?: string;
    /** Field/column key providing the icon key from `record` or metric `result`. */
    iconField?: string;
    /** Optional trailing badge text. */
    badge?: string;
    /** Field/column key providing the trailing badge text (inheriting `record.tones[badgeField]`). */
    badgeField?: string;
    /** Visual tone for the trailing badge (`"default" | "info" | "success" | "warning" | "danger"`). */
    badgeTone?: PanelFieldTone;
    /** Field/column key providing the target `className` when reading from a flat metric `result` row. */
    classNameField?: string;
    /** Fallback target `className` when reading a flat primary key from a metric `result` row. */
    targetClassName?: string;
    /** Zero-based row index when reading from a bound metric `result` (`metricOutput`) table. Defaults to `0`. */
    rowIndex?: number;
    /** Visual presentation: `"card"` (default bordered reference card) or `"button"` (action button navigating to the referenced object). */
    appearance?: "card" | "button";
    /** Button visual style when `appearance="button"`: `"default"`, `"primary"`, or `"text"`. */
    buttonType?: "default" | "primary" | "text";
    /** Button height scale when `appearance="button"`: `"default"`, `"small"`, or `"large"`. */
    buttonSize?: "default" | "small" | "large";
    /** Explicit label shown on the button when `appearance="button"` (falls back to the resolved object title). */
    buttonLabel?: string;
    /** Panel message key or platform i18n key for `buttonLabel`. */
    buttonLabelKey?: string;
    /** Whether clicking the card navigates when a target reference is present. Defaults to `true`. */
    clickable?: boolean;
    /** Tighter padding for dense relationship strips and inline cards. Defaults to `false`. */
    compact?: boolean;
    /** Fallback text shown when no reference is available. Defaults to `"—"`. */
    emptyText?: string;
    /** Panel message key or platform i18n key overriding `emptyText`. */
    emptyKey?: string;
  }>(),
  {
    reference: undefined,
    record: undefined,
    field: undefined,
    caption: undefined,
    captionKey: undefined,
    title: undefined,
    titleField: undefined,
    subtitle: undefined,
    subtitleField: undefined,
    icon: undefined,
    iconField: undefined,
    badge: undefined,
    badgeField: undefined,
    badgeTone: undefined,
    classNameField: undefined,
    targetClassName: undefined,
    rowIndex: 0,
    appearance: "card",
    buttonType: "default",
    buttonSize: "default",
    buttonLabel: undefined,
    buttonLabelKey: undefined,
    clickable: true,
    compact: false,
    emptyText: "—",
    emptyKey: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when the reader clicks an interactive object reference card. */
  navigate: [reference: PlatformFieldReference];
}>();

defineSlots<{
  /** Optional custom leading icon or avatar replacing the default icon/monogram badge. */
  leading?(): unknown;
  /** Optional custom trailing content rendered beside or instead of the default navigation chevron. */
  trailing?(): unknown;
}>();

const i18n = (() => {
  try {
    return useI18n();
  } catch {
    return null;
  }
})();
const locale = computed(() => i18n?.locale.value ?? "en");
const translate = (key: string) => (i18n ? i18n.t(key) : key);
const hasTranslation = (key: string) => (i18n ? i18n.te(key) : false);

const panel = inject(panelContextKey, null);
const slot = inject(projectionKey, null);
const memberGetter = inject(panelMemberKey, null);
const member = memberGetter?.() ?? null;
// A reference or record handed by a parent is drawn alone: the parent read the datum, so this component adds no read.
const boundDatum = useMemberDatumWhenNotGiven(
  member,
  ["record", "result"] as const,
  props.reference !== undefined || props.record !== undefined,
);

const projectionObjectType = computed<string | undefined>(() => {
  if (!slot) return undefined;
  try {
    return projectionElement(slot.projection).id;
  } catch {
    return undefined;
  }
});

interface ResolvedCard {
  readonly state: DisplayDataStateKind;
  readonly ref: PlatformFieldReference | null;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: string;
  readonly badge: string;
  readonly badgeTone: PanelFieldTone | undefined;
  readonly notice?: string;
}

function textFromRecord(rec: PlatformObjectRecord | null, key: string | undefined): string {
  if (!rec || !key) return "";
  const raw = rawRecordField(rec, key);
  if (raw === undefined) return "";
  return displayFieldText(raw as PanelRecordFieldValue, locale.value, translate);
}

function textFromRow(row: Readonly<Record<string, unknown>> | null, key: string | undefined): string {
  if (!row || !key || !Object.hasOwn(row, key)) return "";
  const raw = row[key];
  if (raw === undefined || raw === null) return "";
  if (isRecordReference(raw as PanelRecordFieldValue)) return (raw as { label: string; primaryKey: string }).label || (raw as { primaryKey: string }).primaryKey;
  return displayFieldText(raw as PanelRecordFieldValue, locale.value, translate);
}

const resolved = computed<ResolvedCard>(() => {
  const fromRecord = (rec: PlatformObjectRecord, state: DisplayDataStateKind): ResolvedCard => {
    let targetRef: PlatformFieldReference | null = null;
    if (props.field) {
      const raw = rawRecordField(rec, props.field);
      if (isRecordReference(raw)) {
        targetRef = toFieldReference(raw);
      } else if (typeof raw === "string" && raw.trim() && props.targetClassName) {
        targetRef = { className: props.targetClassName, primaryKey: raw.trim(), label: raw.trim() };
      }
    } else {
      const className = rec.className ?? props.targetClassName ?? projectionObjectType.value;
      if (className && rec.primaryKey) {
        targetRef = { className, primaryKey: rec.primaryKey, label: rec.label };
      }
    }
    const title = props.title
      ?? (props.titleField ? textFromRecord(rec, props.titleField) : "")
      ?? "";
    const effectiveTitle = title || targetRef?.label || (!props.field ? rec.label : "") || targetRef?.primaryKey || "";
    const subtitle = props.subtitle
      ?? (props.subtitleField ? textFromRecord(rec, props.subtitleField) : "")
      ?? "";
    const effectiveSubtitle = subtitle || (props.field ? targetRef?.primaryKey ?? "" : rec.subtitle || rec.primaryKey || "");
    const icon = props.icon ?? (props.iconField ? textFromRecord(rec, props.iconField) : "");
    const badge = props.badge ?? (props.badgeField ? textFromRecord(rec, props.badgeField) : "");
    const badgeTone = props.badgeTone ?? (props.badgeField ? asTone(rec.tones?.[props.badgeField]) : undefined);
    return {
      state: effectiveTitle || targetRef ? state : "empty",
      ref: targetRef,
      title: effectiveTitle,
      subtitle: effectiveSubtitle && effectiveSubtitle !== effectiveTitle ? effectiveSubtitle : (props.subtitle ?? (props.subtitleField ? effectiveSubtitle : "")),
      icon,
      badge,
      badgeTone,
    };
  };

  if (props.reference !== undefined) {
    if (!props.reference) {
      return { state: "empty", ref: null, title: "", subtitle: "", icon: props.icon ?? "", badge: props.badge ?? "", badgeTone: props.badgeTone };
    }
    const title = props.title ?? (props.reference.label || props.reference.primaryKey);
    const defaultSub = props.reference.primaryKey !== title ? props.reference.primaryKey : "";
    return {
      state: "standalone",
      ref: props.reference,
      title,
      subtitle: props.subtitle ?? defaultSub,
      icon: props.icon ?? "",
      badge: props.badge ?? "",
      badgeTone: props.badgeTone,
    };
  }

  if (props.record !== undefined) {
    if (!props.record) {
      return { state: "empty", ref: null, title: "", subtitle: "", icon: props.icon ?? "", badge: props.badge ?? "", badgeTone: props.badgeTone };
    }
    return fromRecord(props.record, "standalone");
  }

  if (!boundDatum) {
    const title = props.title ?? "";
    return {
      state: title ? "standalone" : "empty",
      ref: null,
      title,
      subtitle: props.subtitle ?? "",
      icon: props.icon ?? "",
      badge: props.badge ?? "",
      badgeTone: props.badgeTone,
    };
  }

  const current = boundDatum.state.value;
  if (current.status === "loading") {
    return { state: "loading", ref: null, title: "", subtitle: "", icon: "", badge: "", badgeTone: undefined };
  }
  if (current.status === "empty") {
    return { state: "empty", ref: null, title: "", subtitle: "", icon: "", badge: "", badgeTone: undefined };
  }
  if (current.status === "forbidden") {
    return { state: "forbidden", ref: null, title: "", subtitle: "", icon: "", badge: "", badgeTone: undefined, notice: translate("platform.dataForbidden") };
  }
  if (current.status === "awaiting") {
    return { state: "awaiting", ref: null, title: "", subtitle: "", icon: "", badge: "", badgeTone: undefined, notice: translate("platform.dataAwaiting") };
  }
  if (current.status === "error") {
    return {
      state: "error",
      ref: null,
      title: "",
      subtitle: "",
      icon: "",
      badge: "",
      badgeTone: undefined,
      notice: current.message || translate("platform.dataUnreachable"),
    };
  }

  if (boundDatum.name === "result") {
    const output = current.value as unknown as DashboardMetricOutput;
    const row = extractMetricRow(output, props.rowIndex);
    if (!row) {
      return { state: "empty", ref: null, title: "", subtitle: "", icon: "", badge: "", badgeTone: undefined };
    }
    const primaryCol = props.field ?? output.columns[0]?.key;
    const rawPrimary = primaryCol ? row[primaryCol] : undefined;
    let targetRef: PlatformFieldReference | null = null;
    if (isRecordReference(rawPrimary as PanelRecordFieldValue | undefined)) {
      targetRef = toFieldReference(rawPrimary as Extract<PanelRecordFieldValue, { kind: "reference" }>);
    } else if (rawPrimary !== undefined && rawPrimary !== null && String(rawPrimary).trim()) {
      const className = (props.classNameField ? textFromRow(row, props.classNameField) : "") || props.targetClassName;
      if (className) {
        const pk = String(rawPrimary).trim();
        const label = (props.titleField ? textFromRow(row, props.titleField) : "") || pk;
        targetRef = { className, primaryKey: pk, label };
      }
    }
    const title = props.title
      ?? (props.titleField ? textFromRow(row, props.titleField) : "")
      ?? "";
    const effectiveTitle = title || targetRef?.label || (rawPrimary !== undefined && rawPrimary !== null ? String(rawPrimary) : "");
    const subtitle = props.subtitle
      ?? (props.subtitleField ? textFromRow(row, props.subtitleField) : "")
      ?? (targetRef && targetRef.primaryKey !== effectiveTitle ? targetRef.primaryKey : "");
    const icon = props.icon ?? (props.iconField ? textFromRow(row, props.iconField) : "");
    const badge = props.badge ?? (props.badgeField ? textFromRow(row, props.badgeField) : "");
    return {
      state: effectiveTitle || targetRef ? "ready" : "empty",
      ref: targetRef,
      title: effectiveTitle,
      subtitle,
      icon,
      badge,
      badgeTone: props.badgeTone,
    };
  }

  return fromRecord(current.value as unknown as PlatformObjectRecord, "ready");
});

const resolvedCaption = computed(() =>
  resolveLocalizedText({
    key: props.captionKey,
    fallback: props.caption,
    locale: locale.value,
    panelText: panel?.t,
    t: translate,
    te: hasTranslation,
  }),
);

const resolvedEmptyText = computed(() =>
  resolveLocalizedText({
    key: props.emptyKey,
    fallback: props.emptyText,
    locale: locale.value,
    panelText: panel?.t,
    t: translate,
    te: hasTranslation,
  }) || "—",
);

const isInteractive = computed(() =>
  Boolean(props.clickable && resolved.value.ref && (resolved.value.state === "ready" || resolved.value.state === "standalone")),
);

const knownIconComponent = computed(() => {
  const key = resolved.value.icon;
  return key && KNOWN_ICONS.has(key) ? appIcon(key) : null;
});

const monogram = computed(() => {
  const icon = resolved.value.icon.trim();
  if (icon && !knownIconComponent.value) return icon.slice(0, 2);
  const title = resolved.value.title.trim();
  if (!title) return "•";
  return title.slice(0, 1).toUpperCase();
});

const resolvedButtonLabel = computed(() => {
  const custom = resolveLocalizedText({
    key: props.buttonLabelKey,
    fallback: props.buttonLabel,
    locale: locale.value,
    panelText: panel?.t,
    t: translate,
    te: hasTranslation,
  });
  return custom || resolved.value.title || resolvedEmptyText.value;
});

function handleClick() {
  if (!isInteractive.value || !resolved.value.ref) return;
  const reference = resolved.value.ref;
  if (panel && slot) {
    const fieldKey = props.field;
    const output = fieldKey && panel.manifest.members[slot.slot]?.outputs?.[fieldKey] ? fieldKey : "navigate";
    if (panel.manifest.members[slot.slot]?.outputs?.[output]) {
      void panel.instance.output(slot.slot, output, {
        className: reference.className,
        primaryKey: reference.primaryKey,
      });
    }
  }
  emit("navigate", reference);
}
</script>

<template>
  <button
    v-if="appearance === 'button'"
    type="button"
    class="sdk-object-ref-button"
    :class="[`is-${buttonType}`, `is-size-${buttonSize}`, { 'is-interactive': isInteractive }]"
    :disabled="!isInteractive"
    :data-state="resolved.state"
    :title="resolved.notice || resolved.title || undefined"
    :aria-busy="resolved.state === 'loading' ? 'true' : undefined"
    @click="handleClick"
  >
    <span v-if="$slots.leading || knownIconComponent" class="sdk-object-ref-button-icon" aria-hidden="true">
      <slot name="leading">
        <component :is="knownIconComponent" v-if="knownIconComponent" :size="14" />
      </slot>
    </span>
    <span class="sdk-object-ref-button-label">{{ resolved.state === 'loading' ? '…' : resolvedButtonLabel }}</span>
    <slot name="trailing" />
  </button>

  <component
    :is="isInteractive ? 'button' : 'div'"
    v-else
    :type="isInteractive ? 'button' : undefined"
    class="sdk-object-ref-card"
    :class="{ 'is-interactive': isInteractive, 'is-compact': compact }"
    :data-state="resolved.state"
    :title="resolved.notice"
    :aria-busy="resolved.state === 'loading' ? 'true' : undefined"
    @click="handleClick"
  >
    <span class="sdk-object-ref-card-leading" aria-hidden="true">
      <slot name="leading">
        <component :is="knownIconComponent" v-if="knownIconComponent" :size="16" />
        <span v-else class="sdk-object-ref-card-monogram">{{ monogram }}</span>
      </slot>
    </span>

    <span class="sdk-object-ref-card-body">
      <span v-if="resolvedCaption" class="sdk-object-ref-card-caption">{{ resolvedCaption }}</span>
      <span v-if="resolved.state === 'loading'" class="sdk-object-ref-card-muted">…</span>
      <span
        v-else-if="resolved.state === 'forbidden' || resolved.state === 'error' || resolved.state === 'awaiting'"
        class="sdk-object-ref-card-muted"
      >—</span>
      <span v-else-if="resolved.state === 'empty'" class="sdk-object-ref-card-muted">{{ resolvedEmptyText }}</span>
      <template v-else>
        <span class="sdk-object-ref-card-title">{{ resolved.title }}</span>
        <span v-if="resolved.subtitle" class="sdk-object-ref-card-subtitle">{{ resolved.subtitle }}</span>
      </template>
    </span>

    <span v-if="resolved.badge || $slots.trailing || isInteractive" class="sdk-object-ref-card-trailing">
      <span
        v-if="resolved.badge"
        class="sdk-object-ref-card-badge"
        :data-tone="resolved.badgeTone ?? 'default'"
      >{{ resolved.badge }}</span>
      <slot name="trailing">
        <svg
          v-if="isInteractive"
          class="sdk-object-ref-card-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </slot>
    </span>
  </component>
</template>

<style scoped>
.sdk-object-ref-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--control-height, 32px);
  padding: 0 14px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm, 6px);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-family: var(--font-sans);
  font-size: var(--text-sm, 13px);
  font-weight: var(--font-medium, 500);
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
}

.sdk-object-ref-button.is-size-small {
  min-height: 26px;
  padding: 0 10px;
  font-size: var(--text-xs, 12px);
}

.sdk-object-ref-button.is-size-large {
  min-height: 38px;
  padding: 0 18px;
  font-size: var(--text-base, 14px);
}

.sdk-object-ref-button.is-default:hover:not(:disabled) {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.sdk-object-ref-button.is-primary {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary);
  color: #fff;
}

.sdk-object-ref-button.is-primary:hover:not(:disabled) {
  border-color: var(--el-color-primary-light-3);
  background: var(--el-color-primary-light-3);
}

.sdk-object-ref-button.is-text {
  border-color: transparent;
  background: transparent;
  color: var(--el-color-primary);
  padding: 0 6px;
}

.sdk-object-ref-button.is-text:hover:not(:disabled) {
  background: var(--el-color-primary-light-9);
}

.sdk-object-ref-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.sdk-object-ref-button-icon {
  display: inline-flex;
  align-items: center;
  flex: none;
}

.sdk-object-ref-card {
  container: sdk-object-ref-card / inline-size;
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  width: 100%;
  min-width: 0;
  padding: var(--spacing-md);
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-family: var(--font-sans);
  text-align: start;
  box-sizing: border-box;
  transition: background-color var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.sdk-object-ref-card.is-compact {
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
}

.sdk-object-ref-card.is-interactive {
  cursor: pointer;
}

.sdk-object-ref-card.is-interactive:hover {
  border-color: var(--ui-border);
  background: var(--ui-fill-tertiary);
}

.sdk-object-ref-card.is-interactive:focus-visible {
  outline: none;
  border-color: var(--brand-link, var(--el-color-primary));
  box-shadow: var(--focus-ring);
}

.sdk-object-ref-card-leading {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--ui-fill-tertiary);
  color: var(--brand-link, var(--el-color-primary));
}

.sdk-object-ref-card.is-compact .sdk-object-ref-card-leading {
  width: 28px;
  height: 28px;
}

.sdk-object-ref-card-monogram {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  line-height: 1;
}

.sdk-object-ref-card-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sdk-object-ref-card-caption {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}

.sdk-object-ref-card-title {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  line-height: var(--leading-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-object-ref-card-subtitle {
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-object-ref-card-muted {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}

.sdk-object-ref-card-trailing {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--spacing-xs);
}

.sdk-object-ref-card-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--spacing-xs);
  border-radius: var(--radius-xs);
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-regular);
  font-size: var(--text-xs);
  line-height: var(--leading-sm);
  white-space: nowrap;
}

.sdk-object-ref-card-badge[data-tone="info"] {
  background: var(--el-color-info-light-9);
  color: var(--el-color-info-text);
}

.sdk-object-ref-card-badge[data-tone="success"] {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-text);
}

.sdk-object-ref-card-badge[data-tone="warning"] {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-text);
}

.sdk-object-ref-card-badge[data-tone="danger"] {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-text);
}

.sdk-object-ref-card-chevron {
  color: var(--el-text-color-secondary);
  transition: transform var(--transition-fast), color var(--transition-fast);
}

.sdk-object-ref-card.is-interactive:hover .sdk-object-ref-card-chevron {
  color: var(--el-text-color-primary);
  transform: translateX(2px);
}
</style>
