import {expect,it,vi} from 'vitest';
import {createProductsClient} from '../clients/products';

it('rejects malformed counts instead of resolving an undefined count dictionary',async()=>{
  const request=vi.fn(async()=>Response.json({success:true,data:[]}));
  const client=createProductsClient({request} as unknown as Parameters<typeof createProductsClient>[0]);
  await expect(client.counts()).rejects.toThrow();
  request.mockImplementation(async()=>Response.json({counts:{widget:3,page:2}}));
  await expect(client.counts()).resolves.toEqual({widget:3,page:2});
  request.mockImplementation(async()=>Response.json({counts:{widget:-1}}));
  await expect(client.counts()).rejects.toThrow();
});
