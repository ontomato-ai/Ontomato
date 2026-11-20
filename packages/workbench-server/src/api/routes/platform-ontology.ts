import { Router } from "express";
import {
  platformOntologyNeighborsRequestSchema,
  platformOntologyObjectsRequestSchema,
  type PlatformOntologyStartResponse,
} from "@ontomato/contracts/platform-ontology";
import { context, wrap } from "../utils/agent-host";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import {
  readPlatformOntologyCounts,
  readPlatformOntologyNeighbors,
  readPlatformOntologyObjects,
  readPlatformOntologySchema,
  readPlatformOntologyStart,
} from "../../services/platform-ontology/query";

export const platformOntologyRouter = Router();

platformOntologyRouter.get(
  "/schema",
  wrap(async (_req, res) => {
    res.json(await readPlatformOntologySchema());
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
    const node = await readPlatformOntologyStart(c.owner, c.credentials, callerUserName);
    res.json({ node } satisfies PlatformOntologyStartResponse);
  }),
);

platformOntologyRouter.post(
  "/neighbors",
  wrap(async (req, res) => {
    const c = context(req);
    const input = platformOntologyNeighborsRequestSchema.parse(req.body);
    const callerUserName = (req as AuthenticatedRequest).userName;
    res.json(await readPlatformOntologyNeighbors(c.owner, c.credentials, input, callerUserName));
  }),
);

platformOntologyRouter.post(
  "/objects",
  wrap(async (req, res) => {
    const c = context(req);
    const input = platformOntologyObjectsRequestSchema.parse(req.body);
    res.json(await readPlatformOntologyObjects(c.owner, c.credentials, input));
  }),
);
