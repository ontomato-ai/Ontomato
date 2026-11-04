import { inject, type InjectionKey } from "vue";

/**
 * Whether the current user sees the entries that open the Ontology Service (the function-area link and the admin
 * tab). The app decides once and both entries read the same answer: the open-source edition always shows them; an
 * edition with platform permissions shows them when the user has any permission of the platform application.
 */
export interface OntologyServiceAccess {
  /** Read during render; updates reactively with the app's permission state. */
  visible(): boolean;
}

export const ontologyServiceAccessKey: InjectionKey<OntologyServiceAccess> = Symbol("ontologyServiceAccess");

/** The open-source edition has no permission gate. */
export const openOntologyServiceAccess: OntologyServiceAccess = { visible: () => true };

export function useOntologyServiceAccess(): OntologyServiceAccess {
  const access = inject(ontologyServiceAccessKey, null);
  if (!access) throw new Error("The Ontology Service access is not provided (startWorkbenchWeb provides it)");
  return access;
}
