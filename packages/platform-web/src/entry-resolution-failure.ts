import { shallowRef } from "vue";

/** Entry read failures by address path. A failure belongs to the address that failed, never to the whole platform. */
const failures = shallowRef<ReadonlyMap<string, string>>(new Map());

export function noteEntryResolutionFailure(path: string, error: unknown): void {
  console.error(error);
  const next = new Map(failures.value);
  next.set(path, error instanceof Error ? error.message : String(error));
  failures.value = next;
}

export function clearEntryResolutionFailure(path: string): void {
  if (!failures.value.has(path)) return;
  const next = new Map(failures.value);
  next.delete(path);
  failures.value = next;
}

export function entryResolutionFailureFor(path: string): string | null {
  return failures.value.get(path) ?? null;
}

export function resetEntryResolutionFailures(): void {
  failures.value = new Map();
}
