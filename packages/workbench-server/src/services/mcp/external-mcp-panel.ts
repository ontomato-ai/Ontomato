import { z } from "zod";
import {
  MCP_HEADER_MASK,
  mcpServiceWriteSchema,
  type McpServiceView,
  type McpServiceWrite,
} from "@ontomato/contracts/agent-runtime-mcp";
import { runtimeIdSchema, type RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { FormFieldError } from "@ontomato/contracts/form-fields";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import {
  panelReadOperationJsonResultSchema,
  type panelReadOperationCallSchema,
} from "@ontomato/contracts/panel-operations";
import {
  panelFormSaveInputSchema,
  type PanelFormDescription,
  type PanelFormField,
  type PanelFormRequest,
  type PanelOption,
  type PanelRecord,
} from "@ontomato/contracts/panel-projection";
import {
  CHECK_EXTERNAL_MCP_SERVICE,
  CREATE_EXTERNAL_MCP_SERVICE,
  DELETE_EXTERNAL_MCP_SERVICE,
  EXTERNAL_MCP_SERVICE,
} from "@ontomato/contracts/platform-object-types";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { assertManagement } from "../../identity/management";
import { tForLocale } from "../../i18n";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { cachedZodToRuntimeJsonSchema } from "../../utils/zod-json-schema";
import type { AssistantOwner } from "../assistant/store";
import type { VisibleAgentMcpUsage } from "../product-panels/agent-definition-directory";
import type { ObjectVisibilityRange } from "../product-governance/authorization";
import type {
  PanelImpactInspector,
  PanelOperationHost,
  PanelOperationTarget,
  PanelRecordTarget,
  PanelServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";
import { mcpToolToPanelRecord } from "./panel-reads";

type FormInputs = Pick<PanelFormRequest, "values" | "changedField">;

interface HeaderDraftRow {
  name: string;
  value: string;
  storedName?: string;
}

const SAVE_EXTERNAL_MCP_OP = `${EXTERNAL_MCP_SERVICE}.save`;
const emptyInputSchema = z.object({}).strict();
const saveInputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();
const savedIdSchema = z.object({ id: runtimeIdSchema }).strict();
const checkResultSchema = panelReadOperationJsonResultSchema.options[1];
const objectTargetSchema = z.object({
  kind: z.literal("object"),
  objectType: z.literal(EXTERNAL_MCP_SERVICE),
  primaryKey: runtimeIdSchema,
}).strict();
const draftTargetSchema = panelFormTargetSchema.options[1];

const headerRowSchema = z.object({
  name: z.string(),
  value: z.string(),
  storedName: z.string().optional(),
});

const externalMcpFormValuesSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().trim().min(1),
  headers: z.array(headerRowSchema).optional(),
});

function createRuntime(owner: AssistantOwner) {
  return new RuntimeClient(owner.domainId, undefined, owner.userId);
}

async function readSafeAgentUsages(
  owner: AssistantOwner,
  viewer: AssistantCredentials,
): Promise<VisibleAgentMcpUsage> {
  try {
    const { readVisibleAgentMcpUsages } = await import("../product-panels/agent-definition-directory");
    return await readVisibleAgentMcpUsages(owner, viewer);
  } catch {
    return { hasVisibleAgents: false, byServiceId: new Map() };
  }
}

function toServiceRecord(
  service: McpServiceView,
  usage: VisibleAgentMcpUsage,
  locale?: string,
): PanelRecord {
  const text = (key: string) => tForLocale(locale, `panels.externalMcp.${key}`);
  const headerKeys = Object.keys(service.headers);
  const headerNames = headerKeys.join(", ");
  const usedNames = usage.byServiceId.get(service.id) ?? [];

  return {
    primaryKey: service.id,
    className: EXTERNAL_MCP_SERVICE,
    label: service.name,
    subtitle: service.url,
    fields: {
      name: service.name,
      url: service.url,
      headerNames,
      headerCount: String(headerKeys.length),
      ...(usage.hasVisibleAgents && {
        usedBy: usedNames.length > 0 ? usedNames.join(", ") : text("unused"),
      }),
    },
    fieldLabels: {
      name: text("fields.name"),
      url: text("fields.url"),
      headerNames: text("fields.headers"),
      headerCount: text("fields.headerCount"),
      ...(usage.hasVisibleAgents && {
        usedBy: text("fields.usedBy"),
      }),
    },
  };
}

function toInitialFormValues(service: McpServiceView | null): {
  name: string;
  url: string;
  headers: HeaderDraftRow[];
} {
  if (!service) {
    return { name: "", url: "", headers: [] };
  }
  return {
    name: service.name,
    url: service.url,
    // Never return stored secret values or mask literals as input values.
    headers: Object.keys(service.headers).map((name) => ({
      name,
      value: "",
      storedName: name,
    })),
  };
}

function normalizeHeaderRows(raw: unknown): HeaderDraftRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { name: "", value: "" };
    }
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name : "";
    const value = typeof row.value === "string" ? row.value : "";
    const storedName = typeof row.storedName === "string" && row.storedName.trim()
      ? row.storedName.trim()
      : undefined;
    return storedName ? { name, value, storedName } : { name, value };
  });
}

function parseExternalMcpDraft(
  raw: Record<string, unknown>,
  creating: boolean,
  existingService: McpServiceView | null,
  locale?: string,
): {
  values: { name: string; url: string; headers: HeaderDraftRow[] };
  payload?: McpServiceWrite;
  errors: FormFieldError[];
} {
  const t = (key: string) => tForLocale(locale, `panels.externalMcp.errors.${key}`);
  const name = typeof raw.name === "string" ? raw.name : "";
  const url = typeof raw.url === "string" ? raw.url : "";
  const headers = normalizeHeaderRows(raw.headers);
  const values = { name, url, headers };
  const errors: FormFieldError[] = [];

  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  if (!trimmedName) {
    errors.push({ field: "/name", code: "required", message: t("nameRequired") });
  } else if (trimmedName.length > 100) {
    errors.push({ field: "/name", code: "value_too_long", message: t("nameTooLong") });
  }

  if (!trimmedUrl) {
    errors.push({ field: "/url", code: "required", message: t("urlRequired") });
  } else {
    try {
      const parsed = new URL(trimmedUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors.push({ field: "/url", code: "invalid_format", message: t("invalidUrl") });
      }
    } catch {
      errors.push({ field: "/url", code: "invalid_format", message: t("invalidUrl") });
    }
  }

  const existingHeaderKeys = new Set(
    Object.keys(existingService?.headers ?? {}).map((key) => key.toLowerCase()),
  );
  const headersPayload: Record<string, string | null> = {};
  const seenNames = new Set<string>();

  for (let i = 0; i < headers.length; i += 1) {
    const row = headers[i]!;
    const key = row.name.trim();
    const val = row.value;
    const stored = row.storedName?.toLowerCase();
    if (!key && !val) continue;

    if (!key) {
      errors.push({ field: `/headers/${i}/name`, code: "invalid_format", message: t("invalidHeaders") });
      continue;
    }

    const lowered = key.toLowerCase();
    if (seenNames.has(lowered)) {
      errors.push({ field: `/headers/${i}/name`, code: "already_exists", message: t("invalidHeaders") });
      continue;
    }

    if (val === MCP_HEADER_MASK) {
      errors.push({ field: `/headers/${i}/value`, code: "invalid_format", message: t("invalidHeaders") });
      continue;
    }

    // Validate HTTP header name/value syntax before forwarding to runtime.
    try {
      new Headers({ [key]: val });
    } catch {
      errors.push({ field: `/headers/${i}/name`, code: "invalid_format", message: t("invalidHeaders") });
      continue;
    }

    if (stored && !val) {
      // A stored header keeps its secret value when left blank; renaming requires entering a new value.
      if (stored !== lowered || !existingHeaderKeys.has(stored)) {
        errors.push({ field: `/headers/${i}/name`, code: "invalid_format", message: t("invalidHeaders") });
        continue;
      }
      seenNames.add(lowered);
      headersPayload[key] = null;
      continue;
    }

    if (!creating && !val && existingHeaderKeys.has(lowered)) {
      seenNames.add(lowered);
      headersPayload[key] = null;
      continue;
    }

    seenNames.add(lowered);
    headersPayload[key] = val;
  }

  if (errors.length > 0) {
    return { values, errors };
  }

  const checked = mcpServiceWriteSchema.safeParse({
    name: trimmedName,
    url: trimmedUrl,
    headers: headersPayload,
  });
  if (!checked.success) {
    errors.push({ field: "/headers", code: "invalid_format", message: t("invalidHeaders") });
    return { values, errors };
  }

  return { values, payload: checked.data, errors: [] };
}

function buildFormDescription(
  creating: boolean,
  existingService: McpServiceView | null,
  inputs: FormInputs,
  locale?: string,
): PanelFormDescription {
  const t = (key: string) => tForLocale(locale, `panels.externalMcp.${key}`);
  const base = toInitialFormValues(existingService);
  const raw = inputs.values ? { ...base, ...inputs.values } : base;
  const evaluated = parseExternalMcpDraft(raw, creating, existingService, locale);

  const fields: PanelFormField[] = [
    {
      path: "/name",
      label: t("fields.name"),
      required: true,
      readOnly: false,
      valueSchema: cachedZodToRuntimeJsonSchema(z.string().trim().min(1).max(100)),
      control: { kind: "text", maxLength: 100, placeholder: t("fields.namePlaceholder") },
    },
    {
      path: "/url",
      label: t("fields.url"),
      help: t("fields.urlHelp"),
      required: true,
      readOnly: false,
      valueSchema: cachedZodToRuntimeJsonSchema(z.string().trim().min(1)),
      control: { kind: "text", placeholder: "https://example.com/mcp" },
    },
    {
      path: "/headers",
      label: t("fields.headers"),
      help: t("fields.headersHelp"),
      required: false,
      readOnly: false,
      valueSchema: cachedZodToRuntimeJsonSchema(z.array(headerRowSchema)),
      control: {
        kind: "object-array",
        presentation: "inline",
        reorderable: false,
        addLabel: t("fields.addHeader"),
        defaultItem: { name: "", value: "" },
        itemFields: [
          {
            path: "/name",
            label: t("fields.headerName"),
            required: true,
            readOnly: false,
            valueSchema: cachedZodToRuntimeJsonSchema(z.string().min(1)),
            control: { kind: "text", placeholder: "Authorization" },
          },
          {
            path: "/value",
            label: t("fields.headerValue"),
            required: false,
            readOnly: false,
            valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
            control: {
              kind: "text",
              secret: true,
              placeholder: creating
                ? t("fields.headerValuePlaceholder")
                : t("fields.headerValueKeepPlaceholder"),
            },
          },
          {
            path: "/storedName",
            label: t("fields.headerName"),
            required: false,
            readOnly: true,
            valueSchema: cachedZodToRuntimeJsonSchema(z.string().optional()),
            control: { kind: "hidden" },
          },
        ],
      },
    },
  ];

  return {
    values: evaluated.values as unknown as Record<string, RuntimeJsonValue>,
    fields,
    errors: inputs.values ? evaluated.errors : [],
    save: {
      method: creating ? "POST" : "PUT",
      path: creating || !existingService
        ? "/api/mcp/services"
        : `/api/mcp/services/${encodeURIComponent(existingService.id)}`,
      bodySchema: cachedZodToRuntimeJsonSchema(externalMcpFormValuesSchema),
    },
  };
}

function validateServiceId(primaryKey: string): string {
  const parsed = runtimeIdSchema.safeParse(primaryKey);
  if (!parsed.success) {
    throw new HttpError(404, "External MCP service not found", "NOT_FOUND");
  }
  return parsed.data;
}

async function findService(runtime: RuntimeClient, primaryKey: string): Promise<McpServiceView> {
  const id = validateServiceId(primaryKey);
  const { services } = await runtime.mcpServices();
  const matched = services.find((service) => service.id === id);
  if (!matched) {
    throw new HttpError(404, "External MCP service not found", "NOT_FOUND");
  }
  return matched;
}

async function readMaskedServiceConfiguration<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    // Decoder errors can contain the received header value. Fail without publishing the payload.
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      throw new HttpError(502, "Runtime did not return a valid masked MCP service configuration", "PANEL_READ_OWNER_RESPONSE_INVALID");
    throw error;
  }
}

function externalMcpFormReads(runtime: RuntimeClient, locale?: string) {
  return {
    async form(primaryKey: string, inputs: FormInputs): Promise<PanelFormDescription> {
      const service = await readMaskedServiceConfiguration(() => findService(runtime, primaryKey));
      return buildFormDescription(false, service, inputs, locale);
    },
    async createForm(inputs: FormInputs): Promise<PanelFormDescription> {
      return buildFormDescription(true, null, inputs, locale);
    },
  };
}

const mcpServicesReadApproval = z.literal(workbenchManagement.mcpServicesRead.id);

function externalMcpDirectoryReads(runtime: RuntimeClient, locale: string | undefined, readUsage: () => Promise<VisibleAgentMcpUsage>) {
  return {
    async list(): Promise<PanelRecord[]> {
      const [{ services }, usage] = await Promise.all([
        readMaskedServiceConfiguration(() => runtime.mcpServices()), readUsage(),
      ]);
      return services.map(service => toServiceRecord(service, usage, locale));
    },
    async record(primaryKey: string): Promise<PanelRecord> {
      const [service, usage] = await Promise.all([
        readMaskedServiceConfiguration(() => findService(runtime, primaryKey)), readUsage(),
      ]);
      return toServiceRecord(service, usage, locale);
    },
  };
}

export function createRegisteredExternalMcpDirectoryReads(
  owner: AssistantOwner, locale: string | undefined, javaFacts: unknown, view: ObjectVisibilityRange,
) {
  mcpServicesReadApproval.parse(javaFacts);
  return externalMcpDirectoryReads(createRuntime(owner), locale, async () => {
    const { readVisibleAgentMcpUsagesInRange } = await import("../product-panels/agent-definition-directory");
    return readVisibleAgentMcpUsagesInRange(owner.domainId, locale, view);
  });
}

async function readExternalMcpTools(runtime: ReturnType<typeof createRuntime>, primaryKey: string, locale: string | undefined) {
  const id = validateServiceId(primaryKey);
  const { tools } = await runtime.mcpTools(id, new AbortController().signal);
  return tools.map((tool) => mcpToolToPanelRecord(tool, locale));
}

export function readRegisteredExternalMcpTools(
  owner: AssistantOwner, locale: string | undefined, javaFacts: unknown, primaryKey: string,
) {
  mcpServicesReadApproval.parse(javaFacts);
  return readExternalMcpTools(createRuntime(owner), primaryKey, locale);
}

export function createRegisteredExternalMcpFormReads(owner: AssistantOwner, locale: string | undefined, javaFacts: unknown) {
  mcpServicesReadApproval.parse(javaFacts);
  return externalMcpFormReads(createRuntime(owner), locale);
}

export function createExternalMcpReads(owner: AssistantOwner, viewer: AssistantCredentials) {
  const runtime = createRuntime(owner);
  const forms = externalMcpFormReads(runtime, viewer.locale);
  const directory = externalMcpDirectoryReads(runtime, viewer.locale, () => readSafeAgentUsages(owner, viewer));

  const optionList = async (): Promise<PanelOption[]> =>
    (await runtime.mcpOptions()).map(({ id, name }) => ({
      primaryKey: id,
      value: id,
      label: name,
    }));

  return {
    // Agent editors use the names endpoint to pick references.
    async options() {
      return { options: await optionList() };
    },
    async resolve(values: readonly unknown[]) {
      const ids = values.map((value) => runtimeIdSchema.parse(value));
      const options = new Map((await optionList()).map((option) => [option.primaryKey, option]));
      const reason = tForLocale(viewer.locale, "panels.agentOptions.unavailable");
      return {
        options: ids.map(
          (id) => options.get(id) ?? { primaryKey: id, value: id, label: id, unavailable: { reason } },
        ),
      };
    },
    async list(): Promise<PanelRecord[]> {
      await assertManagement(workbenchManagement.mcpServicesRead, owner, viewer);
      return directory.list();
    },
    async record(primaryKey: string): Promise<PanelRecord> {
      await assertManagement(workbenchManagement.mcpServicesRead, owner, viewer);
      return directory.record(primaryKey);
    },
    async form(primaryKey: string, inputs: FormInputs): Promise<PanelFormDescription> {
      await assertManagement(workbenchManagement.mcpServicesRead, owner, viewer);
      return forms.form(primaryKey, inputs);
    },
    async createForm(inputs: FormInputs): Promise<PanelFormDescription> {
      await assertManagement(workbenchManagement.mcpServicesRead, owner, viewer);
      return forms.createForm(inputs);
    },
    async tools(primaryKey: string): Promise<PanelRecord[]> {
      await assertManagement(workbenchManagement.mcpServicesRead, owner, viewer);
      return readExternalMcpTools(runtime, primaryKey, viewer.locale);
    },
  };
}

function mapSaveError(error: unknown, locale?: string): SinglePanelOperationOutcome {
  if (error instanceof HttpError) {
    if (error.code === "MCP_NAME_EXISTS") {
      const message = tForLocale(locale, "panels.externalMcp.errors.nameExists");
      return {
        kind: "refusal",
        code: "MCP_NAME_EXISTS",
        message,
        errors: [{ field: "/name", code: "already_exists", message }],
      };
    }
    if (error.status === 404) {
      return {
        kind: "refusal",
        code: "NOT_FOUND",
        message: tForLocale(locale, "panels.externalMcp.errors.notFound"),
      };
    }
    if (error.status === 400 || error.status === 422) {
      return {
        kind: "refusal",
        code: error.code ?? "INVALID_REQUEST",
        message: error.message,
      };
    }
  }
  throw error;
}

const deleteExternalMcpImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_EXTERNAL_MCP_SERVICE}.inspect-impact`,
  async inspect(host, calls) {
    await assertManagement(workbenchManagement.mcpServicesDelete, host.executor.owner, host.executor.credentials);
    const target = calls[0]!.target as PanelRecordTarget;
    const runtime = createRuntime(host.executor.owner);
    const [{ services }, usage] = await Promise.all([
      runtime.mcpServices(),
      readSafeAgentUsages(host.executor.owner, host.executor.credentials),
    ]);
    const service = services.find((item) => item.id === target.primaryKey);
    const label = service?.name ?? target.primaryKey;
    const usedNames = usage.byServiceId.get(target.primaryKey) ?? [];
    const base = tForLocale(host.locale, "panels.externalMcp.impact.deleteService", { name: label });
    const summary = usedNames.length > 0
      ? `${base} ${tForLocale(host.locale, "panels.externalMcp.impact.affectedAgents", { names: usedNames.join(", ") })}`
      : base;
    return {
      summary,
      objects: [{ target: { objectType: EXTERNAL_MCP_SERVICE, primaryKey: target.primaryKey }, label }],
      total: 1,
    };
  },
};

function mergeSubmittedUpdate(
  base: { name: string; url: string; headers: HeaderDraftRow[] },
  values: Record<string, unknown>,
  submittedFields?: readonly string[],
): Record<string, unknown> {
  if (submittedFields === undefined) {
    return { ...base, ...values };
  }
  const merged: Record<string, unknown> = { ...base };
  if (submittedFields.includes("/name")) merged.name = values.name;
  if (submittedFields.includes("/url")) merged.url = values.url;
  if (submittedFields.some((field) => field === "/headers" || field.startsWith("/headers/"))) {
    merged.headers = values.headers;
  }
  return merged;
}

export const externalMcpServerOperations: readonly PanelServerOperation[] = [
  {
    handlerRef: CREATE_EXTERNAL_MCP_SERVICE,
    labelKey: "panels.externalMcp.operations.create",
    kind: "form.save",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformObjectType", id: EXTERNAL_MCP_SERVICE },
    targetType: EXTERNAL_MCP_SERVICE,
    targetSchema: draftTargetSchema,
    inputSchema: saveInputSchema,
    resultSchema: savedIdSchema,
    draftInput: (input) => saveInputSchema.parse(input).values,
    create: true,
    async execute(
      host: PanelOperationHost,
      _target: PanelOperationTarget,
      input: Record<string, unknown>,
    ): Promise<SinglePanelOperationOutcome> {
      await assertManagement(workbenchManagement.mcpServicesCreate, host.executor.owner, host.executor.credentials);
      const { values } = saveInputSchema.parse(input);
      const evaluated = parseExternalMcpDraft(values, true, null, host.locale);
      if (evaluated.errors.length > 0 || !evaluated.payload) {
        return {
          kind: "refusal",
          code: "INVALID_EXTERNAL_MCP",
          message: evaluated.errors[0]?.message ?? tForLocale(host.locale, "panels.externalMcp.errors.invalidHeaders"),
          errors: evaluated.errors,
        };
      }
      const runtime = createRuntime(host.executor.owner);
      try {
        const saved = await runtime.saveMcpService(evaluated.payload);
        return {
          kind: "success",
          data: { id: saved.service.id },
          created: { objectType: EXTERNAL_MCP_SERVICE, primaryKey: saved.service.id },
          affected: {
            objectTypes: [EXTERNAL_MCP_SERVICE],
            objects: [{ objectType: EXTERNAL_MCP_SERVICE, primaryKey: saved.service.id }],
          },
        };
      } catch (error) {
        return mapSaveError(error, host.locale);
      }
    },
  },
  {
    handlerRef: SAVE_EXTERNAL_MCP_OP,
    labelKey: "panels.externalMcp.operations.save",
    kind: "form.save",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformObjectType", id: EXTERNAL_MCP_SERVICE },
    targetType: EXTERNAL_MCP_SERVICE,
    targetSchema: objectTargetSchema,
    inputSchema: saveInputSchema,
    resultSchema: savedIdSchema,
    draftInput: (input) => saveInputSchema.parse(input).values,
    async execute(
      host: PanelOperationHost,
      target: PanelOperationTarget,
      input: Record<string, unknown>,
    ): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") {
        throw new Error("Saving an external MCP service requires a selected service");
      }
      await assertManagement(workbenchManagement.mcpServicesChange, host.executor.owner, host.executor.credentials);
      const runtime = createRuntime(host.executor.owner);
      let existing: McpServiceView;
      try {
        existing = await findService(runtime, target.primaryKey);
      } catch (error) {
        return mapSaveError(error, host.locale);
      }
      const { values, submittedFields } = saveInputSchema.parse(input);
      const base = toInitialFormValues(existing);
      const evaluated = parseExternalMcpDraft(
        mergeSubmittedUpdate(base, values, submittedFields),
        false,
        existing,
        host.locale,
      );
      if (evaluated.errors.length > 0 || !evaluated.payload) {
        return {
          kind: "refusal",
          code: "INVALID_EXTERNAL_MCP",
          message: evaluated.errors[0]?.message ?? tForLocale(host.locale, "panels.externalMcp.errors.invalidHeaders"),
          errors: evaluated.errors,
        };
      }
      try {
        const saved = await runtime.saveMcpService(evaluated.payload, target.primaryKey);
        return {
          kind: "success",
          data: { id: saved.service.id },
          affected: {
            objectTypes: [EXTERNAL_MCP_SERVICE],
            objects: [{ objectType: EXTERNAL_MCP_SERVICE, primaryKey: saved.service.id }],
          },
        };
      } catch (error) {
        return mapSaveError(error, host.locale);
      }
    },
  },
  {
    handlerRef: CHECK_EXTERNAL_MCP_SERVICE,
    labelKey: "panels.externalMcp.operations.check",
    kind: "action",
    effect: "read",
    batch: false,
    binding: { kind: "PlatformOperation", id: CHECK_EXTERNAL_MCP_SERVICE },
    target: { source: "input", input: "service" },
    targetType: EXTERNAL_MCP_SERVICE,
    targetSchema: objectTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: checkResultSchema,
    async execute(
      host: PanelOperationHost,
      call: z.infer<typeof panelReadOperationCallSchema>,
    ): Promise<z.infer<typeof checkResultSchema>> {
      if (call.target?.kind !== "object") {
        throw new Error("Checking an external MCP service requires a selected service");
      }
      await assertManagement(workbenchManagement.mcpServicesRead, host.executor.owner, host.executor.credentials);
      const id = validateServiceId(call.target.primaryKey);
      const t = (key: string, params?: Record<string, unknown>) =>
        tForLocale(host.locale, `panels.externalMcp.${key}`, params);
      const runtime = createRuntime(host.executor.owner);
      try {
        const { tools } = await runtime.mcpTools(id, new AbortController().signal);
        return {
          kind: "json" as const,
          value: {
            reachable: true,
            toolCount: tools.length,
            status: {
              label: t("status.available"),
              tone: "success",
            },
          },
          message: t("check.ok", { count: tools.length }),
        };
      } catch (error) {
        const reason = error instanceof Error && error.message.trim()
          ? error.message.trim()
          : t("status.unreachable");
        return {
          kind: "json" as const,
          value: {
            reachable: false,
            toolCount: 0,
            error: reason,
            status: {
              label: t("status.unreachable"),
              tone: "danger",
            },
          },
          message: t("check.failed", { reason }),
        };
      }
    },
  },
  {
    handlerRef: DELETE_EXTERNAL_MCP_SERVICE,
    labelKey: "panels.externalMcp.operations.delete",
    kind: "action",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformOperation", id: DELETE_EXTERNAL_MCP_SERVICE },
    targetType: EXTERNAL_MCP_SERVICE,
    targetSchema: objectTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: emptyInputSchema,
    targetInput: "service",
    inspectImpact: deleteExternalMcpImpact,
    async targetLabel(host, target) {
      const runtime = createRuntime(host.executor.owner);
      try {
        const service = await findService(runtime, target.primaryKey);
        return service.name;
      } catch {
        return target.primaryKey;
      }
    },
    async execute(
      host: PanelOperationHost,
      target: PanelOperationTarget,
    ): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") {
        throw new Error("Deleting an external MCP service requires a selected service");
      }
      await assertManagement(workbenchManagement.mcpServicesDelete, host.executor.owner, host.executor.credentials);
      const runtime = createRuntime(host.executor.owner);
      try {
        await runtime.deleteMcpService(target.primaryKey);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          return {
            kind: "refusal",
            code: "NOT_FOUND",
            message: tForLocale(host.locale, "panels.externalMcp.errors.notFound"),
          };
        }
        throw error;
      }
      return {
        kind: "success",
        data: {},
        affected: {
          objectTypes: [EXTERNAL_MCP_SERVICE],
          objects: [{ objectType: EXTERNAL_MCP_SERVICE, primaryKey: target.primaryKey }],
          removed: [{ objectType: EXTERNAL_MCP_SERVICE, primaryKey: target.primaryKey }],
        },
      };
    },
  },
];
