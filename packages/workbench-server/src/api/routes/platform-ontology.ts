import { Router } from "express";
import { z } from "zod";
import { context, wrap } from "../utils/agent-host";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import {
  readPlatformOntologyCounts,
  readPlatformOntologyNeighbors,
  readPlatformOntologyObjects,
  readPlatformOntologySchema,
  readPlatformOntologyStart,
} from "../../services/platform-ontology/query";

const layerSchema = z.enum(["fact", "capability", "governance", "product"]);

const nodeRefSchema = z
  .object({
    className: z.string().min(1).max(120),
    primaryKey: z.string().min(1).max(500),
  })
  .strict();

const neighborsBodySchema = z
  .object({
    node: nodeRefSchema,
    relationKinds: z.array(z.string().min(1).max(120)).max(100).optional(),
    layers: z.array(layerSchema).max(4).optional(),
  })
  .strict();

const objectsBodySchema = z
  .object({
    type: z.string().min(1).max(120),
    keyword: z.string().max(200).optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
  })
  .strict();

export const platformOntologyRouter = Router();

platformOntologyRouter.get(
  "/schema",
  wrap(async (_req, res) => {
    res.json(readPlatformOntologySchema());
  }),
);

platformOntologyRouter.get(
  "/counts",
  wrap(async (req, res) => {
    const c = context(req);
    res.json(await readPlatformOntologyCounts(c.owner, c.credentials));
  }),
);

platformOntologyRouter.get(
  "/start",
  wrap(async (req, res) => {
    const c = context(req);
    const callerUserName = (req as AuthenticatedRequest).userName;
    res.json(await readPlatformOntologyStart(c.owner, c.credentials, callerUserName));
  }),
);

platformOntologyRouter.post(
  "/neighbors",
  wrap(async (req, res) => {
    const c = context(req);
    const input = neighborsBodySchema.parse(req.body);
    const callerUserName = (req as AuthenticatedRequest).userName;
    res.json(await readPlatformOntologyNeighbors(c.owner, c.credentials, input, callerUserName));
  }),
);

platformOntologyRouter.post(
  "/objects",
  wrap(async (req, res) => {
    const c = context(req);
    const input = objectsBodySchema.parse(req.body);
    res.json(await readPlatformOntologyObjects(c.owner, c.credentials, input));
  }),
);
