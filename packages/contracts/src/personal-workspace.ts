import { z } from "zod";

const ids = z.array(z.string().min(1).max(200)).max(100).refine(values => new Set(values).size === values.length);
export const workspaceSectionSchema = z.enum(["apps", "data", "conversations", "objects", "tasks", "recent"]);
export type WorkspaceSection = z.infer<typeof workspaceSectionSchema>;
const sectionList = z.array(workspaceSectionSchema).max(6).refine(items => new Set(items).size === items.length);
export const workspaceSectionsSchema = z.object({ main: sectionList, sidebar: sectionList, hidden: sectionList }).strict().refine(value => {
  const items = [...value.main, ...value.sidebar, ...value.hidden];
  return items.length === 6 && new Set(items).size === 6;
}, "Every section must appear exactly once");
export const personalWorkspaceSchema = z.object({
  schemaVersion: z.literal(1),
  layout: z.enum(["tasks", "data", "assistant"]),
  sections: workspaceSectionsSchema.optional(),
  objectOpening: z.enum(["page", "drawer"]).default("page"),
  dashboardIds: ids,
  applicationIds: ids,
  dashboardCards: z.record(z.string().min(1).max(200), ids).default({}),
  pinnedObjects: z.array(z.object({ className: z.string().min(1).max(200), primaryKey: z.string().min(1).max(1000), title: z.string().trim().min(1).max(200) }).strict()).max(30)
    .refine(items => new Set(items.map(item => JSON.stringify([item.className, item.primaryKey]))).size === items.length).default([]),
  pinnedAnalyses: z.array(z.object({
    sessionId: z.string().uuid(), title: z.string().trim().min(1).max(200),
  }).strict()).max(20).refine(items => new Set(items.map(item => item.sessionId)).size === items.length).default([]),
  interactions: z.object({
    metrics: z.enum(["drawer", "dialog", "page", "conversation"]).default("drawer"),
    tasks: z.enum(["drawer", "dialog", "page", "conversation"]).default("drawer"),
  }).strict().default({ metrics: "drawer", tasks: "drawer" }),
}).strict();
export type PersonalWorkspace = z.infer<typeof personalWorkspaceSchema>;
export const defaultPersonalWorkspace = (): PersonalWorkspace => ({
  schemaVersion: 1, layout: "assistant", objectOpening: "page", dashboardIds: [], applicationIds: [], dashboardCards: {}, pinnedObjects: [], pinnedAnalyses: [], interactions: { metrics: "drawer", tasks: "drawer" },
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
        // eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects.
        && !decoded.includes("//") && !decoded.includes("\\") && !/[\u0000-\u0020\u007f]/.test(decoded)
        && !url.hash && [...url.searchParams.keys()].every(key => ["dashboardId", "sessionId", "primaryKey", "key"].includes(key));
    } catch { return false; }
  }),
}).strict();
export const recentWorkSchema = recentWorkInputSchema.extend({ visitedAt: z.string().datetime() }).strict();
export const recentWorkListSchema = z.array(recentWorkSchema).max(8);
export type RecentWork = z.infer<typeof recentWorkSchema>;
