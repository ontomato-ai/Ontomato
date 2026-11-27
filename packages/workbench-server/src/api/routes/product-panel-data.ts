import {
  PANEL_READ_BATCH_PATH, productPanelReadBatchRequestSchema, productPanelReadRequestSchema,
  type ProductPanelReadRequest, type ProductPanelReadResponse,
} from "@ontomato/contracts/panel-host";
import { AGENT_EXECUTION_HEADER } from "@ontomato/contracts/agent-runtime-business-callbacks";
import { Router, type RequestHandler } from "express";
import type { ZodType } from "zod";
import { resolveLocale } from "../../i18n";
import { runWithLogContext } from "../../logging/log-context";
import { prepareRegisteredDataReads, runPreparedDataReads, type RegisteredDataRead } from "../../services/product-panels/registered-read-plan";
import { context, wrap } from "../utils/agent-host";
import { getApiKeyFromRequest, getLocaleFromRequest, getTokenFromRequest } from "../utils/request";

function isRegisteredRead(read: ProductPanelReadRequest): read is RegisteredDataRead {
  return read.source.kind === "registered" || read.source.kind === "frame";
}

export function createProductPanelReadRouter(authenticate: RequestHandler) {
  const router = Router();
  const scopedAccess = Router().use(authenticate);

  function handle<T>(schema: ZodType<T>, items: (body: T) => ProductPanelReadRequest[], batch: boolean): RequestHandler {
    return (req, res, next) => {
      const parsed = schema.safeParse(req.body);
      // Preview and execution proxy requests keep their owner-specific context.
      const scopedRequest = Boolean(req.header("X-Ontomato-Retrieval-Caller-Id"))
        || req.header(AGENT_EXECUTION_HEADER) !== undefined;
      const all = parsed.success ? items(parsed.data) : [];
      const scoped = scopedRequest || all.some(read => !isRegisteredRead(read));
      const formal: RegisteredDataRead[] = scoped ? [] : all as RegisteredDataRead[];

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
        const { owner, credentials } = context(req);
        return runWithLogContext({ ...owner, token: credentials.token, apiKey: credentials.apiKey }, async () => {
          const prepared = await prepareRegisteredDataReads(credentials, all, { owner, location: req });
          return runPreparedDataReads(credentials, prepared);
        });
      }

      const respond = wrap(async () => {
        if (!parsed.success) throw parsed.error;
        const results = formal.length ? await readFormal() : await readScoped();
        res.json(batch ? { results } : results[0]);
      });
      if (parsed.success && !scoped) return respond(req, res, next);
      scopedAccess(req, res, error => error ? next(error) : respond(req, res, next));
    };
  }

  router.post("/product-panels/read", handle(productPanelReadRequestSchema, read => [read], false));
  router.post(PANEL_READ_BATCH_PATH, handle(productPanelReadBatchRequestSchema, ({ reads }) => reads, true));
  return router;
}
