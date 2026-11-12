import { z } from "zod";

const ids = z.array(z.string().min(1).max(200)).max(100).refine(values => new Set(values).size === values.length);
export const personalWorkspaceSchema = z.object({
  schemaVersion: z.literal(1),
  layout: z.enum(["tasks", "data", "assistant"]),
  dashboardIds: ids,
  applicationIds: ids,
  dashboardCards: z.record(z.string().min(1).max(200), ids).default({}),
  interactions: z.object({
    metrics: z.enum(["drawer", "dialog", "page", "conversation"]).default("drawer"),
    tasks: z.enum(["drawer", "dialog", "page", "conversation"]).default("drawer"),
  }).strict().default({ metrics: "drawer", tasks: "drawer" }),
}).strict();
export type PersonalWorkspace = z.infer<typeof personalWorkspaceSchema>;
export const defaultPersonalWorkspace = (): PersonalWorkspace => ({
  schemaVersion: 1, layout: "assistant", dashboardIds: [], applicationIds: [], dashboardCards: {}, interactions: { metrics: "drawer", tasks: "drawer" },
});

/** Only business navigation is retained; credentials and arbitrary query strings never enter history. */
export const recentWorkInputSchema = z.object({
  appId: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  path: z.string().max(2000).refine(value => {
    try {
      const url = new URL(value, "https://workspace.invalid");
      const decoded = decodeURIComponent(value);
      return value.startsWith("/") && url.origin === "https://workspace.invalid"
        && !decoded.includes("//") && !decoded.includes("\\") && !/[\u0000-\u0020\u007f]/.test(decoded)
        && !url.hash && [...url.searchParams.keys()].every(key => ["dashboardId", "sessionId", "primaryKey"].includes(key));
    } catch { return false; }
  }),
}).strict();
export const recentWorkSchema = recentWorkInputSchema.extend({ visitedAt: z.string().datetime() }).strict();
export const recentWorkListSchema = z.array(recentWorkSchema).max(8);
export type RecentWork = z.infer<typeof recentWorkSchema>;
