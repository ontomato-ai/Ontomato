import {expect,it} from 'vitest';
import {sourceProductAdmission} from '../product-admission';
const file=(path:string,value:unknown)=>({path,encoding:'utf8' as const,content:JSON.stringify(value)});
const review=()=>file('ontomato.product-review.json',{schemaVersion:1,checks:{capabilityReads:true,actionWrites:true,noBusinessRules:true,disposablePresentation:true}});
it('requires a reviewed source delivery and an explicit dependency declaration',()=>{
  expect(()=>sourceProductAdmission([])).toThrow(expect.objectContaining({code:'PRODUCT_REVIEW_REQUIRED'}));
  expect(()=>sourceProductAdmission([review()])).toThrow(expect.objectContaining({code:'PRODUCT_MANIFEST_REQUIRED'}));
  expect(sourceProductAdmission([review(),file('ontomato.products.json',{schemaVersion:1,assetIds:['page']})])).toEqual(['page']);
  expect(sourceProductAdmission([review(),file('ontomato.products.json',{schemaVersion:1,assetIds:[]})])).toEqual([]);
});
it('does not accept an incomplete or failed business boundary review',()=>{
  const invalid=file('ontomato.product-review.json',{schemaVersion:1,checks:{capabilityReads:true,actionWrites:true,noBusinessRules:false,disposablePresentation:true}});
  expect(()=>sourceProductAdmission([invalid])).toThrow(expect.objectContaining({code:'PRODUCT_REVIEW_REQUIRED'}));
});
