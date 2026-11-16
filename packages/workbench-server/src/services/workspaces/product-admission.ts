import { productManifestSchema } from '@ontomato/contracts/product-assets';
import type { WorkspaceExport } from '@ontomato/contracts/workspaces';
import { HttpError } from '../../utils/errors';
import {createHash} from 'node:crypto';
export const SOURCE_APPLICATION_CSP="sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src 'self' data:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'";

/** Source admission derives evidence from files; author declarations carry no authority. */
export function sourceProductAdmission(files:WorkspaceExport['files']):string[]{
  return sourceProductManifest(files).assetIds;
}
export function sourceProductManifest(files:WorkspaceExport['files']){
  deriveSourceProductReview(files);
  const read=(name:string)=>{const file=files.find(file=>file.path===name);return file?JSON.parse(Buffer.from(file.content,file.encoding).toString('utf8')):undefined;};
  const manifest=read('ontomato.products.json');
  if(!manifest)throw new HttpError(400,'Declare product dependencies in ontomato.products.json; use an empty assetIds array when none are used','PRODUCT_MANIFEST_REQUIRED');
  return productManifestSchema.parse(manifest);
}

/** This conservative scan complements runtime isolation; it is not a proof about arbitrary JavaScript. */
export function deriveSourceProductReview(files:WorkspaceExport['files']){
  const reviewed=[];
  for(const file of files){
    if(!/\.(?:[cm]?js|tsx?|vue|html|css|svg)$/i.test(file.path))continue;
    const source=Buffer.from(file.content,file.encoding).toString('utf8');
    if(/\bcreateAppContext\s*\(/.test(source))throw new HttpError(400,'Initialize sandbox applications with await connectAppContext()','PRODUCT_SDK_UPGRADE_REQUIRED');
    const forbidden=[/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/,/\b(?:axios|sendBeacon)\b/,/\b(?:eval|Function)\s*\(/,/\bimport\s*\(\s*[^'"\s]/,/\b(?:https?:\/\/)[^\s'"<>]+\/(?:api|data|dsl|action|ontology)\//,/['"]\/(?:api\/(?:data|dsl|action|ontology)|dsl\/execute|data\/query)/];
    forbidden.push(/(?:src|href|action|srcset)\s*=\s*["']\s*(?:https?:|\/\/|\/api\/)/i,/url\(\s*["']?\s*(?:https?:|\/\/|\/api\/)/i,/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i,/\b(?:window\.)?(?:parent|top|opener)\s*(?:\.|\[)/,/\b(?:location|document\.location)\s*(?:=|\.\s*(?:href\s*=|assign\s*\(|replace\s*\())/);
    if(forbidden.some(pattern=>pattern.test(source)))throw new HttpError(400,`Use SDK clients for platform access: ${file.path}`,'PRODUCT_SOURCE_ACCESS_REJECTED');
    reviewed.push({path:file.path,hash:createHash('sha256').update(source).digest('hex')});
  }
  return {schemaVersion:2,generated:true,files:reviewed};
}
