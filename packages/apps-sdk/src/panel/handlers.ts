import type { PanelOperationCall } from "@ontomato/contracts/panel-manifest";

/*
 * Where a projection's operations are found (overall design 5.1): a `handlerRef` such as `schedules.runNow` names one
 * operation of this SDK version's clients, and this registry is that name to the function. A projection record's
 * `PlatformOperation` binding and its component's declared operations both resolve here, so a person's click and an
 * agent's call reach one implementation, and no panel or projection carries a handler of its own.
 *
 * A handler receives the operation's whole call — the object it acts on and the caller's input — so it needs nothing
 * from the panel's state to know which task to run or which form to save.
 */

/** One registered operation: its reference, what it takes and the call itself. */
export interface RegisteredHandler {
  handlerRef: string;
  /** Runs here, with the reader's own credential, because this frame's client makes the request as them. */
  invoke(call: PanelOperationCall): Promise<unknown>;
}

const handlers = new Map<string, RegisteredHandler>();

/** Registers one operation of this SDK version. Registering the same reference twice fails: one name, one handler. */
export function registerHandler(handler: RegisteredHandler): void {
  if (handlers.has(handler.handlerRef)) throw new Error(`Operation '${handler.handlerRef}' is already registered`);
  handlers.set(handler.handlerRef, handler);
}

/** The operation a reference names. */
export function handlerFor(handlerRef: string): RegisteredHandler {
  const found = handlers.get(handlerRef);
  if (!found) throw new Error(`This SDK version registers no operation '${handlerRef}'`);
  return found;
}

/** The references this version can run: what a projection may bind. */
export function registeredHandlers(): readonly string[] {
  return [...handlers.keys()];
}
