import {z} from 'zod';

/** Host-owned callbacks are scoped to a frozen product release and delegated credential. */
export const runtimeProductToolSchema=z.object({
  name:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/),
  description:z.string().max(10000),
  inputSchema:z.record(z.unknown()),
  path:z.string().regex(/^\/api\/product-assets\/[A-Za-z0-9._%-]+\/releases\/[a-f0-9-]+\/tools\/[A-Za-z0-9._%-]+(?:\?sessionId=[a-f0-9-]+)?$/).refine(path=>{
    try{return path.split('/').every(segment=>{const decoded=decodeURIComponent(segment);return decoded!=='.'&&decoded!=='..'&&!/[\\/]/.test(decoded);});}catch{return false;}
  },'Invalid product callback path'),
}).strict();
