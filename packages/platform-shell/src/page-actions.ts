import { inject, onBeforeUnmount, provide, shallowRef, watchEffect, type Component, type InjectionKey, type Ref } from "vue";

/**
 * The actions a page shows at the right of the header above it (DESIGN.md "Page architecture"). Any application's page
 * hands them over the same way, and the frame that draws the header reads them; the header only presents them.
 */

/** One of a page's own buttons: refresh, new, delete. */
export interface PlatformPageAction {
  id: string;
  label: string;
  icon?: Component;
  /** The page's main action; a header has at most one besides the draft's Save. */
  primary?: boolean;
  /** A destructive action (delete). */
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick(): void;
}

/**
 * The one draft of a page, saved from the header: without changes the header shows only a disabled Save; with them it
 * shows the unsaved marker, Discard and Save.
 */
export interface PlatformPageDraft {
  readonly dirty: boolean;
  readonly saving: boolean;
  save(): void;
  discard(): void;
}

/** What a page hands to the header it is shown under. */
export interface PlatformPageActions {
  actions?: readonly PlatformPageAction[];
  draft?: PlatformPageDraft | null;
}

const pageActionsKey: InjectionKey<Ref<PlatformPageActions | null>> = Symbol("platform-page-actions");

/**
 * Called by a frame that draws the header of the pages under it (the platform's layout, the super admin console): the
 * page shown under it writes here, and the frame hands what it reads to its header.
 */
export function providePageActions(): Readonly<Ref<PlatformPageActions | null>> {
  const actions = shallowRef<PlatformPageActions | null>(null);
  provide(pageActionsKey, actions);
  return actions;
}

/**
 * Shows a page's actions in its frame's header for as long as the calling component is mounted, and clears them on
 * unmount so the next page starts without them. `actions` is a getter, read reactively, so flags such as `dirty` stay
 * live. A page mounted outside a frame that draws a header has nowhere to show them.
 */
export function usePageActions(actions: () => PlatformPageActions | null) {
  const target = inject(pageActionsKey, null);
  if (!target) return;
  watchEffect(() => (target.value = actions()));
  onBeforeUnmount(() => {
    target.value = null;
  });
}
