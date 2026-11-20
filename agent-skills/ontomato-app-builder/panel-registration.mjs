import { currentSdkClient } from "./current-sdk.mjs";

const productPath = (kind, id) => `/api/product-${kind}s/${encodeURIComponent(id)}`;

async function readAnswer(response, method, path) {
  const text = await response.text();
  const answer = response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : undefined;
  if (!response.ok || answer?.success === false || answer?.error) {
    const code = answer?.error?.code ?? answer?.code;
    const reason = answer?.error?.message ?? answer?.message ?? (typeof answer?.error === "string" ? answer.error : text);
    throw new Error(`${method} ${path} failed: ${response.status}${code === undefined ? "" : ` ${code}`} ${reason}`);
  }
  return answer;
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

export function panelRegistrationRecords({ projections = [], panels = [] }, checks) {
  return [
    ["projection", projections, checks.registerProductProjectionRequestSchema],
    ["panel", panels, checks.registerProductPanelRequestSchema],
  ].map(([kind, records, schema]) => [
    kind,
    records.map(item => {
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
  const send = (base, method, path, body) => fetch(base + path, {
    method,
    headers: { ...headers, Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });
  const call = async (base, method, path, body) => readAnswer(await send(base, method, path, body), method, path);

  return {
    async currentRevision(kind, id) {
      const answer = await call(workbenchUrl, "GET", productPath(kind, id));
      const revision = answer[kind].revision;
      if (!Number.isSafeInteger(revision) || revision <= 0) throw new Error(`${kind} ${id}: owner response has no current revision`);
      return revision;
    },
    async register(material, onRegistered) {
      const { projections = [], panels = [], applications = [], ...unknown } = material;
      if (Object.keys(unknown).length) throw new Error(`Unknown registration fields: ${Object.keys(unknown).join(", ")}`);

      async function apply(kind, items, write) {
        for (const item of items) {
          try {
            await write(item);
          } catch (error) {
            throw new Error(`${kind} ${item.id}: ${error.message}`, { cause: error });
          }
          onRegistered(kind, item.id);
        }
      }

      if (projections.length || panels.length) {
        const release = await sdk.current();
        const checks = await sdk.check(release);
        const writes = panelRegistrationRecords({ projections, panels }, checks);
        for (const [kind, items] of writes) {
          await apply(kind, items, async ({ id, body }) => {
            const answer = await call(workbenchUrl, "PUT", productPath(kind, id), body);
            if (answer[kind].revision !== body.revision + 1) {
              throw new Error(`Owner did not advance revision ${body.revision} by one`);
            }
          });
        }
      }
      await apply("application", applications, async ({ id, mode, input }) => {
        requireMode(mode);
        const path = `/platform/applications/${encodeURIComponent(id)}/panel-uses`;
        if (mode === "create") {
          if (input.declaration === undefined || input.entryAccess === undefined) {
            throw new Error("Application creation requires declaration and entryAccess");
          }
          // Java currently exposes a single PUT. Reject an occupied ID before sending its creation body.
          const existing = await send(ontologyUrl, "GET", path);
          if (existing.status !== 404) {
            await readAnswer(existing, "GET", path);
            throw new Error("Application already exists");
          }
        } else if (input.declaration !== undefined || input.entryAccess !== undefined) {
          // Without creation metadata the owner's PUT requires an existing application.
          throw new Error("Use updates take entry and panelUses only");
        }
        await call(ontologyUrl, "PUT", path, input);
      });
    },
  };
}
