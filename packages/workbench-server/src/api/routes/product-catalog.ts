import type { Router } from "express";
import {
  copyProductCurrentRequestSchema, deleteProductCurrentQuerySchema, deleteProductCurrentResponseSchema,
  deleteProductPanelResponseSchema,
  productCatalogQuerySchema, productCurrentIdParamsSchema,
  productPanelListResponseSchema, productPanelResponseSchema, productPanelUsedBySchema,
  productProjectionListResponseSchema, productProjectionResponseSchema, productProjectionUsedBySchema,
} from "@ontomato/contracts/product-panels";
import {
  changeProductDomainGrantRequestSchema, changeProductGrantRequestSchema, changeProductPanelDomainGrantResponseSchema,
  productGrantChangeResponseSchema, productGrantsResponseSchema,
} from "@ontomato/contracts/product-governance";
import type { CurrentProductKind } from "../../infrastructure/product-current";
import {
  changeCurrentProductDomainGrant, changeCurrentProductGrant, copyCurrentProduct, currentProductGrants, currentProductUsedBy,
  deleteCurrentProduct, listCurrentProducts,
} from "../../services/product-panels/catalog";
import { HttpError } from "../../utils/errors";
import { validateParams } from "../middleware/validate";
import { context, wrap } from "../utils/agent-host";
import { asyncHandler } from "../utils/http";

export function mountProductCatalog(router: Router, kind: CurrentProductKind) {
  router.get("/", wrap(async (req, res) => {
    const { owner, credentials } = context(req);
    const query = productCatalogQuerySchema.parse(req.query);
    const result = await listCurrentProducts(owner, credentials, kind, query);
    const schema = kind === "projection" ? productProjectionListResponseSchema : productPanelListResponseSchema;
    res.json(schema.parse(result));
  }));
  router.get("/:id/used-by", wrap(async (req, res) => {
    const { owner, credentials } = context(req);
    const { id } = productCurrentIdParamsSchema.parse(req.params);
    const result = await currentProductUsedBy(owner, credentials, kind, id);
    const schema = kind === "projection" ? productProjectionUsedBySchema : productPanelUsedBySchema;
    res.json(schema.parse(result));
  }));
  router.delete("/:id", validateParams(productCurrentIdParamsSchema), asyncHandler(async (req, res) => {
    const { owner, credentials } = context(req);
    const query = deleteProductCurrentQuerySchema.safeParse(req.query);
    if (!query.success)
      throw new HttpError(400, "A current revision is required", "INVALID_REQUEST", { issues: query.error.issues });
    const result = await deleteCurrentProduct(owner, credentials, kind, req.params.id, query.data.revision);
    const schema = kind === "panel" ? deleteProductPanelResponseSchema : deleteProductCurrentResponseSchema;
    res.json(schema.parse(result));
  }));
  router.post("/:id/copy", wrap(async (req, res) => {
    const { owner, credentials } = context(req);
    const { id } = productCurrentIdParamsSchema.parse(req.params);
    const copy = copyProductCurrentRequestSchema.parse(req.body);
    const record = await copyCurrentProduct(owner, credentials, kind, id, copy);
    res.json(kind === "projection"
      ? productProjectionResponseSchema.parse({ projection: record })
      : productPanelResponseSchema.parse({ panel: record }));
  }));
  router.get("/:id/grants", wrap(async (req, res) => {
    const { owner, credentials } = context(req);
    const { id } = productCurrentIdParamsSchema.parse(req.params);
    res.json(productGrantsResponseSchema.parse(await currentProductGrants(owner, credentials, kind, id)));
  }));
  router.post("/:id/grants", wrap(async (req, res) => {
    const { owner, credentials } = context(req);
    const { id } = productCurrentIdParamsSchema.parse(req.params);
    const grant = changeProductGrantRequestSchema.parse(req.body);
    await changeCurrentProductGrant(owner, credentials, kind, id, grant);
    res.json(productGrantChangeResponseSchema.parse({ success: true }));
  }));
  router.post("/:id/domain-grant", wrap(async (req, res) => {
    const { owner, credentials } = context(req);
    const { id } = productCurrentIdParamsSchema.parse(req.params);
    const { shared } = changeProductDomainGrantRequestSchema.parse(req.body);
    const result = await changeCurrentProductDomainGrant(owner, credentials, kind, id, shared);
    const schema = kind === "panel" ? changeProductPanelDomainGrantResponseSchema : productGrantChangeResponseSchema;
    res.json(schema.parse(result));
  }));
}
