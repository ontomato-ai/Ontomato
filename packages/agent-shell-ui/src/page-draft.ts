import { readPageDraft as readContractPageDraft } from "@ontomato/contracts/page-draft";
import type { AgentHostClient } from "./host";

/*
 * A page's draft through the agent host. What a draft *is* — its address keys, reading one out of an address, taking it
 * back out, the envelope a read returns, the real object it addresses, and comparing it with that object — belongs to
 * the contracts (`@ontomato/contracts/page-draft`), because a page SDK that is not this one receives drafts too. This
 * module adds the one thing that is the agent host's: reading a draft through an `AgentHostClient`, whose
 * `recordPageDraftCreated` also records what a create draft's first save created.
 */

export {
  PAGE_DRAFT_QUERY_KEYS,
  changedFields,
  draftTarget,
  pageDraftLink,
  withoutPageDraftQuery,
  type PageDraftLink,
  type PageDraftTarget,
  type ReceivedPageDraft,
} from "@ontomato/contracts/page-draft";

/**
 * Reads the draft a page link names through the agent host, and checks the parts the page declares: its own page key and
 * the form actions it knows. The contract's own read does the checking; this passes the host's client to it.
 */
export function readPageDraft<Form, Operation extends string>(
  client: Pick<AgentHostClient, "readPageDraft">,
  link: { sessionId: string; runId: string; path: string },
  page: { pageKey: string; operations: readonly Operation[] },
) {
  return readContractPageDraft<Form, Operation>(client, link, page);
}
