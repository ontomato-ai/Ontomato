import { isDeepStrictEqual } from "node:util";
import { currentSdkClient } from "./current-sdk.mjs";

const productPath = (kind, id) => `/api/product-${kind}s/${encodeURIComponent(id)}`;

async function readAnswer(response, method, path) {
  const text = await response.text();
  const answer = text && response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : undefined;
  if (!response.ok || answer?.success === false || answer?.error) {
    const code = answer?.error?.code ?? answer?.code;
    const reason = answer?.error?.message ?? answer?.message ?? (typeof answer?.error === "string" ? answer.error : text);
    throw new Error(`${method} ${path} failed: ${response.status}${code === undefined ? "" : ` ${code}`} ${reason}`);
  }
  return answer;
}

export function requireApplicationId(id) {
  if (!id.startsWith("app-")) throw new Error("Application ID must start with app-");
}

export function requireDomainProductId(label, id, checks) {
  // Older installed SDK releases predate platform-owned records.
  const result = checks.domainProductIdSchema?.safeParse(id);
  if (result?.success === false) throw new Error(`${label}: ${result.error.issues[0].message}`);
}

function requireMode(mode) {
  if (mode !== "create" && mode !== "update") throw new Error("Expected mode create or update");
}

function productBody({ mode, revision, input }) {
  requireMode(mode);
  if (mode === "create" ? revision !== undefined : !Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error(mode === "create" ? "Create takes no revision" : "Update requires a positive current owner revision");
  }
  return { ...input, revision: mode === "create" ? 0 : revision };
}

function registrationIssues(issues) {
  return issues.flatMap(issue => {
    if (issue.code === "invalid_union") {
      const mismatchedComponent = ({ issues }) => issues.some(item =>
        item.path.at(-1) === "componentId" && ["invalid_literal", "invalid_enum_value"].includes(item.code));
      const [branch] = [...issue.unionErrors].sort((left, right) =>
        Number(mismatchedComponent(left)) - Number(mismatchedComponent(right)) || left.issues.length - right.issues.length);
      return registrationIssues(branch.issues);
    }
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map(key => `${[...issue.path, key].join(".")}: unexpected field`);
    }
    const field = issue.path.join(".") || "input";
    const message = issue.code === "invalid_type" && issue.received === "undefined" ? "required field is missing" : issue.message;
    return [`${field}: ${message}`];
  });
}

export function panelRegistrationRecords({ projections = [], panels = [], applications = [] }, checks) {
  for (const { id, mode, input } of applications) {
    if (input.declaration === undefined) continue;
    try {
      const { icon } = mode === "update"
        ? checks.applicationIdentityUpdateSchema.partial().parse(input.declaration)
        : input.declaration;
      if (icon !== undefined && !checks.applicationIconKeys.includes(icon)) {
        throw new Error(`declaration.icon '${icon}' is not available. Choose one of ${checks.applicationIconKeys.join(", ")}`);
      }
    } catch (error) {
      throw new Error(`application ${id}: ${error.message}`, { cause: error });
    }
  }
  return [
    ["projection", projections, checks.registerProductProjectionRequestSchema],
    ["panel", panels, checks.registerProductPanelRequestSchema],
  ].map(([kind, records, schema]) => [
    kind,
    records.map(item => {
      requireDomainProductId(`${kind} ${item.id}`, item.id, checks);
      const result = schema.safeParse(productBody(item));
      if (!result.success) {
        throw new Error(`${kind} ${item.id}: ${registrationIssues(result.error.issues).join("\n")}`);
      }
      return { id: item.id, body: result.data };
    }),
  ]);
}

export function panelRegistrationClient({ workbenchUrl, ontologyUrl = `${workbenchUrl}/api/data-query`, headers = {} }) {
  const sdk = currentSdkClient({ workbenchUrl, headers });
  const send = (base, method, path, body, requestHeaders) => fetch(base + path, {
    method,
    headers: { ...headers, Accept: "application/json", "Content-Type": "application/json", ...requestHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });
  const call = async (base, method, path, body, requestHeaders) =>
    readAnswer(await send(base, method, path, body, requestHeaders), method, path);
  async function currentRecord(kind, id) {
    const path = productPath(kind, id);
    const response = await send(workbenchUrl, "GET", path);
    return response.status === 404 ? null : (await readAnswer(response, "GET", path))[kind];
  }

  async function currentRevision(kind, id) {
    const answer = await call(workbenchUrl, "GET", productPath(kind, id));
    const revision = answer[kind].revision;
    if (!Number.isSafeInteger(revision) || revision <= 0) throw new Error(`Owner response for ${kind} ${id} has no current revision`);
    return revision;
  }

  return {
    currentRecord,
    async projectionUsedBy(id, checks) {
      const result = await call(workbenchUrl, "GET", `${productPath("projection", id)}/used-by`);
      return checks.productProjectionUsedBySchema.parse(result);
    },
    currentRevision,
    async deleteApplication(id) {
      await call(ontologyUrl, "DELETE", `/platform/applications/${encodeURIComponent(id)}`);
      return { success: true };
    },
    async deletePanel(id) {
      const revision = await currentRevision("panel", id);
      return call(workbenchUrl, "DELETE", `${productPath("panel", id)}?${new URLSearchParams({ revision })}`);
    },
    async findChartSource(sourceCard, checks) {
      const endpoint = `/api${checks.CHART_PROJECTION_SOURCES_PATH}?${new URLSearchParams(sourceCard)}`;
      const { projectionId } = checks.chartProjectionLookupResponseSchema.parse(await call(workbenchUrl, "GET", endpoint));
      if (projectionId === null) return null;
      const result = await call(workbenchUrl, "GET", productPath("projection", projectionId));
      return checks.productProjectionResponseSchema.parse(result).projection;
    },
    async registerChartSource(sourceCard, checks) {
      const result = await call(workbenchUrl, "POST", `/api${checks.CHART_PROJECTION_SOURCES_PATH}`, sourceCard);
      return checks.registerChartProjectionResponseSchema.parse(result).projection;
    },
    async register(material, onRegistered, checks, recoveredProjectionPanels = new Map()) {
      const { projections = [], panels = [], applications = [], ...unknown } = material;
      if (Object.keys(unknown).length) throw new Error(`Unknown registration fields: ${Object.keys(unknown).join(", ")}`);
      for (const { id, mode } of applications) {
        if (mode === "create") requireApplicationId(id);
      }

      async function apply(kind, items, write) {
        for (const item of items) {
          try {
            await write(item);
            await onRegistered(kind, item.id);
          } catch (error) {
            throw new Error(`${kind} ${item.id}: ${error.message}`, { cause: error });
          }
        }
      }

      if (projections.length || panels.length || applications.some(({ input }) => input.declaration !== undefined)) {
        checks ??= await sdk.check(await sdk.current());
        const writes = panelRegistrationRecords({ projections, panels, applications }, checks);
        for (const [kind, items] of writes) {
          await apply(kind, items, async ({ id, body }) => {
            const panelId = kind === "projection" ? recoveredProjectionPanels.get(id) : undefined;
            const guard = panelId === undefined ? undefined : { [checks.PROJECTION_REUSE_PANEL_HEADER]: panelId };
            const answer = await call(workbenchUrl, "PUT", productPath(kind, id), body, guard);
            if (answer[kind].revision !== body.revision + 1) {
              throw new Error(`Owner did not advance revision ${body.revision} by one`);
            }
          });
        }
      }
      await apply("application", applications, async ({ id, mode, input }) => {
        requireMode(mode);
        const application = `/platform/applications/${encodeURIComponent(id)}`;
        const path = `${application}/panel-uses`;
        if (mode === "create") {
          if (input.declaration === undefined || input.entryAccess === undefined) {
            throw new Error("Application creation requires declaration and entryAccess");
          }
          // Reject an occupied ID before sending its creation body.
          const existing = await send(ontologyUrl, "GET", path);
          if (existing.status !== 404) {
            await readAnswer(existing, "GET", path);
            throw new Error("Application already exists");
          }
          await call(ontologyUrl, "PUT", path, input);
          return;
        }

        const { declaration, ...entries } = input;
        if (entries.entryAccess !== undefined) throw new Error("Application update takes entry, panelUses and optional identity");
        let identity;
        if (declaration !== undefined) {
          const answer = await call(ontologyUrl, "GET", `/platform/applications/catalogue/${encodeURIComponent(id)}`);
          const { names, descriptions, icon } = checks.applicationCatalogueRecordSchema.parse(answer.data);
          const current = { names, descriptions, icon };
          const requested = checks.applicationIdentityUpdateSchema.parse({ ...current, ...declaration });
          if (!isDeepStrictEqual(current, requested)) identity = requested;
        }
        await call(ontologyUrl, "PUT", path, entries);
        if (identity) await call(ontologyUrl, "PUT", `${application}/identity`, identity);
      });
    },
  };
}
