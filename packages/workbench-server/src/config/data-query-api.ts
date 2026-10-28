import { z } from "zod";
import { getLocale, languageSwitchEnabled } from "../i18n";
import { environment } from "./environment";

const configSchema = z.object({
  baseUrl: z.string().url().optional(),
  userId: z.string().optional(),
  timeout: z.number().default(30000),
  endpoints: z
    .object({
      findKnowledge: z.string().default("/knowledge/findknowledge"),
      getNodeIds: z.string().default("/dsl/getNodeIds"),
    })
    .default({
      findKnowledge: "/hotData/findKnowledge",
      getNodeIds: "/dsl/getNodeIds",
    }),
});

export type ApiConfig = z.infer<typeof configSchema>;

export function getApiConfig(): ApiConfig {
  const baseUrl =
    environment.queryBase() ||
    process.env.API_BASE_URL ||
    "http://localhost:8082";
  const timeout = environment.queryTimeout();

  return configSchema.parse({
    baseUrl,
    userId: "anonymous",
    timeout,
    endpoints: {
      findKnowledge:
        process.env.DATA_QUERY_FIND_KNOWLEDGE_ENDPOINT ||
        "/knowledge/findknowledge",
      getNodeIds:
        process.env.DATA_QUERY_GET_NODE_IDS_ENDPOINT || "/dsl/getNodeIds",
    },
  });
}

export function buildHeaders(
  config: ApiConfig,
  token?: string,
  userId?: string,
  locale?: string,
  apiKey?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (token) {
    headers["tk"] = token;
  }

  // apiKey actively passed in by the frontend, associated with the user
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  const uid = userId || config.userId || "anonymous";

  if (uid) {
    headers["uid"] = uid;
  }

  headers["x-client-id"] = uid;

  headers["Accept-Language"] =
    locale && languageSwitchEnabled() ? locale : getLocale();
  return headers;
}

export function buildUrl(apiConfig: ApiConfig, endpoint: string): string {
  if (!apiConfig.baseUrl) {
    throw new Error("API baseUrl is not configured");
  }

  const base = apiConfig.baseUrl.endsWith("/")
    ? apiConfig.baseUrl.slice(0, -1)
    : apiConfig.baseUrl;
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  return `${base}${path}`;
}

export function isApiConfigured(): boolean {
  const apiConfig = getApiConfig();
  return !!apiConfig.baseUrl;
}
