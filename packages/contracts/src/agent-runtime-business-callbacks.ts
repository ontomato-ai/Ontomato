import { z } from "zod";
import { runtimeKeySchema } from "./agent-runtime-values";

const businessCallbackBaseUrlSchema = z.string().url().refine(value => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol)
    && !url.username && !url.password && !url.search && !url.hash;
}, "Expected an HTTP(S) callback URL");

export const runtimeBusinessCallbackSchema = z.object({
  owner: runtimeKeySchema,
  baseUrl: businessCallbackBaseUrlSchema,
  /** Path boundary of the complete upstream URL, evaluated before forwarding. */
  pathPrefix: z.string().min(2).startsWith("/").regex(/^[^?#\\]+$/),
  credentialHeader: z.enum(["X-Ontomato-Callback-Credential", "tk"]),
  credential: z.string().min(1),
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
