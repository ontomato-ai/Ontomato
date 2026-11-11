import {
  homeDashboardsSchema,
  homeFavoritesSchema,
  type HomeState,
} from "@ontomato/contracts/platform-home";
import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";

export interface PlatformHomeOwner {
  domainId: string;
  userId: string;
}

const db = () => getPostgresPool();

function usageRow(row: {
  applicationId: string;
  lastOpenedAt: Date;
}): HomeState["recentApplications"][number] {
  return {
    applicationId: row.applicationId,
    lastOpenedAt: row.lastOpenedAt.toISOString(),
  };
}

export const platformHomeStore = {
  /** Missing preferences are an empty selection; only a first save creates the row. */
  async preferences(
    owner: PlatformHomeOwner,
  ): Promise<Pick<HomeState, "favorites" | "dashboardIds">> {
    const result = await db().query(
      `SELECT favorites, dashboard_ids FROM ${table("platform_home_preferences")} WHERE domain_id=$1 AND user_id=$2`,
      [owner.domainId, owner.userId],
    );
    if (!result.rowCount) return { favorites: [], dashboardIds: [] };
    return {
      favorites: homeFavoritesSchema.shape.items.parse(result.rows[0].favorites),
      dashboardIds: homeDashboardsSchema.shape.ids.parse(
        result.rows[0].dashboard_ids,
      ),
    };
  },
  async saveFavorites(
    owner: PlatformHomeOwner,
    favorites: HomeState["favorites"],
  ): Promise<void> {
    await db().query(
      `INSERT INTO ${table("platform_home_preferences")} (domain_id, user_id, favorites)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (domain_id, user_id) DO UPDATE SET favorites=EXCLUDED.favorites`,
      [owner.domainId, owner.userId, JSON.stringify(favorites)],
    );
  },
  async saveDashboards(
    owner: PlatformHomeOwner,
    dashboardIds: HomeState["dashboardIds"],
  ): Promise<void> {
    await db().query(
      `INSERT INTO ${table("platform_home_preferences")} (domain_id, user_id, dashboard_ids)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (domain_id, user_id) DO UPDATE SET dashboard_ids=EXCLUDED.dashboard_ids`,
      [owner.domainId, owner.userId, JSON.stringify(dashboardIds)],
    );
  },
  async recentApplications(
    owner: PlatformHomeOwner,
  ): Promise<HomeState["recentApplications"]> {
    const result = await db().query(
      `SELECT application_id AS "applicationId", last_opened_at AS "lastOpenedAt"
       FROM ${table("platform_application_usage")}
       WHERE domain_id=$1 AND user_id=$2
       ORDER BY last_opened_at DESC, application_id`,
      [owner.domainId, owner.userId],
    );
    return result.rows.map(usageRow);
  },
  async recordApplicationOpen(
    owner: PlatformHomeOwner,
    applicationId: string,
  ): Promise<HomeState["recentApplications"][number]> {
    const result = await db().query(
      `INSERT INTO ${table("platform_application_usage")} (domain_id, user_id, application_id, last_opened_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (domain_id, user_id, application_id) DO UPDATE SET last_opened_at=EXCLUDED.last_opened_at
       RETURNING application_id AS "applicationId", last_opened_at AS "lastOpenedAt"`,
      [owner.domainId, owner.userId, applicationId],
    );
    return usageRow(result.rows[0]);
  },
};

/** A deleted global account loses its home data in every domain. */
export async function deleteUserHomeData(userId: string): Promise<void> {
  await transaction(async (client) => {
    await client.query(
      `DELETE FROM ${table("platform_home_preferences")} WHERE user_id=$1`,
      [userId],
    );
    await client.query(
      `DELETE FROM ${table("platform_application_usage")} WHERE user_id=$1`,
      [userId],
    );
  });
}
