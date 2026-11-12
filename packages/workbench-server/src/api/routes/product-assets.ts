import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { productSaveSchema, productTypes } from "@ontomato/contracts/product-assets";
import { context, wrap } from "../utils/agent-host";
import { listProducts, getProduct, saveProduct, deleteProduct, personalHome } from "../../services/product-assets/store";
import { HttpError } from "../../utils/errors";
import { zodToJsonSchema } from "zod-to-json-schema";
import {productDependencies} from '@ontomato/contracts/product-dependencies';

const router: ReturnType<typeof Router> = Router();
router.post('/:id/create-page',wrap(async(req,res)=>{
  const {owner,credentials}=context(req);
  const source=await getProduct(owner,String(req.params.id));
  const {name}=z.object({name:z.string().trim().min(1).max(200)}).strict().parse(req.body);
  if(source.document.kind!=='layout-template')throw new HttpError(400,'Choose a layout template','INVALID_HOME_TEMPLATE');
  res.json({asset:await saveProduct(owner,randomUUID(),{name,description:source.description,visibility:'private',document:{...source.document,kind:'page'}},0,credentials)});
}));
router.get("/types", wrap(async (_req,res) => { res.json({types:productTypes,schema:zodToJsonSchema(productSaveSchema,{target:"jsonSchema7"})}); }));
router.get("/home", wrap(async (req,res) => { const c=context(req);res.json({asset:await personalHome(c.owner,c.credentials)}); }));
router.get("/", wrap(async (req,res) => { res.json({assets:await listProducts(context(req).owner)}); }));
router.get("/:id", wrap(async (req,res) => {
  const owner = context(req).owner;
  const asset = await getProduct(owner,String(req.params.id));
  const assets = await listProducts(owner);
  res.json({asset,...productDependencies(asset,assets)});
}));
router.put("/:id", wrap(async (req,res) => {
  const {owner,credentials} = context(req);
  const {revision,...input} = productSaveSchema.parse(req.body);
  res.json({asset:await saveProduct(owner,String(req.params.id),input,revision,credentials)});
}));
router.post("/:id/copy", wrap(async (req,res) => {
  const {owner,credentials} = context(req);
  const source = await getProduct(owner,String(req.params.id));
  const {name} = z.object({name:z.string().trim().min(1).max(200)}).strict().parse(req.body);
  const input = {name,description:source.description,visibility:"private" as const,document:source.document};
  res.json({asset:await saveProduct(owner,randomUUID(),input,0,credentials)});
}));
router.post("/:id/use-home", wrap(async (req,res) => {
  const {owner,credentials} = context(req);
  const {revision} = z.object({revision:z.number().int().positive()}).strict().parse(req.body);
  const source = await getProduct(owner,String(req.params.id));
  if (source.document.kind !== "layout-template" && source.document.kind !== "page") throw new HttpError(400,"Choose a page or layout template","INVALID_HOME_TEMPLATE");
  const home = await personalHome(owner,credentials);
  const input = {name:home.name,description:home.description,visibility:"private" as const,document:{...source.document,kind:"page" as const}};
  res.json({asset:await saveProduct(owner,home.id,input,revision,credentials)});
}));
router.delete("/:id", wrap(async (req,res) => {
  const {revision} = z.object({revision:z.number().int().positive()}).strict().parse(req.body);
  await deleteProduct(context(req).owner,String(req.params.id),revision);
  res.json({success:true});
}));
export default router;
