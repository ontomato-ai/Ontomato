import type { AgentTool } from "../../../../../core/agent-loop/index";
import { getApiConfig, buildUrl } from "../../../../../config/data-query-api";
import { backendPost } from "../../../../../utils/backend-client";
import { combineResultTruncation, parseQueryAnswerPayloads } from "../../../../../utils/query-answer-protocol";
import { createLogger } from "../../../../../logging/logger";
import { getBackendConfig } from "../../backend-config-fetcher";
import { runtimeDefaults } from "../../../../../runtime/defaults";
import type { DiagnosisCallerIdentity } from "./caller-identity";
import { tApp } from "../../../../../i18n";


const logger = createLogger("observe:tool:data-query-execute");

const ENDPOINT = "/dsl/executeV1";
const MAX_RECORD_LENGTH = 800;
const SAMPLE_LIMIT = 25;

function formatRecord(record: unknown): string {
  const json = JSON.stringify(record);
  const line = json ?? String(record);
  return line.length > MAX_RECORD_LENGTH ? `${line.slice(0, MAX_RECORD_LENGTH)}...` : line;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createDataQueryExecuteTool(caller: DiagnosisCallerIdentity): AgentTool {
  const dataAdapter = getBackendConfig()?.dataAdapter || runtimeDefaults().defaultDataAdapter;
  const description =
    tApp("diag.observe.agent.tools.data-query-execute-tool.1", { p0: dataAdapter }) +
    tApp("diag.observe.agent.tools.data-query-execute-tool.2");

  return {
    name: "data_query_execute",
    description,
    parameters: {
      type: "object",
      properties: {
        query: { type: "object", description: tApp("diag.observe.agent.tools.data-query-execute-tool.3"), additionalProperties: true },
        limit: { type: "number", description: tApp("diag.observe.agent.tools.data-query-execute-tool.4"), default: 25 },
      },
      required: ["query"],
    },
    async execute(_toolCallId, params, signal) {
      const query = params.query;
      if (!isRecord(query) || Object.keys(query).length === 0) {
        return { content: [{ type: "text", text: tApp("diag.observe.agent.tools.data-query-execute-tool.6") }] };
      }

      const requestedLimit = typeof params.limit === "number" && Number.isFinite(params.limit) ? params.limit : SAMPLE_LIMIT;
      const limit = Math.min(Math.max(Math.floor(requestedLimit), 1), SAMPLE_LIMIT);

      try {
        const apiConfig = getApiConfig();
        const url = buildUrl(apiConfig, ENDPOINT);
        const resp = await backendPost(
          ENDPOINT,
          url,
          query,
          {
            token: caller.token,
            apiKey: caller.apiKey,
            timeoutMs: 30_000,
            retries: 1,
            signal,
          }
        );
        let json: unknown;
        try {
          json = JSON.parse(resp.text);
        } catch {
          return { content: [{ type: "text", text: tApp("diag.observe.agent.tools.data-query-execute-tool.9") }] };
        }
        if (!isRecord(json)) {
          return { content: [{ type: "text", text: tApp("diag.observe.agent.tools.data-query-execute-tool.9") }] };
        }
        if (json.error !== undefined) {
          const message = typeof json.error === "string" && json.error ? json.error : tApp("diag.observe.agent.tools.data-query-execute-tool.7");
          return { content: [{ type: "text", text: tApp("diag.observe.agent.tools.data-query-execute-tool.8", { p0: message }) }] };
        }
        const packs = parseQueryAnswerPayloads(json.data);
        const rows = packs.flatMap((pack) => pack.answer);
        const truncation = combineResultTruncation(packs);
        const totalCount = rows.length;
        if (totalCount === 0 && !truncation) {
          return { content: [{ type: "text", text: tApp("diag.observe.agent.tools.data-query-execute-tool.10") }] };
        }

        const records = rows.slice(0, limit);
        const header = truncation
          ? tApp("diag.observe.agent.tools.data-query-execute-tool.partial", { p0: totalCount, p1: records.length, p2: truncation.truncationHint })
          : tApp("diag.observe.agent.tools.data-query-execute-tool.11", { p0: totalCount, p1: records.length });
        return {
          content: [{ type: "text", text: header + records.map(formatRecord).join("\n") }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(tApp("diag.observe.agent.tools.data-query-execute-tool.12"), error instanceof Error ? error : undefined);
        return { content: [{ type: "text", text: tApp("diag.observe.agent.tools.data-query-execute-tool.8", { p0: message }) }] };
      }
    },
  };
}
