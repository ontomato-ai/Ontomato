import { inject, type Component, type InjectionKey } from "vue";

/**
 * A page the assembly mounts beside the conversation (the agent platform's page pane): its address, the page's own
 * component and the props that address gives it. The assembly registers these; the conversation application that opens
 * one beside its chat does not import the page's application, and the page keeps its one component and one address.
 */
export interface PilotPage {
  component: Component;
  /** What the page's address gives its own component (a board's id, the way it navigates). */
  props?: Record<string, unknown>;
  /** The page's own navigation turns a move into the address it would be at; the frame changes the address it carries. */
  navigate?(next: Record<string, string | undefined>): string;
}

/** `null` when the address is no page of the assembly's registry. */
export type PilotPageResolver = (address: string) => PilotPage | null;

export const pilotPageKey: InjectionKey<PilotPageResolver> = Symbol("pilot-page");
/** The assembly's registry, or nothing when it registered no page beside the conversation. */
export function usePilotPage(): PilotPageResolver {
  return inject(pilotPageKey, null) ?? (() => null);
}
