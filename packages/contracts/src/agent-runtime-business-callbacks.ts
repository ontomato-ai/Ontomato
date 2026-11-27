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
  generation: runtimeBusinessCallbackSchema.optional(),
  retrieval: runtimeBusinessCallbackSchema.optional(),
  governance: runtimeBusinessCallbackSchema.optional(),
  knowledgeSubmit: runtimeBusinessCallbackSchema.optional(),
}).strict();
export type RuntimeBusinessCallback = z.infer<typeof runtimeBusinessCallbackSchema>;
export type RuntimeBusinessCallbacks = z.infer<typeof runtimeBusinessCallbacksSchema>;

/** A callback sets this narrowing header after authentication. It never grants access. */
export const AGENT_EXECUTION_HEADER = "X-Ontomato-Agent-Execution";

/** Check the decoded path before sending its original wire encoding to an owner. */
export function unsafeCallbackPath(path: string): boolean {
  return /[\\%?#;\p{Cc}]/u.test(path) || path.startsWith("//") ||
    path.split("/").some(segment => segment === "." || segment === "..");
}

/** Forward end-to-end headers for the decoded response body returned by fetch. */
export function callbackResponseHeaders(headers: Headers, set: (name: string, value: string | string[]) => void) {
  const excluded = new Set([
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer",
    "transfer-encoding", "upgrade", "content-encoding", "content-length", "set-cookie",
    ...(headers.get("connection") ?? "").toLowerCase().split(",").map(name => name.trim()),
  ]);
  headers.forEach((value, name) => {
    if (!excluded.has(name)) set(name, value);
  });
  const cookies = headers.getSetCookie();
  if (cookies.length) set("set-cookie", cookies);
}
