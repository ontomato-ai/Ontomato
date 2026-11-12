import {
  defaultPersonalWorkspace,
  personalWorkspaceSchema,
  recentWorkListSchema,
  type PersonalWorkspace,
  type RecentWork,
} from "@ontomato/contracts/personal-workspace";
import { getPostgresPool, qualifiedTable } from "../../infrastructure/postgres";

export interface PersonalWorkspaceOwner {
  domainId: string;
  userId: string;
}

/** Each domain keeps its own workspace and history inside the user's preference rows. */
const key = (owner: PersonalWorkspaceOwner) => `personal-workspace:${owner.domainId}`;

export const personalWorkspaceStore = {
  async recent(owner: PersonalWorkspaceOwner): Promise<RecentWork[]> {
    const result = await getPostgresPool().query(
      `SELECT value FROM ${qualifiedTable("user_preferences")} WHERE user_id=$1 AND key=$2`,
      [owner.userId, `${key(owner)}:recent`],
    );
    return recentWorkListSchema.parse(result.rows[0]?.value ?? []);
  },

  async recordVisit(owner: PersonalWorkspaceOwner, item: RecentWork): Promise<void> {
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
      [owner.userId, `${key(owner)}:recent`, JSON.stringify(item)],
    );
  },

  async read(owner: PersonalWorkspaceOwner): Promise<PersonalWorkspace> {
    const result = await getPostgresPool().query(
      `SELECT value FROM ${qualifiedTable("user_preferences")} WHERE user_id=$1 AND key=$2`,
      [owner.userId, key(owner)],
    );
    return result.rows[0] ? personalWorkspaceSchema.parse(result.rows[0].value) : defaultPersonalWorkspace();
  },

  async save(owner: PersonalWorkspaceOwner, workspace: PersonalWorkspace): Promise<void> {
    await getPostgresPool().query(
      `INSERT INTO ${qualifiedTable("user_preferences")} (user_id,key,value) VALUES ($1,$2,$3::jsonb)
       ON CONFLICT (user_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
      [owner.userId, key(owner), JSON.stringify(workspace)],
    );
  },
};
