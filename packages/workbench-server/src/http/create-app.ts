import assistantRouter from "../api/routes/assistant";
import { registerAssistantSkills } from "../services/assistant/skills";
import {
  readAssistantTurnEvidence,
  verifyAssistantDomain,
} from "../services/assistant/evidence";
import { installAssistantEvidenceReader } from "../platform/diagnosis/observe/workspaces/assistant-source";
import type { AuthenticatedRequest } from "../utils/request-identity";
import { unwrapCallbackCredential } from "../services/agent-runtime/callback-credential";
import { registerGovernanceSkill } from "../services/knowledge-governance/skill";
import express, {
  Express,
  Request,
  Response,
  NextFunction,
  Router,
} from "express";
import cors from "cors";
import path from "path";
import { skillRegistryManager } from "../core/skills/index";
import { resolveSkillPackageFile } from "../core/skills/discovery/loader";
import { config } from "../config/application";
import analysisTasksRouter from "../api/routes/analysis-tasks";
import backendProxyRouter from "../api/routes/backend-proxy";
import knowledgeGovernanceRouter from "../api/routes/knowledge-governance";
import dashboardsRouter from "../api/routes/dashboards";
import feedbackRouter from "../api/routes/feedback";
import memoriesRouter from "../api/routes/memories";
import mcpRouter from "../api/routes/mcp";
import analysisAgentMcpRouter from "../api/routes/analysis-agent-mcp";
import opsAgentMcpRouter from "../api/routes/ops-agent-mcp";
import preferencesRouter from "../api/routes/preferences";
import queryHistoryRouter from "../api/routes/query-history";
import reportsRouter from "../api/routes/reports";
import pptRouter from "../api/routes/ppt";
import skillsRouter from "../api/routes/skills";
import autotestRouter from "../platform/diagnosis/autotest/routes";
import observeRouter from "../platform/diagnosis/observe/routes";
import artifactRetentionRouter from "../platform/diagnosis/artifact-retention-routes";
import agentRouter from "../platform/diagnosis/observe/agent/routes";
import { syncRuntimeDefaultResources } from "../platform/runtime-defaults";
import modelSettingsRouter from "../api/routes/model-settings";
import systemModelConfigRouter from "../api/routes/system-model-config";
import workbenchAppearanceRouter from "../api/routes/workbench-appearance";
import { syncDefaultPrompts } from "../core/prompts/loader";
import { createLogger } from "../logging/logger";
import { initializeWorkbenchLogging, getWorkbenchLogStore, closeWorkbenchLogging } from "../infrastructure/service-logs";
import { correlationId, withServiceLogContext } from "@ontomato/service-logging";
import serviceLogsRouter, { serviceLogAuthResponse } from "../api/routes/service-logs";
import {
  generateRequestId,
  runWithLogContext,
} from "../logging/log-context";
import { startArtifactCleanupScheduler } from "../platform/diagnosis/artifact-retention-cleanup";
import { initializeConnection } from "../infrastructure/connection";
import { requestLogger as accessLogger, errorHandler } from "../api/middleware";
import { getDefaultLocale, tApp } from "../i18n/index";
import { echartDir, webDistDir } from "../content/layout";
import { workbenchIdentity } from "../identity/installed";
import { MODEL_RUNTIME_TOKEN_ENV, modelKeySealKey } from "@ontomato/contracts/model-key-seal";
import { workbenchProduct } from "../product/installed";

const logger = createLogger("server");
const SERVER_NOW_HEADER = "X-Server-Now";

export interface WorkbenchMounts {
  /** Edition-owned backend routes, followed by the ordinary transparent proxy. */
  backendProxyRouter?: Router;
  /** Enterprise SSO. Must run before the unified authenticate. OSS has no such route. */
  authRouter?: Router;
  /** Enterprise governance platform connection proxy. Absent in OSS. */
  connectionRouter?: Router;
  /** Enterprise governance platform SSO ticket. Absent in OSS. */
  dataGovernanceRouter?: Router;
}

let runtimeBound = false;

function bindRuntime(): void {
  if (runtimeBound) return;
  runtimeBound = true;
  installAssistantEvidenceReader({
    readTurn: readAssistantTurnEvidence,
    verifyDomain: verifyAssistantDomain,
  });
}

export function createWorkbenchApp(mounts: WorkbenchMounts = {}): Express {
  bindRuntime();
  const identity = workbenchIdentity();
  const product = workbenchProduct();
  const app: Express = express();
  const isDev = config.nodeEnv !== "production";

  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlation = correlationId(req.header("X-Correlation-Id"));
    res.setHeader("X-Correlation-Id", correlation);
    withServiceLogContext({ correlationId: correlation, runId: req.header("X-Ontomato-Run-Id"), sessionId: req.header("X-Ontomato-Session-Id") }, () =>
      runWithLogContext({ requestId: generateRequestId(), correlationId: correlation }, next));
  });
  app.use(accessLogger);
  app.use(cors({ exposedHeaders: [SERVER_NOW_HEADER, "X-Correlation-Id"] }));
  app.use(express.json({ limit: "50mb" }));
  app.use((_req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    res.json = ((body?: any) => {
      if (!res.headersSent)
        res.setHeader(SERVER_NOW_HEADER, String(Date.now()));
      return originalJson(body);
    }) as Response["json"];
    next();
  });

  if (mounts.authRouter) app.use("/api/auth", mounts.authRouter);
  app.use("/api/data-query", mounts.backendProxyRouter ?? backendProxyRouter);
  app.use(
    product.proxyMountPath,
    mounts.backendProxyRouter ?? backendProxyRouter,
  );
  app.use("/mcp/analysis-agents", analysisAgentMcpRouter);
  app.use("/mcp/ops-agent", opsAgentMcpRouter);
  app.use(
    "/api/echart",
    express.static(echartDir(), {
      fallthrough: false,
      index: false,
      maxAge: "1d",
      redirect: false,
    }),
  );

  app.use(
    "/api/skills/resources",
    async (req: Request, res: Response, next: NextFunction) => {
      const verification = await identity.resolveSkillResourceDomain(req);
      if (!verification.ok) {
        res.status(verification.status).json({
          success: false,
          code: verification.code,
          error: verification.error,
        });
        return;
      }
      const { domainId } = verification;
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Referrer-Policy", "no-referrer");
      try {
        await runWithLogContext(
          { domainId, token: verification.token, apiKey: verification.apiKey },
          async () => {
            const registry = await skillRegistryManager.forDomain(domainId);
            const [, type, category, id, ...segments] = decodeURIComponent(
              req.path,
            ).split("/");
            const skill = registry.getSkillById(id);
            if (
              !skill ||
              skill.manifest.type !== type ||
              skill.manifest.category !== category ||
              !segments.length
            ) {
              res.sendStatus(404);
              return;
            }
            const file = await resolveSkillPackageFile(
              skill,
              segments.join("/"),
            );
            res.sendFile(file, (error) => {
              if (error) next(error);
            });
          },
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "ENOENT" || code === "ENOTDIR") res.sendStatus(404);
        else next(error);
      }
    },
  );

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/config.js", (_req: Request, res: Response) => {
    res.type("application/javascript");
    res.set("Cache-Control", "no-store");
    res.send(
      `window.__APP_CONFIG__ = ${JSON.stringify({
        DEFAULT_LOCALE: getDefaultLocale(),
        ONTOLOGY_MANAGER_URL: config.ontologyManagerUrl,
      })};\nwindow.__APP_CONFIG__.API_BASE = new URL("./api", document.currentScript.src).pathname;`,
    );
  });

  app.use(unwrapCallbackCredential);
  app.use(["/api/observe/logs", "/api/observe/runtime-logs"], serviceLogAuthResponse);
  app.use("/api", identity.authenticate);
  app.use("/api", (req, _res, next) => {
    const r = req as AuthenticatedRequest;
    runWithLogContext(
      {
        domainId: r.domainId,
        userId: r.userId,
        token: r.token,
        apiKey: r.apiKey,
      },
      next,
    );
  });

  app.use("/api/analysis-tasks", analysisTasksRouter);
  app.use("/api/assistant", assistantRouter);
  if (mounts.connectionRouter)
    app.use("/api/connections", mounts.connectionRouter);
  if (mounts.dataGovernanceRouter)
    app.use("/api/data-governance", mounts.dataGovernanceRouter);
  app.use("/api/knowledge-governance", knowledgeGovernanceRouter);
  app.use("/api/dashboards", dashboardsRouter);
  app.use("/api/feedback", feedbackRouter);
  app.use("/api/preferences", preferencesRouter);
  app.use("/api/memories", memoriesRouter);

  app.use("/api/reports", reportsRouter);
  app.use("/api/ppt", pptRouter);
  app.use("/api/skills", skillsRouter);
  app.use("/api/mcp", mcpRouter);
  app.use("/api/query-history", queryHistoryRouter);
  app.use(
    [
      "/api/observe/retention",
      "/api/observe/autotest/runs",
      "/api/observe/turns",
      "/api/observe/logs",
      "/api/observe/runtime-logs",
      "/api/observe/backend-logs",
      "/api/observe/errors",
      "/api/observe/live-logs",
      "/api/observe/parse",
    ],
    identity.observeAccess,
  );
  app.use("/api/observe/retention", artifactRetentionRouter);
  app.use("/api/observe/autotest", autotestRouter);
  app.use("/api/observe", serviceLogsRouter);
  app.use("/api/observe", observeRouter);
  app.use("/api/observe/agent", agentRouter);
  app.use("/api/model-settings", modelSettingsRouter);
  app.use("/api/system-model-config", systemModelConfigRouter);
  app.use("/api/workbench-appearance", workbenchAppearanceRouter);
  app.use(errorHandler);

  if (!isDev) {
    const staticPath = webDistDir();
    app.use(express.static(staticPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(staticPath, "index.html"));
    });
  }

  return app;
}

export async function startWorkbench(
  app: Express,
  port: number,
): Promise<void> {
  const isDev = config.nodeEnv !== "production";
  // Checked first: without the shared value no model key can be opened, so the server does not start.
  modelKeySealKey(process.env[MODEL_RUNTIME_TOKEN_ENV]);
  initializeWorkbenchLogging();
  await syncRuntimeDefaultResources();
  syncDefaultPrompts();
  await initializeConnection();
  getWorkbenchLogStore();
  process.once("SIGTERM", () => { void closeWorkbenchLogging().finally(() => process.exit(0)); });
  process.once("SIGINT", () => { void closeWorkbenchLogging().finally(() => process.exit(0)); });
  await registerGovernanceSkill();
  await registerAssistantSkills();

  startArtifactCleanupScheduler();
  logger.info(tApp("foundation.log.boot.cleanupStarted"));
  app.listen(port, () => {
    logger.info(`Server running on http://localhost:${port}`);
    try {
      const pgUrl = new URL(config.postgres.connectionString);
      logger.info(tApp("foundation.log.boot.dbConnected"), {
        host: pgUrl.hostname,
        port: pgUrl.port || 5432,
      });
    } catch {
      logger.info(tApp("foundation.log.boot.dbConfigured"));
    }
    if (isDev) logger.info(tApp("foundation.log.boot.devFrontend"));
  });
}
