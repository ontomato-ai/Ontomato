import type { PageSelection } from "@ontomato/contracts/page-context";
import type { PanelOperation } from "@ontomato/contracts/panel-manifest";

/** One entry of a message's page line: the ontology object a panel instance holds, or anything else it selects. */
export type PanelSelection = PageSelection;

/**
 * An operation as the panel's context offers it (overall design 5.1): the description the platform lists and an agent
 * reads, and the `invoke` a header button and an agent's call both reach. `invoke` is not sent anywhere: it runs in the
 * panel's own frame, where the SDK client makes the request with whoever is signed in there, so a person's click uses
 * the person's own credential.
 */
export interface PanelOperationBinding extends PanelOperation {
  invoke(input?: Readonly<Record<string, unknown>>): Promise<unknown>;
}

/** The draft one form slot holds: unsaved changes and their two ways out, as the header already shows them. */
export interface PanelDraftState {
  readonly dirty: boolean;
  readonly saving: boolean;
  save(): void;
  discard(): void;
}
