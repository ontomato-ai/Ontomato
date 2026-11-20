import type { PanelManifest } from "@ontomato/contracts/panel-manifest";
import { projectionOperation } from "@ontomato/contracts/panel-projection";
import { operationCall, operationInvocation, type PanelProjectionRegistration } from "./ports";
import type { PanelOperationBinding } from "./types";
import type { PanelStateStore } from "./state";
import type { PanelFormAdapters } from "./draft";
import type { PanelEvents } from "./events";
import type { PanelReadCall, PanelWriteInvocation } from "./human-operations";

/*
 * The operations a panel instance offers (overall design 3.4, 5.1, "list and execute operations"): the ones its members'
 * projections name, as their owners admit them now, under the member's key and the projection's name, and the events its declaration
 * offers for explicit invocation (a header button, an agent's call). Each is the description an agent reads and the handler a header button and an agent's call both
 * reach, so one operation has one implementation and there is no second "similar command".
 *
 * A person's action runs as an agent's does: the platform's coordinator freezes it as one intent, the host confirms it
 * where the owner asks and dispatches it once under the person's own credential, so one operation has one
 * implementation, the owner's registered one. A form's save stays the form's own, and a state change the panel's.
 */

/** What a panel offers: its projections' operations, then its explicitly invoked events, each with what runs it. */
export function panelOperations(
  manifest: PanelManifest,
  registrations: readonly PanelProjectionRegistration[],
  state: PanelStateStore,
  forms: PanelFormAdapters,
  events: PanelEvents,
  write: (operationId: string, invocation: PanelWriteInvocation) => Promise<unknown>,
  read: (operationId: string, call: PanelReadCall) => Promise<unknown>,
): PanelOperationBinding[] {
  return [
    ...registrations.flatMap((registration) =>
      Object.entries(registration.operations).map(([name, descriptor]) => {
        const operation = projectionOperation(manifest, registration.slot, name, descriptor);
        return {
          ...operation,
          // The target is read here, from the instance's state at the moment of the call: the object the reader has
          // selected, or the draft's own. A caller outside the panel sends what this produces, never a state reference.
          //
          // A form's save is the form's own: the values it holds and the revision it was read at are the form's, not
          // something a caller supplies. Otherwise the owner's description says what the call is: a read (a trial run,
          // an export the reader saves) is read and changes nothing; a write is frozen as an intent and dispatched.
          invoke: (input?: Readonly<Record<string, unknown>>) => {
            if (operation.kind === "form.save") return forms.submit(operation.slot!);
            if (descriptor.effect === "read")
              return read(operation.id, { target: operationCall(operation, state.values.value).target, input: input ?? {} });
            return write(operation.id, operationInvocation(operation, state.values.value, input ?? {}));
          },
        };
      }),
    ),
    ...events.operations().map((operation) => ({ ...operation, invoke: () => events.invoke(operation.id) })),
  ];
}
