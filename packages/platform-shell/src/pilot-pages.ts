import { inject, type Component, type InjectionKey } from "vue";

/**
 * A page the assembly mounts beside the conversation (the agent platform's page pane): its address, the page's own
 * component and the props that address gives it. The assembly registers these; the conversation application that opens
 * one beside its chat does not import the page's application, and the page keeps its one component and one address.
 */
export interface PilotPage {
  /** The page's shell key, as the conversation application names the page it shows. */
  id: string;
  component: Component;
  /**
   * What the page's address gives its own component (a board's id, the page's address, and the callback its own
   * navigation calls). A move is an address: the frame changes the parameter it carries to that address.
   */
  props?: Record<string, unknown>;
  /**
   * What keeps the page the same instance while its address changes, when that is less than the whole address: a panel
   * writes the reader's selection into its own address and stays the panel it was. Absent, another address is another
   * instance of the page.
   */
  instance?: string;
}

/** `null` when the address is no page of the assembly's registry. */
export type PilotPageResolver = (address: string) => PilotPage | null;

/**
 * The assembly's registry of such pages. It takes the callback the pages move by — the consumer's own address, which is
 * the conversation's `?page=` — so the registry itself knows nothing of any application's router.
 */
export type PilotPageRegistry = (setPage: (address: string) => void) => PilotPageResolver;

export const pilotPageKey: InjectionKey<PilotPageRegistry> = Symbol("pilot-page");

/** The assembly's registry, or nothing when it registered no page beside the conversation. */
export function usePilotPage(): PilotPageRegistry {
  return inject(pilotPageKey, null) ?? (() => () => null);
}
