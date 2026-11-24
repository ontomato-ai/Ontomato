import { z } from "zod";

const businessCallbackBaseUrlSchema = z.string().url().refine(value => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol)
    && !url.username && !url.password && !url.search && !url.hash
    && url.pathname !== "/";
}, "Expected an HTTP(S) callback URL with a path prefix");

export const runtimeBusinessCallbackSchema = z.object({
  /** Workbench URL and the boundary of the path this declaration may forward. */
  baseUrl: businessCallbackBaseUrlSchema,
  /** Workbench seals the run, path prefix, delegated authority and expiry. */
  credential: z.string().regex(/^wbc1\.[A-Za-z0-9_-]+$/),
}).strict();

export const runtimeBusinessCallbacksSchema = z.object({
  workbench: runtimeBusinessCallbackSchema.optional(),
  ontology: runtimeBusinessCallbackSchema.optional(),
  panelOperations: runtimeBusinessCallbackSchema.optional(),
  authoring: runtimeBusinessCallbackSchema.optional(),
  retrieval: runtimeBusinessCallbackSchema.optional(),
  governance: runtimeBusinessCallbackSchema.optional(),
  product: runtimeBusinessCallbackSchema.optional(),
}).strict();
export type RuntimeBusinessCallback = z.infer<typeof runtimeBusinessCallbackSchema>;
export type RuntimeBusinessCallbacks = z.infer<typeof runtimeBusinessCallbacksSchema>;
