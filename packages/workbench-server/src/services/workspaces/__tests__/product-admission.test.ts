import {expect,it} from 'vitest';
import {sourceProductAdmission,deriveSourceProductReview} from '../product-admission';
const file=(path:string,value:unknown)=>({path,encoding:'utf8' as const,content:JSON.stringify(value)});
const review=()=>file('ontomato.product-review.json',{schemaVersion:1,checks:{capabilityReads:true,actionWrites:true,noBusinessRules:true,disposablePresentation:true}});
it('requires an explicit dependency declaration and derives review without an author attestation',()=>{
  expect(()=>sourceProductAdmission([])).toThrow(expect.objectContaining({code:'PRODUCT_MANIFEST_REQUIRED'}));
  expect(()=>sourceProductAdmission([review()])).toThrow(expect.objectContaining({code:'PRODUCT_MANIFEST_REQUIRED'}));
  expect(sourceProductAdmission([review(),file('ontomato.products.json',{schemaVersion:1,assetIds:['page']})])).toEqual(['page']);
  expect(sourceProductAdmission([review(),file('ontomato.products.json',{schemaVersion:1,assetIds:[]})])).toEqual([]);
  expect(sourceProductAdmission([file('ontomato.products.json',{schemaVersion:1,assetIds:[]})])).toEqual([]);
});
it('derives source hashes and rejects direct platform transports despite a successful author declaration',()=>{
  const dependencies=file('ontomato.products.json',{schemaVersion:1,assetIds:[]});
  const script={path:'app.js',encoding:'utf8' as const,content:'fetch("/api/data/query")'};
  expect(()=>sourceProductAdmission([review(),dependencies,script])).toThrow(expect.objectContaining({code:'PRODUCT_SOURCE_ACCESS_REJECTED'}));
  const safe={...script,content:'context.metricViews.read({id:"count",parameters:{}})'};
  expect(deriveSourceProductReview([safe])).toMatchObject({generated:true,files:[{path:'app.js',hash:expect.any(String)}]});
});
it('does not treat a supplied review as admission evidence',()=>{
  const invalid=file('ontomato.product-review.json',{schemaVersion:1,checks:{capabilityReads:true,actionWrites:true,noBusinessRules:false,disposablePresentation:true}});
  expect(sourceProductAdmission([invalid,file('ontomato.products.json',{schemaVersion:1,assetIds:[]})])).toEqual([]);
});
it.each([
  {path:'index.html',content:'<img src="/api/data/query">'},
  {path:'styles.css',content:'body{background:url(/api/data/query)}'},
  {path:'app.js',content:'window.parent.document.querySelector("body")'},
  {path:'index.html',content:'<meta http-equiv="refresh" content="0;url=/api/data">'},
])('rejects non-SDK data channels in $path',file=>{
  expect(()=>deriveSourceProductReview([{...file,encoding:'utf8'}])).toThrow(expect.objectContaining({code:'PRODUCT_SOURCE_ACCESS_REJECTED'}));
});
