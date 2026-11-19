import type { PanelManifest } from "@ontomato/contracts/panel-manifest";
import { panelStateOperation, projectionOperations } from "@ontomato/contracts/panel-projection";
import { operationCall, type PanelProjectionRegistration } from "./ports";
import type { PanelOperationBinding } from "./types";
import type { PanelStateStore } from "./state";
import type { PanelFormAdapters } from "./draft";
import type { PanelText } from "./text";
import type { PanelWriteInvocation } from "./human-operations";

/*
 * The operations a panel instance offers (overall design 3.4, 5.1, "list and execute operations"): the ones its slots'
 * projections publish, derived from the registered ports rather than written again, and the state changes its
 * declaration adds. Each is the description an agent reads and the handler a header button and an agent's call both
 * reach, so one operation has one implementation and there is no second "similar command".
 *
 * A person's action runs as an agent's does: the platform's coordinator freezes it as one intent, the host confirms it
 * where the owner asks and dispatches it once under the person's own credential, so one operation has one
 * implementation, the owner's registered one. A form's save stays the form's own, and a state change the panel's.
 */

/** What a panel offers: its projections' operations, then its own state changes, each with the handler to run. */
export function panelOperations(
  manifest: PanelManifest,
  registrations: readonly PanelProjectionRegistration[],
  state: PanelStateStore,
  forms: PanelFormAdapters,
  text: PanelText,
  write: (operationId: string, invocation: PanelWriteInvocation) => Promise<unknown>,
): PanelOperationBinding[] {
  return [
    ...registrations.flatMap((registration) =>
      projectionOperations(manifest, registration).map((operation) => ({
        ...operation,
        // The target is read here, from the instance's state at the moment of the call: the object the reader has
        // selected, or the draft's own. A caller outside the panel sends what this produces, never a state reference.
        //
        // A form's save is the form's own: the values it holds and the revision it was read at are the form's, not
        // something a caller supplies. Everything else runs through its handler reference.
        invoke: (input?: Readonly<Record<string, unknown>>) =>
          operation.kind === "form.save"
            ? forms.submit(operation.slot!)
            : write(operation.id, { call: operationCall(operation, state.values.value, input ?? {}) }),
      })),
    ),
    ...manifest.operations.map((operation) => ({
      // A state operation is the panel's own, so its name is one of the panel's words, in the current language.
      ...panelStateOperation(operation, (key) => text(key)),
      invoke: async () => {
        state.setState(operation.sets);
        return operation.sets;
      },
    })),
  ];
}
