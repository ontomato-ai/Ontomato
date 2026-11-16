import type {InjectionKey,Component} from 'vue';
/** Hosts register presentation components; renderers receive governed data, never query definitions. */
export const productRenderersKey:InjectionKey<ReadonlyMap<string,Component>>=Symbol('product-renderers');
