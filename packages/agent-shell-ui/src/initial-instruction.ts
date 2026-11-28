import { historyCursor } from "@ontomato/contracts/session-history";
import type { AgentHostClient } from "./host";
import { writtenText } from "./page-context";
import type { ShellLabels } from "./types";
import { userText, type ConversationItem, type UserItem } from "./view";

export function findFirstVisibleQuestion(items: readonly ConversationItem[]): UserItem | undefined {
  return items.find(
    (item): item is UserItem => item.kind === "user" && !item.answer && !item.queued && Boolean(item.text.trim()),
  );
}

function stripContext(text: string, labels: ShellLabels): string {
  return writtenText(text, {
    page: labels.pageContext,
    pageAddress: labels.pageContextAddress,
    selection: labels.selectionContext,
    highlight: labels.highlightContext,
    state: labels.stateContext,
    forms: labels.formsContext,
    file: labels.fileContext,
    closed: labels.pageContextClosed,
  }).trim();
}

export interface ReadInitialInstructionOptions {
  client: AgentHostClient;
  labels: () => ShellLabels;
  getSessionId: () => string | null;
  getConversationSessionId: () => string | null;
  getOlderCursor: () => string | null;
  getFirstVisibleQuestion: () => UserItem | undefined;
}

/**
 * Reads the opening non-empty user instruction of the currently loaded session, paging back to the start of the
 * session when older turns have scrolled out of the visible history tail.
 */
export async function readInitialInstruction(options: ReadInitialInstructionOptions): Promise<string> {
  const id = options.getSessionId();
  if (!id || options.getConversationSessionId() !== id) return "";
  const written = (text: string) => stripContext(text, options.labels());
  const tail = options.getOlderCursor();
  if (!tail) return written(options.getFirstVisibleQuestion()?.text ?? "");
  let after: string | null = historyCursor(id, 0);
  while (after && options.getSessionId() === id) {
    const page = await options.client.readHistory(id, { after, through: tail });
    if (options.getSessionId() !== id) return "";
    for (const { message } of page.messages) {
      if (message.role !== "user") continue;
      const instruction = written(userText(message.content));
      if (instruction) return instruction;
    }
    after = page.page.nextCursor;
  }
  return options.getSessionId() === id ? written(options.getFirstVisibleQuestion()?.text ?? "") : "";
}
