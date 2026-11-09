import { expect, it, vi } from "vitest";
import { ensureAssistantDecisionsSchema } from "../schema";

it("upgrades an existing decision table with the admission marker", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  await ensureAssistantDecisionsSchema({ query } as never);
  expect(query.mock.calls.some(([sql]) => sql.includes("ALTER TABLE") &&
    sql.includes("ADD COLUMN IF NOT EXISTS admitted boolean NOT NULL DEFAULT false"))).toBe(true);
});
