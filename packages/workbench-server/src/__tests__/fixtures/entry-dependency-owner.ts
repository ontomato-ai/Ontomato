import { entryDependencyChangeRequestSchema, type EntryRoots } from "@ontomato/contracts/entry-dependencies";
import type { Express, RequestHandler } from "express";
import { z } from "zod";

type Entry = { entryId: string; roots: EntryRoots };
const affectedRootsRequest = z.object({ domainId: z.string().min(1), panelIds: z.array(z.string().min(1)) });

/** Serve the Java wire contract from the fixture's own application registrations. */
export function mountEntryDependencyOwner(app: Express, {
  prefix = "", token, entries,
}: {
  prefix?: string;
  token: string;
  entries: (domainId: string) => readonly Entry[];
}) {
  const trusted: RequestHandler = (req, res, next) => {
    if (req.header("X-Ontomato-Query-Service-Token") !== token) {
      res.sendStatus(401);
      return;
    }
    next();
  };
  app.post(prefix + "/platform/applications/service/affected-entry-roots", trusted, (req, res) => {
    const parsed = affectedRootsRequest.safeParse(req.body);
    if (!parsed.success) { res.sendStatus(400); return; }
    const { domainId, panelIds } = parsed.data;
    const affected = entries(domainId).filter(({ roots }) => roots.panelIds.some(id => panelIds.includes(id)));
    res.json({ success: true, data: { entries: affected } });
  });
  app.post(prefix + "/permissions/service/entry-dependency-changes", trusted, (req, res) => {
    if (!entryDependencyChangeRequestSchema.safeParse(req.body).success) { res.sendStatus(400); return; }
    res.json({ success: true });
  });
}
