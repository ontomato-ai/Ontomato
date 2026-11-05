import { inject, onBeforeUnmount, shallowRef, type InjectionKey, type Ref, type VNode } from "vue";

/**
 * What the application column shows in place of the page: the navigation a conversation application contributes.
 *
 * The column belongs to the platform layout and its frame is fixed, but what fills it belongs to the application: the
 * agent picker, new conversation and history of an agent app. The application's page registers its content here while it
 * is mounted; the layout renders whatever is registered inside the frame. The registry is provided once on the app, not
 * by a component above the router, because pages mount under the router and cannot see a provider beside it.
 *
 * One contribution at a time: a page that registers replaces the one before it, and unmounting clears its own so the next
 * page starts without stale entries.
 */
export interface AppColumnContribution {
  /** The application whose column this fills; the layout shows it only while that application is current. */
  appId: string;
  /** The content: a component with its props. */
  content: () => VNode | null;
}

export const appColumnKey: InjectionKey<Ref<AppColumnContribution | null>> = Symbol("platform-app-column");

/** Provided on the app by `startWorkbenchWeb`, beside the other app-level injections. */
export function createAppColumn(): Ref<AppColumnContribution | null> {
  return shallowRef<AppColumnContribution | null>(null);
}

/**
 * Contributes the column's content for as long as the calling component is mounted. The getter is read on every render,
 * so the content follows the page's own state without the page notifying anything.
 */
export function useAppColumn(contribution: () => AppColumnContribution) {
  const target = inject(appColumnKey, null);
  if (!target) return;
  target.value = contribution();
  onBeforeUnmount(() => {
    target.value = null;
  });
}

export function useAppColumnOf(): Readonly<Ref<AppColumnContribution | null>> {
  return inject(appColumnKey, shallowRef<AppColumnContribution | null>(null));
}
