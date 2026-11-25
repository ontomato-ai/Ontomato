import { inject, type InjectionKey } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormValues } from "@ontomato/contracts/panel-projection";
import { cloneJsonValue } from "./form-values";

/**
 * Platform-owned local draft record for a single form instance. Secrets are stripped before persistence and
 * `baselineHash` records the owner baseline version the draft was derived from so restoration can warn when the
 * underlying item has changed since.
 */
export interface PanelLocalDraftRecord {
  readonly values: PanelFormValues;
  readonly baselineHash: string;
  readonly updatedAt: number;
}

/**
 * Platform port backing cross-reload form drafts. Key space isolation (user/domain prefix) stays with the host
 * implementation; SDK form and list components read and write through logical draft keys only.
 */
export interface PanelLocalDraftStore {
  read(key: string): PanelLocalDraftRecord | null;
  write(key: string, record: PanelLocalDraftRecord): void;
  remove(key: string): void;
  has(key: string): boolean;
  hasObject(objectType: string, primaryKey: string): boolean;
  subscribe(listener: () => void): () => void;
}

/** Internal Vue injection key supplying the platform's local draft store to official SDK form/list components. */
export const localDraftStoreKey: InjectionKey<PanelLocalDraftStore> = Symbol("ontomato.panelLocalDraftStore");

/** Returns the platform local draft store provided by the enclosing panel host, or `null` when unavailable. */
export function useLocalDraftStore(): PanelLocalDraftStore | null {
  return inject(localDraftStoreKey, null);
}

/** Prefix shared by every form draft belonging to one object identity (used for list/picker draft indicators). */
export function objectDraftPrefix(objectType: string, primaryKey: string): string {
  return `object:${objectType}:${primaryKey}:`;
}

/** Logical draft key for an object form, scoped by `formId` so two distinct forms on the same object never overwrite each other. */
export function objectDraftKey(objectType: string, primaryKey: string, formId: string): string {
  return `${objectDraftPrefix(objectType, primaryKey)}${formId}`;
}

/** Logical draft key for a singleton or create form without a concrete primary key. */
export function typeDraftKey(objectType: string, formId: string): string {
  return `form:${objectType}:${formId}`;
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) sorted[key] = canonicalizeValue(child);
    }
    return sorted;
  }
  return value;
}

function fnv1a32(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Deterministic fingerprint of a form baseline value independent of object key order. Stored beside a local draft so
 * restoration can detect whether the underlying owner record was modified elsewhere after the draft was saved.
 */
export function computeDraftBaselineHash(values: PanelFormValues): string {
  const canonical = JSON.stringify(canonicalizeValue(values));
  return `v1:${canonical.length}:${fnv1a32(canonical, 0x811c9dc5)}${fnv1a32(canonical, 0x050c5d1f)}`;
}

function secretPathTokens(path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("/")) {
    return trimmed
      .slice(1)
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  }
  const normalized = trimmed.replaceAll("[]", ".*");
  return normalized.split(/[./]/).filter((segment) => segment.length > 0);
}

function stripAtTokens(node: RuntimeJsonValue | undefined, tokens: readonly string[], index: number): RuntimeJsonValue | undefined {
  if (node === undefined || node === null || typeof node !== "object" || index >= tokens.length) return node;
  const token = tokens[index]!;
  const isLast = index === tokens.length - 1;
  if (Array.isArray(node)) {
    if (token === "*") {
      return isLast ? [] : node.map((item) => stripAtTokens(item, tokens, index + 1) as RuntimeJsonValue);
    }
    if (/^(0|[1-9][0-9]*)$/.test(token)) {
      const targetIndex = Number(token);
      if (isLast) return node.filter((_, i) => i !== targetIndex);
      return node.map((item, i) => (i === targetIndex ? (stripAtTokens(item, tokens, index + 1) as RuntimeJsonValue) : item));
    }
    return node;
  }
  if (isLast) {
    if (!Object.hasOwn(node, token)) return node;
    const next: Record<string, RuntimeJsonValue> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key !== token) next[key] = value;
    }
    return next;
  }
  if (!Object.hasOwn(node, token)) return node;
  return {
    ...node,
    [token]: stripAtTokens(node[token], tokens, index + 1) as RuntimeJsonValue,
  };
}

/**
 * Returns a deep clone of `values` with every path listed in `secretPaths` removed so passwords, API keys, and other
 * secret fields are never persisted to local browser storage. Accepts both JSON Pointer paths (`/auth/password`,
 * `/headers/0/token`, wildcard array segments) and dot/bracket paths (`auth.password`, `headers[].token`).
 */
export function stripSecretDraftValues(values: PanelFormValues, secretPaths: readonly string[]): PanelFormValues {
  let sanitized: RuntimeJsonValue = cloneJsonValue(values);
  for (const path of secretPaths) {
    const tokens = secretPathTokens(path);
    if (tokens.length === 0) continue;
    sanitized = stripAtTokens(sanitized, tokens, 0) as RuntimeJsonValue;
  }
  return sanitized as PanelFormValues;
}

/** In-memory `PanelLocalDraftStore` for unit tests and non-persistent hosts. */
export function createMemoryLocalDraftStore(): PanelLocalDraftStore {
  const records = new Map<string, PanelLocalDraftRecord>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    read(key) {
      const record = records.get(key);
      if (!record) return null;
      return {
        values: cloneJsonValue(record.values),
        baselineHash: record.baselineHash,
        updatedAt: record.updatedAt,
      };
    },
    write(key, record) {
      records.set(key, {
        values: cloneJsonValue(record.values),
        baselineHash: record.baselineHash,
        updatedAt: record.updatedAt,
      });
      notify();
    },
    remove(key) {
      if (records.delete(key)) notify();
    },
    has(key) {
      return records.has(key);
    },
    hasObject(objectType, primaryKey) {
      const prefix = objectDraftPrefix(objectType, primaryKey);
      for (const key of records.keys()) {
        if (key.startsWith(prefix)) return true;
      }
      return false;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
