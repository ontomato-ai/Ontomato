import { describe, expect, it, vi } from "vitest";
import { objectDraftKey, typeDraftKey } from "@ontomato/apps-sdk/direct";
import { createBrowserLocalDraftStore } from "../local-draft-store";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe("createBrowserLocalDraftStore", () => {
  it("namespaces keys by userScope and isolates drafts across users", () => {
    const storage = memoryStorage();
    let scope = "domain-1:user-a";
    const store = createBrowserLocalDraftStore({ storage, userScope: () => scope, eventTarget: null });
    const key = objectDraftKey("demo:Task", "t-1", "proj-edit");

    store.write(key, { values: { title: "Draft A" }, baselineHash: "h1", updatedAt: 100 });
    expect(storage.getItem(`ontomato:draft:v1:domain-1:user-a:${key}`)).not.toBeNull();
    expect(store.read(key)?.values).toEqual({ title: "Draft A" });
    expect(store.has(key)).toBe(true);
    expect(store.hasObject("demo:Task", "t-1")).toBe(true);

    // Switching user scope isolates drafts completely.
    scope = "domain-1:user-b";
    expect(store.read(key)).toBeNull();
    expect(store.has(key)).toBe(false);
    expect(store.hasObject("demo:Task", "t-1")).toBe(false);
  });

  it("matches hasObject across multiple forms for the same object without clobbering", () => {
    const storage = memoryStorage();
    const store = createBrowserLocalDraftStore({ storage, userScope: () => "local", eventTarget: null });
    const formA = objectDraftKey("demo:Task", "t-1", "panel-a:form");
    const formB = objectDraftKey("demo:Task", "t-1", "panel-b:form");
    const newForm = typeDraftKey("demo:Task", "panel-a:create");

    store.write(formA, { values: { title: "A" }, baselineHash: "h1", updatedAt: 1 });
    store.write(formB, { values: { title: "B" }, baselineHash: "h2", updatedAt: 2 });
    store.write(newForm, { values: { title: "New" }, baselineHash: "h3", updatedAt: 3 });

    expect(store.read(formA)?.values).toEqual({ title: "A" });
    expect(store.read(formB)?.values).toEqual({ title: "B" });
    expect(store.hasObject("demo:Task", "t-1")).toBe(true);

    store.remove(formA);
    // formB still holds a draft for (demo:Task, t-1).
    expect(store.hasObject("demo:Task", "t-1")).toBe(true);

    store.remove(formB);
    expect(store.hasObject("demo:Task", "t-1")).toBe(false);
    expect(store.has(newForm)).toBe(true);
  });

  it("notifies subscribers on local write/remove and cross-tab storage events", () => {
    const storage = memoryStorage();
    const target = new EventTarget();
    const store = createBrowserLocalDraftStore({
      storage,
      userScope: () => "local",
      eventTarget: target as unknown as Window,
    });
    const listener = vi.fn();
    const stop = store.subscribe(listener);

    const key = objectDraftKey("demo:Task", "t-2", "proj-1");
    store.write(key, { values: { title: "Hi" }, baselineHash: "h1", updatedAt: 10 });
    expect(listener).toHaveBeenCalledTimes(1);

    const storageEvent = new Event("storage") as Event & { key?: string };
    storageEvent.key = `ontomato:draft:v1:local:${key}`;
    target.dispatchEvent(storageEvent);
    expect(listener).toHaveBeenCalledTimes(2);

    store.remove(key);
    expect(listener).toHaveBeenCalledTimes(3);

    // Removing a non-existent key is a no-op and does not fire redundant notifications.
    store.remove(key);
    expect(listener).toHaveBeenCalledTimes(3);

    stop();
    store.write(key, { values: { title: "Again" }, baselineHash: "h1", updatedAt: 20 });
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
