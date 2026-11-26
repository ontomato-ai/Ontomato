import {
  computed,
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  provide,
  ref,
  watch,
  type Component,
  type PropType,
  type Slots,
} from "vue";
import { useI18n } from "vue-i18n";
import { confirmDanger } from "@ontomato/platform-shell";
import { overlayFormScopeKey, panelContextKey, type OverlayFormScope } from "../panel/context";
import type { PanelFormAdapters } from "../panel/forms";

export type OverlayBeforeCloseDone = (cancel?: boolean) => void;
export type OverlayBeforeClose = (done: OverlayBeforeCloseDone) => void;

interface InnerOverlayInstance {
  visible?: boolean;
  dialogContentRef?: unknown;
  resetPosition?: () => void;
  handleClose?: () => void;
  afterEnter?: () => void;
  afterLeave?: () => void;
}

interface RegisteredFormEntry {
  readonly slot: string;
  readonly forms: PanelFormAdapters | null;
}

function forwardSlots(slots: Slots): Record<string, (...args: unknown[]) => unknown> {
  const forwarded: Record<string, (...args: unknown[]) => unknown> = {};
  for (const name of Object.keys(slots)) {
    const slot = slots[name];
    if (typeof slot === "function") forwarded[name] = (...args) => slot(...args);
  }
  return forwarded;
}

function invokeForwardedListener(listener: unknown, args: unknown[]): void {
  if (typeof listener === "function") {
    listener(...args);
  } else if (Array.isArray(listener)) {
    for (const item of listener) {
      if (typeof item === "function") item(...args);
    }
  }
}

/**
 * Wraps an Element Plus overlay (`ElDialog` or `ElDrawer`) with an overlay-scoped unsaved-changes guard.
 *
 * Any form registered via `useProjectionForm` inside the overlay registers its slot into this overlay's scope. When the
 * user closes the overlay via the close button, backdrop click, Escape key, `#header`'s `close` helper, or
 * `handleClose()`, the guard runs inside `beforeClose` before Element Plus hides or destroys the subtree:
 * - Keeping edits cancels the close with the overlay and form state intact.
 * - Discarding clears only the dirty forms owned by this overlay before invoking any caller-supplied `beforeClose` and
 *   allowing the overlay to close.
 *
 * Outside a `panelContextKey`, the wrapper transparently degrades to the underlying overlay component.
 */
export function createSdkOverlay<T extends Component>(options: {
  readonly name: string;
  readonly target: T;
  readonly kind: "dialog" | "drawer";
}): T {
  const component = defineComponent({
    name: options.name,
    inheritAttrs: false,
    props: {
      beforeClose: {
        type: Function as PropType<OverlayBeforeClose>,
        default: undefined,
      },
    },
    setup(props, { attrs, slots, expose }) {
      const panel = inject(panelContextKey, null);
      const parentScope = inject(overlayFormScopeKey, null);
      const innerRef = ref<InnerOverlayInstance | null>(null);
      const entries = new Set<RegisteredFormEntry>();
      let unmounted = false;
      let guardPending = false;
      let previousActiveElement: HTMLElement | null = null;

      function captureTriggerFocus(): void {
        if (typeof document === "undefined") return;
        const active = document.activeElement;
        previousActiveElement = active instanceof HTMLElement && active !== document.body && active.isConnected
          ? active
          : null;
      }

      function restoreTriggerFocus(): void {
        const trigger = previousActiveElement;
        previousActiveElement = null;
        if (trigger && trigger.isConnected && typeof trigger.focus === "function") {
          trigger.focus();
        }
      }

      const isOpen = computed(() => Boolean(attrs.modelValue ?? attrs["model-value"]));
      watch(
        isOpen,
        (open, prev) => {
          if (open && !prev) {
            captureTriggerFocus();
          }
        },
        { immediate: true, flush: "sync" },
      );

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

      const scope: OverlayFormScope = {
        register(slot: string, forms?: PanelFormAdapters): () => void {
          const entry: RegisteredFormEntry = { slot, forms: forms ?? null };
          entries.add(entry);
          const unregisterParent = parentScope?.register(slot, forms);
          let active = true;
          return () => {
            if (!active) return;
            active = false;
            entries.delete(entry);
            unregisterParent?.();
          };
        },
      };
      provide(overlayFormScopeKey, scope);

      onBeforeUnmount(() => {
        unmounted = true;
        previousActiveElement = null;
      });

      function collectScopedForms(): Map<PanelFormAdapters, string[]> {
        const byRegistry = new Map<PanelFormAdapters, Set<string>>();
        for (const entry of entries) {
          const registry = entry.forms ?? panel?.instance.forms ?? null;
          if (!registry) continue;
          let slotSet = byRegistry.get(registry);
          if (!slotSet) {
            slotSet = new Set<string>();
            byRegistry.set(registry, slotSet);
          }
          slotSet.add(entry.slot);
        }
        const grouped = new Map<PanelFormAdapters, string[]>();
        for (const [registry, slotSet] of byRegistry) {
          if (slotSet.size > 0) grouped.set(registry, [...slotSet]);
        }
        return grouped;
      }

      function hasDirtyForms(): boolean {
        for (const [registry, slotList] of collectScopedForms()) {
          if (registry.dirty(slotList)) return true;
        }
        return false;
      }

      function discardScopedForms(): void {
        for (const [registry, slotList] of collectScopedForms()) {
          registry.discardAll(slotList);
        }
      }

      function proceedClose(done: OverlayBeforeCloseDone): void {
        if (props.beforeClose) {
          props.beforeClose(done);
        } else {
          done();
        }
      }

      function askLeaveUnsaved(): Promise<boolean> {
        if (panel?.confirmLeaveUnsaved) {
          return panel.confirmLeaveUnsaved();
        }
        return confirmDanger(
          translate(
            "platform.formLeaveUnsaved",
            "This form has changes you have not saved. Discard them and leave?",
          ),
          translate("platform.unsavedChanges", "Unsaved changes"),
          {
            confirmButtonText: translate("platform.discard", "Discard"),
            cancelButtonText: translate("platform.keepEditing", "Keep editing"),
            ...(panel?.overlayRoot?.isConnected ? { appendTo: panel.overlayRoot } : {}),
          },
        );
      }

      function handleBeforeClose(done: OverlayBeforeCloseDone): void {
        if (guardPending) return;
        if (!panel || !hasDirtyForms()) {
          proceedClose(done);
          return;
        }
        guardPending = true;
        void (async () => {
          try {
            const leave = await askLeaveUnsaved();
            if (unmounted || !leave) return;
            discardScopedForms();
            proceedClose(done);
          } catch {
            // Treat a rejected confirmation prompt as cancelling the close.
          } finally {
            guardPending = false;
          }
        })();
      }

      if (options.kind === "dialog") {
        expose({
          visible: computed(() => innerRef.value?.visible ?? false),
          dialogContentRef: computed(() => innerRef.value?.dialogContentRef),
          resetPosition: () => innerRef.value?.resetPosition?.(),
          handleClose: () => innerRef.value?.handleClose?.(),
        });
      } else {
        expose({
          handleClose: () => innerRef.value?.handleClose?.(),
          afterEnter: () => innerRef.value?.afterEnter?.(),
          afterLeave: () => innerRef.value?.afterLeave?.(),
        });
      }

      return () => {
        const forwarded = { ...attrs };
        const isFullscreen = options.kind === "dialog" && (forwarded.fullscreen === "" || Boolean(forwarded.fullscreen));
        const targetRoot = isFullscreen ? (panel?.windowOverlayRoot ?? panel?.overlayRoot) : panel?.overlayRoot;
        if (targetRoot) {
          const appendTo = forwarded.appendTo ?? forwarded["append-to"];
          delete forwarded.appendToBody;
          delete forwarded["append-to-body"];
          delete forwarded["append-to"];
          forwarded.appendTo = appendTo && appendTo !== "body" ? appendTo : targetRoot;
        }
        if (panel?.overlayShown?.value === false) {
          delete forwarded["close-on-press-escape"];
          forwarded.closeOnPressEscape = false;
        }
        const userOnClosed = forwarded.onClosed;
        forwarded.onClosed = (...args: unknown[]) => {
          invokeForwardedListener(userOnClosed, args);
          restoreTriggerFocus();
        };
        return h(
          options.target,
          {
            ...forwarded,
            ref: innerRef,
            beforeClose: handleBeforeClose,
          },
          forwardSlots(slots),
        );
      };
    },
  });

  return component as unknown as T;
}
