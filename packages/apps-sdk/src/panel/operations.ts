import type { PanelManifest } from "@ontomato/contracts/panel-manifest";
import { operationCall, projectionOperations, type PanelProjectionRegistration } from "./ports";
import type { PanelOperationBinding } from "./types";
import type { PanelStateStore } from "./state";
import type { PanelFormAdapters } from "./draft";

/*
 * The operations a panel instance offers (overall design 3.4, 5.1, "list and execute operations"): the ones its slots'
 * projections publish, derived from the registered ports rather than written again, and the state changes its
 * declaration adds. Each is the description an agent reads and the handler a header button and an agent's call both
 * reach, so one operation has one implementation and there is no second "similar command".
 *
 * A person's button runs `invoke` in the panel's own frame, with whoever is signed in there, so a click uses the person's
 * own credential and keeps the owner's validation and confirmation. An agent's call is made by the platform's
 * coordinator with the run's executor, never through this frame (P3).
 */

/** What a panel offers: its projections' operations, then its own state changes, each with the handler to run. */
export function panelOperations(
  manifest: PanelManifest,
  registrations: readonly PanelProjectionRegistration[],
  state: PanelStateStore,
  forms: PanelFormAdapters,
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
            : registration.invoke(operation.handlerRef, operationCall(operation, state.values.value, input ?? {})),
      })),
    ),
    ...manifest.operations.map((operation) => ({
      id: operation.id,
      label: operation.label,
      kind: operation.kind,
      inputSchema: {},
      handlerRef: `panel.state.${operation.id}`,
      invoke: async () => {
        for (const [name, value] of Object.entries(operation.sets)) state.set(name, value);
        return operation.sets;
      },
    })),
  ];
}
