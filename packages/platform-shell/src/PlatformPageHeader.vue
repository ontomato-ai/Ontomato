<script setup lang="ts">
import type { PlatformPageAction, PlatformPageDraft } from "./page-actions";
import { ElTooltip } from "element-plus";
import { computed, ref, watch } from "vue";
import { ArrowLeft, LoaderCircle, MoreHorizontal } from "lucide-vue-next";
import { actionTooltipProps } from "@ontomato/foundation-ui/overlay";

/**
 * The one page header every page of the platform uses (DESIGN.md "Page architecture"): one row in the page gutter, the
 * page's name with one line of description after it on the left, the page's own actions on the right. The application's
 * name is not here: it heads the application's own column.
 *
 * A page holding a draft saves it here: without changes only a disabled Save shows; with changes the unsaved marker,
 * Discard and Save. A page either shows under a frame that draws this header for it, or draws it itself; never both.
 *
 * Header command rules (unified page paradigm): at most one non-danger action renders as the primary button (the first
 * declared `primary: true` keeps primary emphasis; any further primary flags degrade to secondary); all destructive
 * (`danger`) actions move into the "more" menu at the very end after a divider; and the "more" button carries a
 * page-scoped accessible name (`{title} {moreLabel}` when a page title is present).
 */
const props = withDefaults(
  defineProps<{
    /** The page's title; absent on a header that only carries actions. */
    title?: string;
    description?: string | null;
    /** Dense technical pages keep the shared title/actions in a single compact row. */
    compact?: boolean;
    /** The page's own buttons at the right of the title row. */
    actions?: readonly PlatformPageAction[];
    /** The one Save of a page holding a draft, with its unsaved marker. */
    draft?: PlatformPageDraft | null;
    /** The header's own words, from the host's i18n; read only by the draft's Save and its unsaved marker. */
    labels?: { save: string; discard: string; unsavedChanges: string; more?: string };
    /** The way back, named, for a page the reader reached from elsewhere; absent for a page its menu reaches. */
    backLabel?: string;
    /** What the header's "more" holds (the entry's external link): items of the host's, behind one button. */
    more?: readonly PlatformPageAction[];
    /** The "more" button's accessible name. */
    moreLabel?: string;
  }>(),
  {
    title: "",
    description: null,
    compact: true,
    actions: undefined,
    draft: null,
    labels: () => ({ save: "", discard: "", unsavedChanges: "" }),
    backLabel: undefined,
    more: () => [],
    moreLabel: "",
  },
);

function isIconTool(action: PlatformPageAction): boolean {
  return Boolean(action.iconOnly && action.icon && !action.primary && !action.danger);
}

const partitionedActions = computed(() => {
  const list = props.actions ?? [];
  const visible: { action: PlatformPageAction; primary: boolean }[] = [];
  const dangerFromActions: PlatformPageAction[] = [];
  let primaryAssigned = false;

  for (const action of list) {
    if (action.danger && !action.inline) {
      dangerFromActions.push(action);
      continue;
    }
    const isPrimary = !isIconTool(action) && !action.danger && action.primary === true && !primaryAssigned;
    if (isPrimary) primaryAssigned = true;
    visible.push({ action, primary: isPrimary });
  }

  const moreRegular = props.more.filter((action) => !action.danger);
  const moreDanger = [...dangerFromActions, ...props.more.filter((action) => action.danger)];

  return { visible, moreRegular, moreDanger };
});

const hasMore = computed(
  () => partitionedActions.value.moreRegular.length > 0 || partitionedActions.value.moreDanger.length > 0,
);
const baseMoreLabel = computed(() => props.moreLabel || props.labels.more || "More");
const effectiveMoreLabel = computed(() => {
  const title = props.title?.trim();
  const base = baseMoreLabel.value.trim();
  if (!title) return base;
  return base.includes(title) ? base : `${title} ${base}`;
});

const emit = defineEmits<{ back: []; discard: []; save: [] }>();
const moreOpen = ref(false);
const moreContainer = ref<HTMLElement | null>(null);
const moreTrigger = ref<HTMLButtonElement | null>(null);

function closeMore(restoreFocus = false) {
  if (!moreOpen.value) return;
  moreOpen.value = false;
  if (restoreFocus) moreTrigger.value?.focus();
}

function pick(action: PlatformPageAction) {
  if (action.disabled || action.loading) return;
  moreOpen.value = false;
  action.onClick();
}

watch(hasMore, (available) => {
  if (!available) moreOpen.value = false;
});

watch(moreOpen, (open, _previous, onCleanup) => {
  if (!open) return;
  const onOutsidePointer = (event: Event) => {
    if (moreContainer.value && !moreContainer.value.contains(event.target as Node)) closeMore();
  };
  const onOutsideFocus = (event: FocusEvent) => {
    if (moreContainer.value && !moreContainer.value.contains(event.target as Node)) closeMore();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMore(true);
    }
  };
  document.addEventListener("pointerdown", onOutsidePointer);
  document.addEventListener("focusin", onOutsideFocus);
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => {
    document.removeEventListener("pointerdown", onOutsidePointer);
    document.removeEventListener("focusin", onOutsideFocus);
    document.removeEventListener("keydown", onKeyDown);
  });
});
</script>

<template>
  <header class="platform-page-header platform-page-gutter" :class="{ compact }">
    <div v-if="title || description || partitionedActions.visible.length || draft || hasMore || $slots.actions" class="header-row">
      <div class="header-text">
        <!-- What stands for the page's subject before its name (an agent's avatar). -->
        <span v-if="$slots.leading" class="header-leading"><slot name="leading" /></span>
        <button v-if="backLabel" type="button" class="page-back" @click="emit('back')">
          <ArrowLeft :size="16" aria-hidden="true" /><span>{{ backLabel }}</span>
        </button>
        <span v-if="backLabel && title" class="page-back-divider" aria-hidden="true" />
        <h1 v-if="title" class="page-title">{{ title }}</h1>
        <p v-if="description" class="page-description">{{ description }}</p>
      </div>
      <div v-if="partitionedActions.visible.length || draft || hasMore || $slots.actions" class="page-actions">
        <span v-if="draft?.dirty" class="unsaved" role="status">{{ labels.unsavedChanges }}</span>
        <!-- A page's own buttons, when it hands over markup rather than a list of actions. -->
        <slot name="actions" />
        <template v-for="{ action, primary } in partitionedActions.visible" :key="action.id">
          <ElTooltip
            v-if="isIconTool(action)"
            :content="action.label"
            v-bind="actionTooltipProps"
          >
            <button type="button" class="action secondary icon-action" :aria-label="action.label"
              :disabled="action.disabled || action.loading" :aria-busy="action.loading || undefined" @click="action.onClick()">
              <LoaderCircle v-if="action.loading" class="action-spinner" :size="16" aria-hidden="true" />
              <component v-else :is="action.icon" :size="16" aria-hidden="true" />
            </button>
          </ElTooltip>
          <button
            v-else
            type="button"
            class="action"
            :class="action.danger ? 'danger' : primary ? 'primary' : 'secondary'"
            :disabled="action.disabled || action.loading"
            :aria-busy="action.loading || undefined"
            @click="action.onClick()"
          >
            <LoaderCircle v-if="action.loading" class="action-spinner" :size="16" aria-hidden="true" />
            <component v-else-if="action.icon" :is="action.icon" :size="16" aria-hidden="true" />
            <span>{{ action.label }}</span>
          </button>
        </template>
        <div v-if="hasMore" ref="moreContainer" class="page-more">
          <button
            ref="moreTrigger"
            type="button"
            class="action secondary icon-action"
            :aria-label="effectiveMoreLabel"
            :title="effectiveMoreLabel"
            aria-haspopup="menu"
            :aria-expanded="moreOpen"
            @click="moreOpen = !moreOpen"
          >
            <MoreHorizontal :size="16" aria-hidden="true" />
          </button>
          <div v-if="moreOpen" class="page-more-menu" role="menu">
            <button
              v-for="action in partitionedActions.moreRegular"
              :key="action.id"
              type="button"
              role="menuitem"
              class="page-more-item"
              :disabled="action.disabled || action.loading"
              :aria-busy="action.loading || undefined"
              @click="pick(action)"
            >
              <LoaderCircle v-if="action.loading" class="action-spinner" :size="16" aria-hidden="true" />
              <component :is="action.icon" v-else-if="action.icon" :size="16" aria-hidden="true" />
              <span>{{ action.label }}</span>
            </button>
            <div
              v-if="partitionedActions.moreRegular.length && partitionedActions.moreDanger.length"
              role="separator"
              class="page-more-divider"
            />
            <button
              v-for="action in partitionedActions.moreDanger"
              :key="action.id"
              type="button"
              role="menuitem"
              class="page-more-item danger"
              :disabled="action.disabled || action.loading"
              :aria-busy="action.loading || undefined"
              @click="pick(action)"
            >
              <LoaderCircle v-if="action.loading" class="action-spinner" :size="16" aria-hidden="true" />
              <component :is="action.icon" v-else-if="action.icon" :size="16" aria-hidden="true" />
              <span>{{ action.label }}</span>
            </button>
          </div>
        </div>
        <button
          v-if="draft?.dirty"
          type="button"
          class="action secondary"
          :disabled="draft.saving"
          @click="emit('discard')"
        >
          {{ labels.discard }}
        </button>
        <button
          v-if="draft"
          type="button"
          class="action primary"
          :disabled="!draft.dirty || draft.saving"
          :aria-busy="draft.saving || undefined"
          @click="emit('save')"
        >
          <LoaderCircle v-if="draft.saving" class="action-spinner" :size="16" aria-hidden="true" />
          {{ labels.save }}
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.page-more { position: relative; }
.page-more-menu {
  position: absolute;
  inset-block-start: calc(100% + 4px);
  inset-inline-end: 0;
  z-index: 10;
  min-inline-size: 180px;
  padding: 4px;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay, var(--el-bg-color));
  box-shadow: var(--el-box-shadow-light);
}
.page-more-item {
  display: flex;
  align-items: center;
  gap: 8px;
  inline-size: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--el-text-color-primary);
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.page-more-item:disabled {
  cursor: not-allowed;
  color: var(--el-disabled-text-color);
}
.page-more-item:not(:disabled):hover,
.page-more-item:not(:disabled):focus-visible {
  background: var(--el-fill-color-light);
}
.page-more-item.danger {
  color: var(--el-color-danger);
}
.page-more-item.danger:not(:disabled):hover,
.page-more-item.danger:not(:disabled):focus-visible {
  background: var(--el-color-danger-light-9);
}
.page-more-divider {
  margin: 4px 0;
  border-top: 1px solid var(--ui-divider);
}
/*
 * One header for every page: the title and its description in one block, actions at the right (DESIGN.md "Page
 * architecture"). Its side padding is the page gutter (`platform-page-gutter`), the one the content
 * under it takes too, so a title and the content start at the same place.
 */
.platform-page-header {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding-top: var(--page-gutter);
  box-sizing: border-box;
  container: page-header / inline-size;
}
.header-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-lg);
  padding-bottom: var(--spacing-lg);
}
.header-text {
  min-width: 0;
  flex: 1 1 240px;
}
.page-title {
  margin: 0 0 2px;
  font-size: var(--text-title);
  line-height: var(--leading-title);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
  text-wrap: balance;
}
.page-description {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  color: var(--el-text-color-secondary);
}
.header-leading {
  display: inline-flex;
  align-self: center;
  flex-shrink: 0;
}
/* The way back sits before the title it leads away from, as quiet as a link. */
.page-back {
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
  cursor: pointer;
}
.page-back:hover,
.page-back:focus-visible {
  color: var(--el-color-primary);
}
.page-back-divider {
  align-self: center;
  flex-shrink: 0;
  width: 1px;
  height: 20px;
  background: var(--el-border-color);
}
.page-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--component-gap);
  min-width: 0;
  max-width: 100%;
  padding-top: 2px;
}
.unsaved {
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
}
.action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--control-height);
  max-width: 100%;
  padding: var(--spacing-xs) var(--spacing-md);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  font-family: var(--font-sans);
  line-height: var(--leading-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
}
.action > svg { flex: none; }
.action > span { min-width: 0; overflow-wrap: anywhere; }
.action.secondary {
  border: 1px solid var(--el-border-color-dark);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
}
.action.icon-action {
  justify-content: center;
  width: var(--control-height);
  padding: 0;
  border-color: transparent;
  background: transparent;
  color: var(--el-text-color-secondary);
}
.action.icon-action:disabled { color: var(--el-disabled-text-color); }
.action.primary {
  border: 1px solid var(--el-color-primary);
  background: var(--el-color-primary);
  color: var(--on-primary);
}
.action.secondary:not(:disabled):hover {
  background: var(--el-fill-color-light);
}
.action.primary:not(:disabled):hover {
  background: var(--brand-primary-hover);
  border-color: var(--brand-primary-hover);
}
.action.primary:not(:disabled):active {
  background: var(--el-color-primary-dark-2);
}
.action.danger {
  border: 1px solid var(--el-color-danger-light-5, var(--el-color-danger));
  background: var(--el-color-danger-light-9, var(--el-bg-color));
  color: var(--el-color-danger);
}
.action.danger:not(:disabled):hover {
  border-color: var(--el-color-danger);
  background: var(--el-color-danger);
  color: var(--on-primary, #fff);
}
.action:disabled {
  cursor: not-allowed;
  color: var(--el-disabled-text-color);
  background: var(--el-fill-color-light);
  border-color: var(--el-border-color-light);
}
.action:focus-visible {
  outline: 2px solid var(--brand-link, var(--el-color-primary));
  outline-offset: 2px;
}
.action[aria-busy="true"] { color: var(--el-text-color-secondary); }
.action-spinner { flex: none; animation: page-action-spin 800ms linear infinite; }
@keyframes page-action-spin { to { transform: rotate(1turn); } }
@media (prefers-reduced-motion: reduce) { .action-spinner { animation: none; } }
/* The compact row is denser only vertically: its sides are the page gutter, like every header's and the content's. */
.platform-page-header.compact {
  padding-block: var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color);
}
.compact .header-row {
  min-height: var(--control-height);
  align-items: center;
  gap: var(--component-gap) var(--spacing-lg);
  padding: 0;
}
.compact .header-text {
  flex: 1 1 160px;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--spacing-xs) var(--spacing-md);
}
.compact .page-title {
  margin: 0;
  font-size: var(--text-lg);
  line-height: var(--leading-lg);
  text-wrap: wrap;
  overflow-wrap: anywhere;
}
.compact .page-description {
  flex: 1 1 180px;
  min-width: 0;
  line-height: var(--leading-sm);
  overflow-wrap: anywhere;
}
.compact .page-actions {
  padding-top: 0;
  gap: var(--component-gap);
}
.page-actions :deep(.el-button + .el-button) {
  margin-inline-start: 0;
}
</style>
