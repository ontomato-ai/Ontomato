import { randomId } from "@ontomato/contracts/random-id";

/**
 * The Idempotency-Key of each create and each manual run.
 *
 * A key stays with one request until the service answers it. When no answer came — a dropped connection, a gateway in
 * front of the service — the request may still have been carried out, so sending it again sends the same key and the
 * service replays what it did instead of doing it twice. The service's answer, whether the result or a refusal, ends
 * the request; a different request (the reader changed the form) takes a new key.
 */
export function createAttempts(newKey: () => string = randomId) {
  const pending = new Map<string, { key: string; request: string }>();
  return {
    /** The key for this request in this place (`create`, or one task's manual run). */
    key(scope: string, request: string): string {
      const known = pending.get(scope);
      if (known && known.request === request) return known.key;
      const key = newKey();
      pending.set(scope, { key, request });
      return key;
    },
    /** The service answered: the next request here is a new one. */
    settle(scope: string): void {
      pending.delete(scope);
    },
  };
}

export type Attempts = ReturnType<typeof createAttempts>;
