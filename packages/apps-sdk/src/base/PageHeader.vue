<script setup lang="ts">
import { computed, useSlots } from "vue";
import { useI18n } from "vue-i18n";
import type { PageHeaderDraft, PageHeaderLabels } from "./page-header-types";

/**
 * Pure presentational page header aligned with the platform's page architecture: optional leading badge/icon, explicit
 * back link, single-line title (plain text or a projection-bound component in `#title`), optional description, flexible
 * right-side actions/controls (`#actions` or default slot), and an optional Save/Discard draft group (`draft`).
 *
 * It asks nothing from the platform host and adapts to its own container width via CSS container queries.
 */
const props = withDefaults(
  defineProps<{
    /** The page's title text; omit when supplying custom content via `#title` or when the header carries only actions. */
    title?: string;
    /** Optional single-line subtitle/description shown beside (compact) or below (expanded) the title. */
    description?: string | null;
    /** Explicit label for the back button (for example "Back to relation types"); omitted hides the back button. */
    backLabel?: string;
    /** Dense single-row layout with bottom hairline (default `true`); set `false` for an expanded hero header. */
    compact?: boolean;
    /** Optional draft controls (unsaved notice, Discard and Save) shown at the right edge of the actions area. */
    draft?: PageHeaderDraft | null;
    /** Optional label overrides for the draft controls; defaults to platform i18n (`platform.save`, `platform.discard`, `platform.unsavedChanges`). */
    labels?: Partial<PageHeaderLabels>;
  }>(),
  {
    title: "",
    description: null,
    backLabel: undefined,
    compact: true,
    draft: null,
    labels: undefined,
  },
);

const emit = defineEmits<{
  /** Fired when the reader clicks the back button. */
  back: [];
  /** Fired when the reader clicks Save on the draft controls. */
  save: [];
  /** Fired when the reader clicks Discard on the draft controls. */
  discard: [];
}>();

defineSlots<{
  /** Optional visual subject placed before the back button and title (for example an avatar or app icon). */
  leading(): unknown;
  /** Optional custom title content (for example a projection-bound component rendering an object's name). */
  title(): unknown;
  /** Optional custom description content replacing the `description` prop. */
  description(): unknown;
  /** Right-side buttons, operation triggers, inline counts, or search inputs. */
  actions(): unknown;
  /** Convenience default slot rendered in the right-side actions area after `#actions` and before draft controls. */
  default(): unknown;
}>();

const slots = useSlots();

const i18n = (() => {
  try {
    return useI18n();
  } catch {
    return null;
  }
})();

function translate(key: string, fallback: string): string {
  if (!i18n) return fallback;
  return i18n.te(key) ? i18n.t(key) : fallback;
}

const resolvedLabels = computed<PageHeaderLabels>(() => ({
  save: props.labels?.save ?? translate("platform.save", "Save"),
  discard: props.labels?.discard ?? translate("platform.discard", "Discard"),
  unsavedChanges: props.labels?.unsavedChanges ?? translate("platform.unsavedChanges", "Unsaved changes"),
}));

const hasTitle = computed(() => Boolean(slots.title || props.title));
const hasDescription = computed(() => Boolean(slots.description || props.description));
const hasHeading = computed(() => Boolean(slots.leading || props.backLabel || hasTitle.value));
const hasActions = computed(() => Boolean(slots.actions || slots.default || props.draft));
const hasContent = computed(() => hasHeading.value || hasDescription.value || hasActions.value);

const draftSaving = computed(() => Boolean(props.draft?.saving));
const draftDirty = computed(() => Boolean(props.draft?.dirty));
const draftCanSave = computed(() => {
  if (!props.draft || draftSaving.value) return false;
  return props.draft.canSave !== undefined ? props.draft.canSave : draftDirty.value;
});

function handleDiscard() {
  if (!draftDirty.value || draftSaving.value) return;
  props.draft?.discard?.();
  emit("discard");
}

function handleSave() {
  if (!draftCanSave.value || draftSaving.value) return;
  props.draft?.save?.();
  emit("save");
}
</script>

<template>
  <header class="sdk-page-header" :class="{ compact }">
    <div v-if="hasContent" class="sdk-page-header-row">
      <div v-if="hasHeading || hasDescription" class="sdk-page-header-text">
        <div v-if="hasHeading" class="sdk-page-header-heading">
          <span v-if="$slots.leading" class="sdk-page-header-leading"><slot name="leading" /></span>
          <button v-if="backLabel" type="button" class="sdk-page-header-back" @click="emit('back')">
            <svg
              class="sdk-page-header-back-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
            <span>{{ backLabel }}</span>
          </button>
          <span v-if="backLabel && hasTitle" class="sdk-page-header-back-divider" aria-hidden="true" />
          <div v-if="$slots.title" class="sdk-page-header-title-slot"><slot name="title" /></div>
          <h1 v-else-if="title" class="sdk-page-header-title">{{ title }}</h1>
        </div>
        <div v-if="$slots.description" class="sdk-page-header-description"><slot name="description" /></div>
        <p v-else-if="description" class="sdk-page-header-description">{{ description }}</p>
      </div>
      <div v-if="hasActions" class="sdk-page-header-actions">
        <slot name="actions" />
        <slot />
        <div v-if="draft" class="sdk-page-header-draft">
          <span v-if="draftDirty" class="sdk-page-header-unsaved" role="status">{{ resolvedLabels.unsavedChanges }}</span>
          <button
            v-if="draftDirty"
            type="button"
            class="sdk-page-header-action secondary"
            :disabled="draftSaving"
            @click="handleDiscard"
          >
            {{ resolvedLabels.discard }}
          </button>
          <button
            type="button"
            class="sdk-page-header-action primary"
            :disabled="!draftCanSave"
            :aria-busy="draftSaving || undefined"
            @click="handleSave"
          >
            <svg
              v-if="draftSaving"
              class="sdk-page-header-spinner"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <span>{{ resolvedLabels.save }}</span>
          </button>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.sdk-page-header {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding-inline: var(--page-gutter);
  padding-top: var(--page-gutter);
  box-sizing: border-box;
  container: sdk-page-header / inline-size;
}

.sdk-page-header-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-lg);
  padding-bottom: var(--spacing-lg);
  min-width: 0;
}

.sdk-page-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 240px;
}

.sdk-page-header-heading {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: var(--spacing-sm);
  min-width: 0;
  max-width: 100%;
}

.sdk-page-header-leading {
  display: inline-flex;
  align-items: center;
  align-self: center;
  flex-shrink: 0;
}

.sdk-page-header-back {
  display: inline-flex;
  align-items: center;
  align-self: center;
  flex-shrink: 0;
  gap: var(--spacing-xs, 4px);
  padding: 0;
  border: 0;
  background: none;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  line-height: var(--leading-sm);
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--transition-fast);
}

.sdk-page-header-back:hover,
.sdk-page-header-back:focus-visible {
  color: var(--el-color-primary);
}

.sdk-page-header-back:focus-visible {
  outline: 2px solid var(--brand-link, var(--el-color-primary));
  outline-offset: 2px;
  border-radius: var(--radius-xs, 4px);
}

.sdk-page-header-back-icon {
  flex: none;
}

.sdk-page-header-back-divider {
  align-self: center;
  flex-shrink: 0;
  width: 1px;
  height: 20px;
  background: var(--el-border-color);
}

.sdk-page-header-title {
  margin: 0;
  min-width: 0;
  max-width: 100%;
  font-size: var(--text-title);
  line-height: var(--leading-title);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
  text-wrap: balance;
}

.sdk-page-header-title-slot {
  display: block;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-title);
  line-height: var(--leading-title);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
}

.sdk-page-header-title-slot :deep(> *) {
  min-width: 0;
  max-width: 100%;
}

.sdk-page-header-title-slot :deep(.sdk-object-header) {
  gap: 0;
  min-width: 0;
  max-width: 100%;
}

.sdk-page-header-title-slot :deep(.sdk-object-header-row),
.sdk-page-header-title-slot :deep(.sdk-object-header-identity),
.sdk-page-header-title-slot :deep(.sdk-object-header-title-line) {
  flex-wrap: nowrap;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  gap: var(--spacing-xs);
}

.sdk-page-header-title-slot :deep(.sdk-object-header-identity) {
  flex: 0 1 auto;
  flex-direction: row;
}

.sdk-page-header-title-slot :deep(h1),
.sdk-page-header-title-slot :deep(h2),
.sdk-page-header-title-slot :deep(h3),
.sdk-page-header-title-slot :deep(.sdk-object-header-title) {
  margin: 0;
  font-size: inherit;
  line-height: inherit;
  font-weight: inherit;
  color: inherit;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-page-header-description {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  color: var(--el-text-color-secondary);
}

.sdk-page-header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--component-gap);
  min-width: 0;
  max-width: 100%;
  padding-top: 2px;
}

.sdk-page-header-actions :deep(.el-button + .el-button) {
  margin-inline-start: 0;
}

.sdk-page-header-actions :deep(.sdk-operation-button) {
  display: inline-flex;
  align-items: center;
}

.sdk-page-header-draft {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--component-gap);
  min-width: 0;
  max-width: 100%;
}

.sdk-page-header-unsaved {
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.sdk-page-header-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--control-height);
  max-width: 100%;
  padding: var(--spacing-xs) var(--spacing-md);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  font-family: var(--font-sans);
  line-height: var(--leading-sm);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
}

.sdk-page-header-action > svg {
  flex: none;
}

.sdk-page-header-action > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.sdk-page-header-action.secondary {
  border: 1px solid var(--el-border-color-dark);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
}

.sdk-page-header-action.secondary:not(:disabled):hover {
  background: var(--el-fill-color-light);
}

.sdk-page-header-action.primary {
  border: 1px solid var(--el-color-primary);
  background: var(--el-color-primary);
  color: var(--on-primary);
}

.sdk-page-header-action.primary:not(:disabled):hover {
  background: var(--brand-primary-hover);
  border-color: var(--brand-primary-hover);
}

.sdk-page-header-action.primary:not(:disabled):active {
  background: var(--el-color-primary-dark-2);
}

.sdk-page-header-action:disabled {
  cursor: not-allowed;
  color: var(--el-disabled-text-color);
  background: var(--el-fill-color-light);
  border-color: var(--el-border-color-light);
}

.sdk-page-header-action:focus-visible {
  outline: 2px solid var(--brand-link, var(--el-color-primary));
  outline-offset: 2px;
}

.sdk-page-header-action[aria-busy="true"] {
  color: var(--el-text-color-secondary);
}

.sdk-page-header-spinner {
  flex: none;
  animation: sdk-page-header-spin 800ms linear infinite;
}

@keyframes sdk-page-header-spin {
  to {
    transform: rotate(1turn);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sdk-page-header-spinner {
    animation: none;
  }
}

/* Compact row matches PlatformPageHeader.compact: dense vertically with a bottom hairline and page-gutter sides. */
.sdk-page-header.compact {
  padding-block: var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color);
}

.sdk-page-header.compact .sdk-page-header-row {
  min-height: var(--control-height);
  align-items: center;
  gap: var(--component-gap) var(--spacing-lg);
  padding: 0;
}

.sdk-page-header.compact .sdk-page-header-text {
  flex: 1 1 180px;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-xs) var(--spacing-md);
}

.sdk-page-header.compact .sdk-page-header-title,
.sdk-page-header.compact .sdk-page-header-title-slot {
  font-size: var(--text-lg);
  line-height: var(--leading-lg);
}

.sdk-page-header.compact .sdk-page-header-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-wrap: nowrap;
}

.sdk-page-header.compact .sdk-page-header-description {
  flex: 1 1 180px;
  min-width: 0;
  line-height: var(--leading-sm);
  overflow-wrap: anywhere;
}

.sdk-page-header.compact .sdk-page-header-actions {
  padding-top: 0;
}

/* Narrow container (such as beside a conversation): stack title and actions cleanly with no horizontal overflow. */
@container sdk-page-header (max-width: 560px) {
  .sdk-page-header-row {
    gap: var(--spacing-sm);
  }

  .sdk-page-header.compact .sdk-page-header-row {
    gap: var(--spacing-sm);
  }

  .sdk-page-header-text,
  .sdk-page-header.compact .sdk-page-header-text {
    flex: 1 1 100%;
  }

  .sdk-page-header-actions {
    flex: 1 1 100%;
  }
}
</style>
