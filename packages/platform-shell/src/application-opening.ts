import type { InjectionKey } from 'vue';

/** The host owns application routing, including external signed entries. */
export const openApplicationKey: InjectionKey<(id: string) => void> = Symbol('open-application');
