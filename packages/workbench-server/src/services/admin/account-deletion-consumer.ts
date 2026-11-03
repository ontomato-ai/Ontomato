import type { AccountDeletionPage } from "@ontomato/contracts/platform-identity";
import { createLogger } from "../../logging/logger";
import { toErrorMessage } from "../../utils/errors";

const logger = createLogger("account-deletion-consumer");
export interface DeletionConsumerDependencies {
  readCursor(): Promise<string>;
  saveCursor(sequence: string): Promise<void>;
  readEvents(after: string): Promise<AccountDeletionPage>;
  cleanup(userIds: readonly string[]): Promise<void>;
}

/** At-least-once delivery: persist only after the complete cleanup of each individual account. */
export async function consumeAccountDeletions(deps: DeletionConsumerDependencies, stopped = () => false) {
  let cursor = await deps.readCursor();
  while (!stopped()) {
    const page = await deps.readEvents(cursor);
    // The page is external data. Reject malformed ordering before doing any destructive work.
    let previous = BigInt(cursor);
    for (const event of page.events) {
      if (BigInt(event.sequence) <= previous) throw new Error("Deletion events are not in cursor order");
      previous = BigInt(event.sequence);
    }
    if (page.nextCursor !== (page.events.at(-1)?.sequence ?? cursor) || (page.hasMore && !page.events.length))
      throw new Error("Invalid deletion event page cursor");
    for (const event of page.events) {
      if (stopped()) return;
      try {
        await deps.cleanup([event.userId]);
        await deps.saveCursor(event.sequence);
      } catch (error) {
        logger.error("Account deletion event failed", { sequence: event.sequence, userId: event.userId, error: toErrorMessage(error) });
        throw error;
      }
      cursor = event.sequence;
    }
    if (!page.hasMore) return;
  }
}

/** One process owns the consumer and the workbench's durable volume. No overlapping polls. */
export function startAccountDeletionConsumer(deps: DeletionConsumerDependencies, intervalMs = 30_000) {
  let stopped = false;
  let current: Promise<void> | undefined;
  const tick = () => {
    if (stopped || current) return;
    current = consumeAccountDeletions(deps, () => stopped).catch((error) => {
      logger.error("Account deletion polling failed; will resume from the saved cursor", { error: toErrorMessage(error) });
    }).finally(() => { current = undefined; });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await current; };
}
