import { accountDeletionPageSchema } from "@ontomato/contracts/platform-identity";
import { applicationEntryRootsChangedSchema } from "@ontomato/contracts/entry-dependencies";
import { z } from "zod";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { createLogger } from "../../logging/logger";
import { backendGet } from "../../utils/backend-client";
import { toErrorMessage } from "../../utils/errors";
import { platformEventCursor } from "./platform-event-cursor";

const logger = createLogger("account-deletion-consumer");
const platformEventPageSchema = accountDeletionPageSchema.extend({
  events: z.array(z.discriminatedUnion("type", [
    accountDeletionPageSchema.shape.events.element,
    applicationEntryRootsChangedSchema,
  ])),
});
type PlatformEventPage = z.infer<typeof platformEventPageSchema>;
export interface DeletionConsumerDependencies {
  readCursor(): Promise<string>;
  saveCursor(sequence: string): Promise<void>;
  readEvents(after: string): Promise<PlatformEventPage>;
  cleanup(userIds: readonly string[]): Promise<void>;
}

/** Advance the existing cursor only after the entire event has been handled. */
export async function consumeAccountDeletions(deps: DeletionConsumerDependencies, stopped = () => false) {
  let cursor = await deps.readCursor();
  while (!stopped()) {
    const page = await deps.readEvents(cursor);
    // The page is external data. Reject malformed ordering before doing any destructive work.
    let previous = BigInt(cursor);
    for (const event of page.events) {
      if (BigInt(event.sequence) <= previous) throw new Error("Platform events are not in cursor order");
      previous = BigInt(event.sequence);
    }
    if (page.nextCursor !== (page.events.at(-1)?.sequence ?? cursor) || (page.hasMore && !page.events.length))
      throw new Error("Invalid platform event page cursor");
    for (const event of page.events) {
      if (stopped()) return;
      try {
        if (event.type === "account.deleted") await deps.cleanup([event.userId]);
        else {
          const { publishApplicationEntryRoots } = await import("../product-panels/entry-dependency-publication");
          await publishApplicationEntryRoots(event);
        }
        await deps.saveCursor(event.sequence);
      } catch (error) {
        logger.error("Platform event failed", { sequence: event.sequence, type: event.type, error: toErrorMessage(error) });
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
      logger.error("Platform event polling failed; will resume from the saved cursor", { error: toErrorMessage(error) });
    }).finally(() => { current = undefined; });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await current; };
}

export function startWorkbenchPlatformEvents() {
  return startAccountDeletionConsumer({
    ...platformEventCursor,
    async readEvents(after) {
      const query = new URLSearchParams({ after });
      const response = await backendGet("workbench-platform-events", config.dataQuery.baseUrl + "/platform/events/service?" + query, {
        headers: { "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken }, retries: 1,
      });
      return z.object({ success: z.literal(true), data: platformEventPageSchema }).parse(JSON.parse(response.text)).data;
    },
    async cleanup(userIds) {
      const { cleanupDeletedUsers } = await import("./user-resource-cleanup");
      await cleanupDeletedUsers(userIds);
    },
  });
}
