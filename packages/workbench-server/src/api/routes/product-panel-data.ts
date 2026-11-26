import {
  PANEL_READ_BATCH_PATH, productPanelReadBatchRequestSchema, productPanelReadRequestSchema,
  type ProductPanelReadRequest, type ProductPanelReadResponse,
} from "@ontomato/contracts/panel-host";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import { AGENT_EXECUTION_HEADER } from "@ontomato/contracts/agent-runtime-business-callbacks";
import { Router, type RequestHandler } from "express";
import type { ZodType } from "zod";
import { resolveLocale } from "../../i18n";
import { runWithLogContext } from "../../logging/log-context";
import { readScopedPanelData, readScopedPanelDataBatch } from "../../services/product-panels/data-reads";
import { prepareRegisteredDataReads, runPreparedDataReads, type RegisteredDataRead } from "../../services/product-panels/registered-read-plan";
import type { AuthenticatedRequest } from "../../utils/request-identity";
import { buildTestAccess } from "../build-test-access";
import { context, wrap } from "../utils/agent-host";
import { getApiKeyFromRequest, getLocaleFromRequest, getTokenFromRequest } from "../utils/request";

function isRegisteredRead(read: ProductPanelReadRequest): read is RegisteredDataRead {
  return read.source.kind === "registered" || read.source.kind === "frame";
}

export function createProductPanelReadRouter(authenticate: RequestHandler) {
  const router = Router();
  const scopedAccess = Router().use(authenticate, buildTestAccess);

  function handle<T>(schema: ZodType<T>, items: (body: T) => ProductPanelReadRequest[], batch: boolean): RequestHandler {
    return (req, res, next) => {
      const parsed = schema.safeParse(req.body);
      const previewHeader = req.header(BUILD_TEST_HEADER);
      // Preview and execution proxy requests keep their owner-specific context.
      const scopedRequest = previewHeader !== undefined
        || Boolean(req.header("X-Ontomato-Retrieval-Caller-Id"))
        || req.header(AGENT_EXECUTION_HEADER) !== undefined;
      const formal: RegisteredDataRead[] = [];
      const scoped: ProductPanelReadRequest[] = [];
      const order = parsed.success ? items(parsed.data).map(read => {
        if (!scopedRequest && isRegisteredRead(read)) return { formal: true, index: formal.push(read) - 1 };
        return { formal: false, index: scoped.push(read) - 1 };
      }) : [];

      async function readFormal(): Promise<ProductPanelReadResponse[]> {
        if (!formal.length) return [];
        const credentials = {
          token: getTokenFromRequest(req),
          apiKey: getApiKeyFromRequest(req),
          locale: resolveLocale(getLocaleFromRequest(req)),
        };
        const prepared = await prepareRegisteredDataReads(credentials, formal, { location: req });
        return runPreparedDataReads(credentials, prepared);
      }

      async function readScoped(): Promise<ProductPanelReadResponse[]> {
        if (!scoped.length) return [];
        const { owner, credentials } = context(req);
        const callerUserName = (req as AuthenticatedRequest).userName;
        return runWithLogContext({ ...owner, token: credentials.token, apiKey: credentials.apiKey }, async () => {
          if (batch) return readScopedPanelDataBatch(owner, credentials, scoped, { previewHeader, callerUserName, location: req });
          const read = scoped[0]!;
          const viewer = isRegisteredRead(read) && previewHeader !== undefined
            ? { ...credentials, headers: { ...credentials.headers, [BUILD_TEST_HEADER]: previewHeader } }
            : credentials;
          return [await readScopedPanelData(owner, viewer, read, callerUserName, req)];
        });
      }

      const respond = wrap(async () => {
        if (!parsed.success) throw parsed.error;
        const [formalResults, scopedResults] = await Promise.all([readFormal(), readScoped()]);
        const results = order.map(({ formal, index }) => (formal ? formalResults : scopedResults)[index]);
        res.json(batch ? { results } : results[0]);
      });
      if (parsed.success && !scoped.length) return respond(req, res, next);
      scopedAccess(req, res, error => error ? next(error) : respond(req, res, next));
    };
  }

  router.post("/product-panels/read", handle(productPanelReadRequestSchema, read => [read], false));
  router.post(PANEL_READ_BATCH_PATH, handle(productPanelReadBatchRequestSchema, ({ reads }) => reads, true));
  return router;
}
