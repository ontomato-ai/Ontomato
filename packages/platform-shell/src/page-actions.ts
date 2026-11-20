import { inject, onBeforeUnmount, provide, shallowRef, watchEffect, type Component, type InjectionKey, type Ref } from "vue";
import type { PanelOperation } from "@ontomato/contracts/panel-manifest";

/**
 * The actions a page shows at the right of the header above it (DESIGN.md "Page architecture"). Any application's page
 * hands them over the same way, and the frame that draws the header reads them; the header only presents them.
 *
 * There are two ways a page names an action, and they are the same fact:
 *
 * - a `PanelOperation` (a panel's or one of its projections'), described by ID, kind, target and inputs, with the handler
 *   this frame would run. An agent reads that description and calls the same operation, so a page never keeps a second
 *   "similar command" for a person and one for an agent;
 * - a plain `PlatformPageAction` with its own `onClick`, for a page that has not been made a panel yet.
 *
 * Either way the header draws the same row, and a person's click runs in this frame with the person's own credential.
 */

/** One of a page's own buttons: refresh, new, delete. */
export interface PlatformPageAction {
  id: string;
  label: string;
  icon?: Component;
  /** Compact tools keep their accessible label and tooltip without visible text. */
  iconOnly?: boolean;
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
  /**
   * The operations this page offers, described for an agent and runnable here. A `form.save` operation is shown as the
   * header's Save; other operations are buttons in `actions` order, so a panel's own declaration decides what appears.
   */
  operations?: readonly PanelOperationAction[];
  draft?: PlatformPageDraft | null;
}

/** One operation a page offers, with the handler this frame would run when a person clicks it. */
export interface PanelOperationAction extends PanelOperation {
  /** Whether a click is refused now (nothing selected, a request in flight). */
  disabled?: boolean;
  icon?: Component;
  /** Whether the header shows it as the page's main action. */
  primary?: boolean;
  danger?: boolean;
  /** Runs the operation here, as the signed-in person. An agent's call is made by the platform's coordinator instead. */
  invoke(input?: Readonly<Record<string, unknown>>): Promise<unknown>;
}

/** The operations as the header draws them: a Save from the page's draft or its save operation, the rest as buttons. */
export function pageActionRow(actions: PlatformPageActions | null): readonly PlatformPageAction[] {
  if (!actions) return [];
  const operations = (actions.operations ?? []).filter((operation) => operation.kind !== "form.save");
  return [
    ...(actions.actions ?? []),
    ...operations.map((operation) => ({
      id: operation.id,
      label: operation.label,
      icon: operation.icon,
      primary: operation.primary,
      danger: operation.danger,
      disabled: operation.disabled,
      onClick: () => void operation.invoke(),
    })),
  ];
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
