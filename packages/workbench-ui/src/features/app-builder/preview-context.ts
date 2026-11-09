import { onScopeDispose, shallowRef, watch } from "vue";
import type { AppHost, AppPageContext, AppPageSelection } from "@ontomato/contracts/app-host";

/**
 * The platform's app host, heard until the returned function is called: every app frame's page context, with the
 * frame's window as `source`.
 */
export type SubscribePageContext = (listener: AppHost["setPageContext"]) => () => void;

/**
 * What the app in the preview says its reader looks at: its own page and the selected object. Only the frame the preview
 * shows now is heard, so a new frame (a reload, another HEAD, the page closed and opened again) and another workspace
 * start without one; moving the page between beside and full keeps the frame and so the context. It is held only while
 * the builder is open: it lives in no store and goes to no server, except in the messages the reader sends.
 */
export function usePreviewContext(subscribe: SubscribePageContext, frame: () => Window | null, workspaceId: () => string | null) {
  const context = shallowRef<AppPageContext | null>(null);
  watch([frame, workspaceId], () => (context.value = null));
  // Kept as the builder's own values: nothing of the app's frame is held after the frame is gone.
  onScopeDispose(subscribe((source, { page, selection }) => {
    if (source !== frame()) return;
    context.value = {
      page,
      selection: selection && { className: selection.className, primaryKey: selection.primaryKey, name: selection.name },
    };
  }));
  return context;
}

/**
 * The selected object as the composer and the message name it: its class and name, and its primary key whenever the
 * name is not the key, so the agent always learns which object it is.
 */
export function selectedObject({ className, primaryKey, name }: AppPageSelection, t: (key: string, named: Record<string, string>) => string) {
  const object = `${className} ${name}`;
  return primaryKey === name ? object : t("appBuilder.objectKey", { object, key: primaryKey });
}
