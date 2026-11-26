import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { productAuthoringSchema, productTypes,productQuerySchema } from "@ontomato/contracts/product-assets";
import { changeProductDomainGrantRequestSchema, changeProductGrantRequestSchema } from "@ontomato/contracts/product-governance";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { context, wrap } from "../utils/agent-host";
import { listProducts, getProduct, saveProduct, deleteProduct, queryProducts,dependencyProducts,countProductTypes,readProductOverlay,saveProductOverlay } from "../../services/product-assets/store";
import {personalWorkspaceSchema} from '@ontomato/contracts/personal-workspace';
import { HttpError } from "../../utils/errors";
import { cachedZodToJsonSchema } from "../../utils/zod-json-schema";
import {expandedProductDependencies} from '../../services/product-assets/dependencies';
import {validatePageState} from '@ontomato/contracts/product-page-state';
import {discoverProjections,validateDefaultProjections} from '../../services/product-assets/projections';
import {readProductGrantRecords,changeProductGrant,changeProductDomainGrant} from '../../services/product-governance/grants';
import {projectionSourceTypes} from '../../services/product-assets/invalidation';
import {platformObjectTypes} from '../../services/product-assets/platform-objects';
import {readPlatformProjectionObject} from '../../services/product-assets/object-read';
import {registeredProductGraph} from '../../services/product-assets/ontology';
import {migratePlatformProjection} from '../../services/product-assets/platform-migration';
import {migrateDashboardPage} from '../../services/product-assets/dashboard-migration';
import {synchronizePlatformAssets,nativeApplicationAsset} from '../../services/product-assets/platform-assets';
import {assertAppBuilderAccess} from '../../services/app-builder/access';
import {requireManagement} from '../../identity/management';
import {assertLegacyProductWrite} from '../../services/product-assets/panel-boundary';

const router: ReturnType<typeof Router> = Router();
router.post(
  "/synchronize-platform",
  requireManagement(workbenchManagement.platformAssetsSynchronize),
  wrap(async (req, res) => {
    const { owner, credentials } = context(req);
    await assertAppBuilderAccess(credentials);
    res.json(await synchronizePlatformAssets(owner, credentials));
  }),
);
router.post('/:id/create-page',wrap(async(req,res)=>{
  const {owner,credentials}=context(req);
  const source=await getProduct(owner,String(req.params.id));
  const {name}=z.object({name:z.string().trim().min(1).max(200)}).strict().parse(req.body);
  if(source.document.kind!=='layout-template'&&!(source.document.kind==='page'&&source.document.isTemplate))throw new HttpError(400,'Choose a layout template','INVALID_HOME_TEMPLATE');
  res.json({asset:await saveProduct(owner,randomUUID(),{name,description:source.description,visibility:'private',document:{...source.document,kind:'page',isTemplate:false}},0,credentials)});
}));
router.get("/types", wrap(async (_req,res) => { res.json({types:productTypes,schema:cachedZodToJsonSchema(productAuthoringSchema,{target:"jsonSchema7"})}); }));
router.get('/query',wrap(async(req,res)=>{const c=context(req);res.json(await queryProducts(c.owner,productQuerySchema.parse(req.query)));}));
router.get('/counts',wrap(async(req,res)=>{res.json({counts:await countProductTypes(context(req).owner)});}));
router.get('/graph',wrap(async(req,res)=>{const {owner,credentials}=context(req);res.json({graph:await registeredProductGraph(owner,await listProducts(owner),credentials)});}));
router.get('/validation/default-projections',wrap(async(req,res)=>{const c=context(req);res.json(await validateDefaultProjections(c.owner,c.credentials));}));
router.get('/platform-object-types',wrap(async(_req,res)=>{res.json({objectTypes:platformObjectTypes()});}));
router.get('/projections',wrap(async(req,res)=>{const input=z.object({kind:z.enum(['ObjectType','Definition','MetricView','Action']),id:z.string().min(1).max(200)}).parse(req.query);res.json(await discoverProjections(context(req).owner,input.kind,input.id));}));
router.get("/", wrap(async (req,res) => {const c=context(req);res.json({assets:await listProducts(c.owner)}); }));
router.get("/:id", wrap(async (req,res) => {
  const owner = context(req).owner;
  const asset = await getProduct(owner,String(req.params.id));
  const applicationId=await nativeApplicationAsset(owner.domainId,asset.id);
  res.json({asset,...(applicationId?{nativeApplicationId:applicationId}:{})});
}));
router.get('/:id/dependencies',wrap(async(req,res)=>{const c=context(req),id=String(req.params.id);const asset=await getProduct(c.owner,id);res.json(await expandedProductDependencies(c.owner,c.credentials,asset,await dependencyProducts(c.owner,id)));}));
router.post('/:id/migrate-platform',wrap(async(req,res)=>{const c=context(req),input=z.object({revision:z.number().int().positive()}).strict().parse(req.body);res.json({asset:await migratePlatformProjection(c.owner,c.credentials,String(req.params.id),input.revision)});}));
router.post('/:id/migrate-dashboard',wrap(async(req,res)=>{const c=context(req),input=z.object({revision:z.number().int().positive()}).strict().parse(req.body);res.json({asset:await migrateDashboardPage(c.owner,c.credentials,String(req.params.id),input.revision)});}));
router.post('/:id/migrate',wrap(async(req,res)=>{const c=context(req),id=String(req.params.id);const source=await getProduct(c.owner,id);const {revision}=z.object({revision:z.number().int().positive()}).strict().parse(req.body);res.json({asset:await saveProduct(c.owner,id,{name:source.name,description:source.description,visibility:source.visibility,document:source.document},revision,c.credentials)});}));
router.get('/:id/overlay',wrap(async(req,res)=>{res.json(await readProductOverlay(context(req).owner,String(req.params.id)));}));
router.get('/:id/source-types',wrap(async(req,res)=>{const c=context(req);res.json(await projectionSourceTypes(c.owner,String(req.params.id),c.credentials));}));
router.post('/:id/object',wrap(async(req,res)=>{const c=context(req);const {primaryKey,revision}=z.object({primaryKey:z.string().min(1).max(1000),revision:z.number().int().positive().optional()}).strict().parse(req.body);res.json(await readPlatformProjectionObject(c.owner,c.credentials,String(req.params.id),primaryKey,revision));}));
router.get('/:id/grants',wrap(async(req,res)=>{const c=context(req);await getProduct(c.owner,String(req.params.id));res.json(await readProductGrantRecords(String(req.params.id),c.credentials));}));
router.post('/:id/grants',wrap(async(req,res)=>{const c=context(req);await getProduct(c.owner,String(req.params.id));const input=changeProductGrantRequestSchema.parse(req.body);await changeProductGrant(String(req.params.id),input,c.credentials);res.json({success:true});}));
router.post('/:id/domain-grant',wrap(async(req,res)=>{const c=context(req);await getProduct(c.owner,String(req.params.id));const {shared}=changeProductDomainGrantRequestSchema.parse(req.body);await changeProductDomainGrant(String(req.params.id),shared,c.credentials);res.json({success:true});}));
router.post('/:id/state',wrap(async(req,res)=>{const asset=await getProduct(context(req).owner,String(req.params.id));if(asset.document.kind!=='page')throw new HttpError(400,'Expected page','INVALID_REQUEST');const values=z.record(z.unknown()).parse(req.body);try{res.json({state:validatePageState(asset.document.params??{},values)});}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Invalid page state','INVALID_PAGE_STATE');}}));
router.put('/:id/overlay',wrap(async(req,res)=>{const c=context(req);const input=z.object({revision:z.number().int().nonnegative(),workspace:personalWorkspaceSchema}).strict().parse(req.body);await assertLegacyProductWrite(c.owner,c.credentials,{id:String(req.params.id)});res.json(await saveProductOverlay(c.owner,String(req.params.id),input.workspace,input.revision));}));
router.put("/:id", wrap(async (req,res) => {
  const {owner,credentials} = context(req);
  const {revision,...input} = productAuthoringSchema.parse(req.body);
  res.json({asset:await saveProduct(owner,String(req.params.id),input,revision,credentials)});
}));
router.post("/:id/copy", wrap(async (req,res) => {
  const {owner,credentials} = context(req);
  const source = await getProduct(owner,String(req.params.id));
  const {name} = z.object({name:z.string().trim().min(1).max(200)}).strict().parse(req.body);
  const input = {name,description:source.description,visibility:"private" as const,document:source.document};
  res.json({asset:await saveProduct(owner,randomUUID(),input,0,credentials)});
}));
router.delete("/:id", wrap(async (req,res) => {
  const {revision} = z.object({revision:z.number().int().positive()}).strict().parse(req.body);
  const c=context(req);
  await deleteProduct(c.owner,String(req.params.id),revision,c.credentials);
  res.json({success:true});
}));
export default router;
