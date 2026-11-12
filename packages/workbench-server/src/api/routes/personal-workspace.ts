import { Router } from "express";
import { defaultPersonalWorkspace, personalWorkspaceSchema, recentWorkInputSchema, recentWorkListSchema } from "@ontomato/contracts/personal-workspace";
import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";
import { requireDomainId, type AuthenticatedRequest } from "../../utils/request-identity";
import { asyncHandler } from "../utils/http";

const router: ReturnType<typeof Router> = Router();
function owner(req: AuthenticatedRequest) {
  return [req.userId, `personal-workspace:${requireDomainId(req)}`];
}
router.get("/recent", asyncHandler(async (req, res) => {
  const identity = owner(req as AuthenticatedRequest);
  const result = await getPostgresPool().query(
    `SELECT value FROM ${qualifiedTable("user_preferences")} WHERE user_id=$1 AND key=$2`,
    [identity[0], `${identity[1]}:recent`],
  );
  res.json({ data: recentWorkListSchema.parse(result.rows[0]?.value ?? []) });
}));
router.post("/recent", asyncHandler(async (req, res) => {
  const parsed = recentWorkInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_RECENT_WORK" }); return; }
  const identity = owner(req as AuthenticatedRequest);
  const item = { ...parsed.data, visitedAt: new Date().toISOString() };
  const table = qualifiedTable("user_preferences");
  // Merge in SQL so two open tabs cannot overwrite each other's visits.
  await getPostgresPool().query(
    `INSERT INTO ${table} AS preferences (user_id,key,value) VALUES ($1,$2,jsonb_build_array($3::jsonb))
     ON CONFLICT (user_id,key) DO UPDATE SET value=(
       SELECT jsonb_agg(entry ORDER BY position) FROM (
         SELECT entry, position FROM jsonb_array_elements(jsonb_build_array($3::jsonb) || preferences.value)
           WITH ORDINALITY AS history(entry,position)
         WHERE position=1 OR entry->>'path' <> ($3::jsonb)->>'path'
         ORDER BY position LIMIT 8
       ) recent
     ),updated_at=now()`,
    [identity[0], `${identity[1]}:recent`, JSON.stringify(item)],
  );
  res.json({ data: item });
}));
router.get("/", asyncHandler(async (req, res) => {
  const result = await getPostgresPool().query(
    `SELECT value FROM ${qualifiedTable("user_preferences")} WHERE user_id=$1 AND key=$2`, owner(req as AuthenticatedRequest),
  );
  res.json({ data: result.rows[0] ? personalWorkspaceSchema.parse(result.rows[0].value) : defaultPersonalWorkspace() });
}));
router.put("/", asyncHandler(async (req, res) => {
  const parsed = personalWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_PERSONAL_WORKSPACE" }); return; }
  await getPostgresPool().query(
    `INSERT INTO ${qualifiedTable("user_preferences")} (user_id,key,value) VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (user_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
    [...owner(req as AuthenticatedRequest), JSON.stringify(parsed.data)],
  );
  res.json({ data: parsed.data });
}));
export default router;
