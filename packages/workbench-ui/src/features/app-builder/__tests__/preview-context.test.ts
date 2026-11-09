import { describe, expect, it } from "vitest";
import { effectScope, nextTick, shallowRef } from "vue";
import type { AppHost, AppPageContext } from "@ontomato/contracts/app-host";
import { workbenchI18n } from "../../../i18n";
import { selectedObject, usePreviewContext } from "../preview-context";

/*
 * What a message may say the reader looks at in the preview: only what the app in the frame shown now reported. A frame
 * that is gone (reloaded, replaced by a new HEAD) or another workspace's app must not put its selected object into a
 * message about the current one, and the selected object is always named by its primary key.
 */

/** The platform's app host as the builder hears it: every app frame's calls, by frame. */
function appHost() {
  const listeners = new Set<AppHost["setPageContext"]>();
  return {
    subscribe(listener: AppHost["setPageContext"]) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setPageContext(source: object, context: AppPageContext) {
      for (const listener of listeners) listener(source, context);
    },
    listening: () => listeners.size,
  };
}

const ORDER = { className: "Order", primaryKey: "DEMO-0001", name: "DEMO-0001" };
const frameWindow = () => ({}) as Window;

function openBuilder() {
  const host = appHost();
  const frame = shallowRef<Window | null>(frameWindow());
  const workspace = shallowRef<string | null>("w1");
  const scope = effectScope();
  const context = scope.run(() => usePreviewContext(host.subscribe, () => frame.value, () => workspace.value))!;
  return { host, frame, workspace, scope, context };
}

describe("the preview's page context", () => {
  it("is what the app in the frame shown now reported, and nothing another frame says", () => {
    const { host, frame, context } = openBuilder();

    host.setPageContext(frameWindow(), { page: "Elsewhere", selection: ORDER });
    expect(context.value).toBeNull();

    host.setPageContext(frame.value!, { page: "Overdue orders", selection: ORDER });
    expect(context.value).toEqual({ page: "Overdue orders", selection: ORDER });

    host.setPageContext(frame.value!, { page: "Overdue orders", selection: null });
    expect(context.value).toEqual({ page: "Overdue orders", selection: null });
  });

  it("starts empty in a reloaded frame, and the frame that was replaced is no longer heard", async () => {
    const { host, frame, context } = openBuilder();
    const replaced = frame.value!;
    host.setPageContext(replaced, { page: "Overdue orders", selection: ORDER });

    frame.value = frameWindow();
    await nextTick();
    expect(context.value).toBeNull();

    host.setPageContext(replaced, { page: "Overdue orders", selection: ORDER });
    expect(context.value).toBeNull();
  });

  it("drops the selected object when the reader opens another workspace", async () => {
    const { host, frame, workspace, context } = openBuilder();
    host.setPageContext(frame.value!, { page: "Overdue orders", selection: ORDER });

    workspace.value = "w2";
    await nextTick();
    expect(context.value).toBeNull();
  });

  it("is no longer heard once the builder closes", () => {
    const { host, scope } = openBuilder();
    expect(host.listening()).toBe(1);

    scope.stop();
    expect(host.listening()).toBe(0);
  });

  it("names the selected object by its primary key", () => {
    const { t } = workbenchI18n().global;
    const name = (key: string, named: Record<string, string>) => t(key, named);

    expect(selectedObject(ORDER, name)).toBe("Order DEMO-0001");
    expect(selectedObject({ className: "celestial_body", primaryKey: "body_earth", name: "Earth" }, name))
      .toBe("celestial_body Earth (primary key body_earth)");
  });
});
