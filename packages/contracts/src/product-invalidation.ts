export interface ProductInvalidation {actionId:string;objectTypes:string[]}
const listeners=new Set<(event:ProductInvalidation)=>void>();
export function onProductInvalidation(listener:(event:ProductInvalidation)=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}
/** Observer failures must never turn a completed business write into a failed Action. */
export function invalidateProductData(event:ProductInvalidation){for(const listener of listeners)try{listener(event);}catch{/* Each reader owns its refresh errors. */}}
