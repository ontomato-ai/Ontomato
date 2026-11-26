import { Router } from "express";
import { z } from "zod";
import { diagnosisTargetSchema, diagnosisQueryInputSchema, diagnosisQueryPreviewSchema } from "@ontomato/contracts/ops-diagnosis";
import { diagnosticConfigResponseSchema } from "@ontomato/contracts/diagnostic-config";
import { serviceLogQuerySchema, serviceLogServiceSchema } from "@ontomato/contracts/service-logging";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { LogQueryError } from "@ontomato/service-logging";
import { createAgentHostRouter } from "./agent-host";
import { context, id, wrap } from "../utils/agent-host";
import { buildAttachmentContentDisposition } from "../utils/http";
import { createDiagnosis, diagnosisService } from "../../services/ops-diagnosis/service";
import { resolveDiagnosisEvidence, ontologyRead, readEvidenceSession, readEvidenceRun, readEvidenceArtifact } from "../../services/ops-diagnosis/evidence";
import { queryWorkbenchServiceLogs, queryRuntimeServiceLogs, queryOntologyServiceLogs } from "../../platform/diagnosis/observe/service-logs";
import { readKnowledgeMarkdown, listKnowledgeTree } from "../../platform/diagnosis/observe/agent/knowledge-store";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { backendGet } from "../../utils/backend-client";
import { getApiConfig } from "../../config/data-query-api";
import { combineResultTruncation, parseQueryAnswerPayloads } from "../../utils/query-answer-protocol";
import { HttpError } from "../../utils/errors";
import { requireManagement } from "../../identity/management";

const router: ReturnType<typeof Router> = Router();
// Legacy `/api/observe/agent/*` and `/api/observe/diagnoses` compatibility layer for MCP and historical `ops_sessions`
// pending old data cleanup; active interactive diagnosis chat runs through `/api/assistant/*` (`assistant_sessions`).
router.get("/agent/agents", wrap(async (req, res) => {
  const c = context(req);
  res.json(await diagnosisService.agents(c.owner, c.credentials));
}));
router.use("/agent", createAgentHostRouter(diagnosisService));
router.post("/diagnoses", requireManagement(workbenchManagement.opsDiagnosisCreate), wrap(async (req, res) => {
  const { owner, credentials } = context(req), { target } = z.object({ target: diagnosisTargetSchema }).strict().parse(req.body);
  await resolveDiagnosisEvidence(target, { ...owner, ...credentials });
  res.status(201).json(await createDiagnosis(z.string().uuid().parse(req.header("Idempotency-Key")), owner, credentials, target));
}));
const evidence: ReturnType<typeof Router> = Router();
const provider = (value: unknown) => z.enum(["workbench", "ontology"]).parse(value);
const readEvidence = requireManagement(workbenchManagement.opsEvidenceRead);
const readRuntimeEvidence = requireManagement(workbenchManagement.opsEvidenceRuntimeRead);
const readKnowledge = requireManagement(workbenchManagement.opsKnowledgeRead);
evidence.post("/resolve", readEvidence, wrap(async (req, res) => {
  const c = context(req), { target } = z.object({ target: diagnosisTargetSchema }).strict().parse(req.body);
  res.json(await resolveDiagnosisEvidence(target, { ...c.owner, ...c.credentials }));
}));
evidence.get("/logs/:service", requireManagement(workbenchManagement.opsEvidenceLogsRead), wrap(async (req, res) => {
  let query;
  try { query = serviceLogQuerySchema.parse(req.query); } catch { throw new HttpError(400, "Invalid log query", "INVALID_LOG_QUERY"); }
  const service = serviceLogServiceSchema.parse(req.params.service), c = context(req);
  try {
    res.json(await (service === "workbench" ? queryWorkbenchServiceLogs(query) : service === "ontology" ? queryOntologyServiceLogs(query, c.credentials) : queryRuntimeServiceLogs(query, c.owner.domainId)));
  } catch (e) { if (e instanceof LogQueryError) throw new HttpError(e.status, e.message, e.code); throw e; }
}));
evidence.get("/runtime/:owner/sessions/:sessionId", readRuntimeEvidence, wrap(async (req, res) => {
  const c = context(req); res.json(await readEvidenceSession(provider(req.params.owner), id(req, "sessionId"), { ...c.owner, ...c.credentials }));
}));
evidence.get("/runtime/:owner/sessions/:sessionId/runs/:runId", readRuntimeEvidence, wrap(async (req, res) => {
  const c = context(req); res.json(await readEvidenceRun(provider(req.params.owner), id(req, "sessionId"), id(req, "runId"), { ...c.owner, ...c.credentials }));
}));
evidence.get("/runtime/:owner/sessions/:sessionId/artifacts/:artifactId", readRuntimeEvidence, wrap(async (req, res) => {
  const c = context(req); res.json(await readEvidenceArtifact(provider(req.params.owner), id(req, "sessionId"), id(req, "artifactId"), { ...c.owner, ...c.credentials }));
}));
evidence.get("/runtime/:owner/sessions/:sessionId/artifacts/:artifactId/content", readRuntimeEvidence, wrap(async (req, res) => {
  const c = context(req), source = provider(req.params.owner), session = id(req, "sessionId"), artifact = id(req, "artifactId");
  const a = await readEvidenceArtifact(source, session, artifact, { ...c.owner, ...c.credentials });
  let bytes: Buffer;
  if (source === "workbench") bytes = await new RuntimeClient(c.owner.domainId).bytes(`/v1/artifacts/${artifact}/content`);
  else {
    const endpoint = `/ontology/ai/sessions/${session}/artifacts/${artifact}/content`;
    const response = await backendGet(endpoint, getApiConfig().baseUrl!.replace(/\/$/, "") + endpoint, { ...c.credentials, stream: true, retries: 1, timeoutMs: 30000, errorDetailLimit: 0 });
    bytes = Buffer.from(await response.arrayBuffer());
  }
  res.set({ "Content-Type": a.mediaType, "Content-Length": String(bytes.length), ETag: `"${a.sha256}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-cache" });
  if (req.query.download === "1" || a.path.endsWith(".html")) res.set("Content-Disposition", buildAttachmentContentDisposition(a.path.split("/").at(-1)!));
  res.send(bytes);
}));
evidence.get("/config", readEvidence, wrap(async (req, res) => {
  z.object({}).strict().parse(req.query);
  res.json(diagnosticConfigResponseSchema.parse(await ontologyRead("/businessConfig/getConfigAndDesc", context(req).credentials)));
}));
const item = z.object({ name: z.string().optional(), status: z.string().optional(), pid: z.number().optional(), cpu_percent: z.number().optional(), memory_mb: z.number().optional(), uptime_seconds: z.number().optional() });
const health = z.object({ hostname: z.string().optional(), timestamp: z.string().optional(), backend: z.object({ service: item.optional() }).optional(), server: z.object({ cpu: z.object({ userate: z.number().optional() }).optional(), memory: z.object({ total_gb: z.number().optional(), used_gb: z.number().optional(), usage_percent: z.number().optional() }).optional(), disk: z.array(z.object({ partition: z.string().optional(), usage_percent: z.number().optional() })).optional() }).optional() }).refine((v) => v.backend || v.server);
evidence.get("/health", readEvidence, wrap(async (req, res) => {
  z.object({}).strict().parse(req.query);
  const result = await ontologyRead("/maintenance/getserviceinfo", context(req).credentials);
  res.json(health.parse((result as { data?: unknown })?.data ?? result));
}));
evidence.get("/metadata", readEvidence, wrap(async (req, res) => {
  const { format } = z.object({ format: z.enum(["json", "markdown"]).default("json") }).strict().parse(req.query);
  res.json(await ontologyRead(format === "json" ? "/admin/getSchema" : "/admin/getschemamarkdown-v2", context(req).credentials, format === "json" ? undefined : {}));
}));
evidence.post("/query", requireManagement(workbenchManagement.opsDslExecute), wrap(async (req, res) => {
  const { query, limit } = diagnosisQueryInputSchema.parse(req.body);
  const body = await ontologyRead("/ontology/query/execute-dsl", context(req).credentials, { dsl: query });
  const parsed = z.object({ data: z.unknown(), error: z.unknown().optional() }).parse(body);
  if (parsed.error) throw new HttpError(422, "Ontology query failed", "QUERY_FAILED");
  const packs = parseQueryAnswerPayloads(parsed.data), rows = packs.flatMap((p) => p.answer);
  res.json(diagnosisQueryPreviewSchema.parse({ rows: rows.slice(0, limit), receivedRowCount: rows.length, upstreamTruncation: combineResultTruncation(packs) ?? null }));
}));
evidence.get("/knowledge", readKnowledge, wrap(async (req, res) => { z.object({}).strict().parse(req.query); res.json(listKnowledgeTree()); }));
evidence.get("/knowledge/content", readKnowledge, wrap(async (req, res) => {
  const { path } = z.object({ path: z.string().default("index.md") }).strict().parse(req.query); res.json(readKnowledgeMarkdown(path));
}));
// Keep the callback scope closed even when mounted before other /observe routes.
evidence.use(wrap(async () => { throw new HttpError(404, "Evidence operation not found", "NOT_FOUND"); }));
router.use("/evidence", evidence);
export default router;
