import { z } from 'zod';
import { productManifestSchema } from '@ontomato/contracts/product-assets';
import type { WorkspaceExport } from '@ontomato/contracts/workspaces';
import { HttpError } from '../../utils/errors';

const reviewSchema=z.object({
  schemaVersion:z.literal(1),
  checks:z.object({capabilityReads:z.literal(true),actionWrites:z.literal(true),noBusinessRules:z.literal(true),disposablePresentation:z.literal(true)}).strict(),
}).strict();

/** A committed review record is required; it is an author declaration, not proof about arbitrary source. */
export function sourceProductAdmission(files:WorkspaceExport['files']):string[]{
  const read=(name:string)=>{const file=files.find(file=>file.path===name);return file?JSON.parse(Buffer.from(file.content,file.encoding).toString('utf8')):undefined;};
  const review=reviewSchema.safeParse(read('ontomato.product-review.json'));
  if(!review.success)throw new HttpError(400,'Commit ontomato.product-review.json after reviewing capability reads, Action writes, business rules and disposable presentation','PRODUCT_REVIEW_REQUIRED');
  const manifest=read('ontomato.products.json');
  if(!manifest)throw new HttpError(400,'Declare product dependencies in ontomato.products.json; use an empty assetIds array when none are used','PRODUCT_MANIFEST_REQUIRED');
  return productManifestSchema.parse(manifest).assetIds;
}
