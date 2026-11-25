import {
  objectDraftPrefix,
  type PanelLocalDraftRecord,
  type PanelLocalDraftStore,
} from "@ontomato/apps-sdk/direct";
import type { PanelFormValues } from "@ontomato/contracts/panel-projection";
import { authHost } from "@ontomato/workbench-ui/utils/auth";

const STORAGE_PREFIX = "ontomato:draft:v1:";

/**
 * Computes the current user/domain storage scope for browser local drafts.
 * Open-source deployments without authentication use the fixed `"local"` scope.
 */
export function draftUserScope(): string {
  try {
    const user = authHost().getUserInfo();
    if (!user) return "local";
    const domain = user.domainId?.trim() || "default";
    const principal = user.userId?.trim() || user.loginCode?.trim() || "local";
    return `${domain}:${principal}`;
  } catch {
    return "local";
  }
}

function parseDraftRecord(raw: string | null): PanelLocalDraftRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      !candidate.values
      || typeof candidate.values !== "object"
      || Array.isArray(candidate.values)
      || typeof candidate.baselineHash !== "string"
      || typeof candidate.updatedAt !== "number"
      || !Number.isFinite(candidate.updatedAt)
    ) {
      return null;
    }
    return {
      values: candidate.values as PanelFormValues,
      baselineHash: candidate.baselineHash,
      updatedAt: candidate.updatedAt,
    };
  } catch {
    return null;
  }
}

export interface BrowserLocalDraftStoreOptions {
  /** Resolves the active user/domain namespace prefix. Defaults to `draftUserScope`. */
  userScope?: () => string;
  /** Backing Web Storage instance. Defaults to `window.localStorage` when available. */
  storage?: Storage | null;
  /** Event target emitting cross-tab `storage` events. Defaults to `window` when available. */
  eventTarget?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
}

/**
 * Creates a browser `localStorage`-backed `PanelLocalDraftStore` isolated by `ontomato:draft:v1:${userScope}:${key}`.
 * Keeps in-tab subscribers synchronized synchronously on write/remove and across tabs via the `storage` event.
 */
export function createBrowserLocalDraftStore(options: BrowserLocalDraftStoreOptions = {}): PanelLocalDraftStore {
  const resolveScope = options.userScope ?? draftUserScope;
  const resolveStorage = (): Storage | null => {
    if (options.storage !== undefined) return options.storage;
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };
  const resolveEventTarget = () => {
    if (options.eventTarget !== undefined) return options.eventTarget;
    return typeof window === "undefined" ? null : window;
  };
  const scopePrefix = () => `${STORAGE_PREFIX}${resolveScope()}:`;
  const fullKey = (draftKey: string) => `${scopePrefix()}${draftKey}`;

  const listeners = new Set<() => void>();
  let listeningStorage = false;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const onStorageEvent = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === null || key === undefined || key.startsWith(STORAGE_PREFIX)) notify();
  };

  return {
    read(key) {
      const storage = resolveStorage();
      if (!storage) return null;
      try {
        return parseDraftRecord(storage.getItem(fullKey(key)));
      } catch {
        return null;
      }
    },
    write(key, record) {
      const storage = resolveStorage();
      if (!storage) return;
      try {
        storage.setItem(fullKey(key), JSON.stringify({
          values: record.values,
          baselineHash: record.baselineHash,
          updatedAt: record.updatedAt,
        }));
      } catch {
        return;
      }
      notify();
    },
    remove(key) {
      const storage = resolveStorage();
      if (!storage) return;
      const target = fullKey(key);
      try {
        if (storage.getItem(target) === null) return;
        storage.removeItem(target);
      } catch {
        return;
      }
      notify();
    },
    has(key) {
      return this.read(key) !== null;
    },
    hasObject(objectType, primaryKey) {
      const storage = resolveStorage();
      if (!storage) return false;
      const prefix = `${scopePrefix()}${objectDraftPrefix(objectType, primaryKey)}`;
      try {
        for (let i = 0; i < storage.length; i++) {
          const candidateKey = storage.key(i);
          if (!candidateKey || !candidateKey.startsWith(prefix)) continue;
          if (parseDraftRecord(storage.getItem(candidateKey)) !== null) return true;
        }
      } catch {
        return false;
      }
      return false;
    },
    subscribe(listener) {
      listeners.add(listener);
      if (!listeningStorage) {
        const target = resolveEventTarget();
        if (target) {
          target.addEventListener("storage", onStorageEvent);
          listeningStorage = true;
        }
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && listeningStorage) {
          const target = resolveEventTarget();
          target?.removeEventListener("storage", onStorageEvent);
          listeningStorage = false;
        }
      };
    },
  };
}

let sharedStore: PanelLocalDraftStore | null = null;

/** Shared platform local draft store used by panels mounted through `platform-web`. */
export function platformLocalDraftStore(): PanelLocalDraftStore {
  return (sharedStore ??= createBrowserLocalDraftStore());
}
