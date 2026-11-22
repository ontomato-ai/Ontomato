import { Router } from "express";
import {
  domainComponentListResponseSchema, domainComponentParamsSchema, domainComponentResponseSchema,
  domainComponentRevisionQuerySchema, domainComponentUsedBySchema, registerDomainComponentRequestSchema, updateDomainComponentRequestSchema,
} from "@ontomato/contracts/domain-components";
import {
  deleteDomainComponent, domainComponentUsedBy, listDomainComponents, readDomainComponent, registerDomainComponent, updateDomainComponent,
} from "../../services/domain-components/catalog";
import { context, wrap } from "../utils/agent-host";

export const domainComponentsRouter = Router();
domainComponentsRouter.get("/", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const components = await listDomainComponents(owner, credentials);
  res.set("Cache-Control", "no-store").json(domainComponentListResponseSchema.parse({ components }));
}));
domainComponentsRouter.post("/", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const component = await registerDomainComponent(owner, credentials, registerDomainComponentRequestSchema.parse(req.body));
  res.status(201).json(domainComponentResponseSchema.parse({ component }));
}));
domainComponentsRouter.get("/:id", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { id } = domainComponentParamsSchema.parse(req.params);
  const component = await readDomainComponent(owner, credentials, id);
  res.set("Cache-Control", "no-store").json(domainComponentResponseSchema.parse({ component }));
}));
domainComponentsRouter.get("/:id/used-by", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { id } = domainComponentParamsSchema.parse(req.params);
  res.set("Cache-Control", "no-store").json(domainComponentUsedBySchema.parse(await domainComponentUsedBy(owner, credentials, id)));
}));
domainComponentsRouter.put("/:id", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { id } = domainComponentParamsSchema.parse(req.params);
  const component = await updateDomainComponent(owner, credentials, id, updateDomainComponentRequestSchema.parse(req.body));
  res.json(domainComponentResponseSchema.parse({ component }));
}));
domainComponentsRouter.delete("/:id", wrap(async (req, res) => {
  const { owner, credentials } = context(req);
  const { id } = domainComponentParamsSchema.parse(req.params);
  const { revision } = domainComponentRevisionQuerySchema.parse(req.query);
  await deleteDomainComponent(owner, credentials, id, revision);
  res.status(204).end();
}));
