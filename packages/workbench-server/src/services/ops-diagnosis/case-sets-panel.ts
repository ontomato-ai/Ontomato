import { z } from "zod";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { CaseSet, TestCase } from "@ontomato/contracts/autotest";
import type { FormFieldError } from "@ontomato/contracts/form-fields";
import {
  panelFormSaveInputSchema,
  type PanelFormDescription,
  type PanelFormField,
  type PanelFormRequest,
  type PanelFormValues,
  type PanelRecord,
} from "@ontomato/contracts/panel-projection";
import {
  AUTOTEST_CASE_SET,
  CREATE_AUTOTEST_CASE_SET,
  DELETE_AUTOTEST_CASE_SET,
  IMPORT_AUTOTEST_CASE_SET,
} from "@ontomato/contracts/platform-object-types";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import {
  createEmptyCaseSet,
  deleteCaseSet,
  getCaseSet,
  importCaseSet,
  isValidCaseId,
  listCaseSets,
  parseCaseSetImportPayload,
  updateCaseSet,
} from "../../platform/diagnosis/autotest/cases/repository";
import { loadEvaluationProtocol } from "../../platform/diagnosis/autotest/evaluation/conclusion-parser";
import { HttpError } from "../../utils/errors";
import { cachedZodToRuntimeJsonSchema } from "../../utils/zod-json-schema";
import type { ProductOwner } from "../product-governance/grants";
import type {
  PanelImpactInspector,
  PanelOperationHost,
  PanelOperationTarget,
  PanelRecordTarget,
  PanelServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";
import { applySubmittedFields } from "../product-panels/submitted-form-values";
import { requireObserveAccessDomain } from "./panel-reads";

export type AutotestCaseEditMode = "form" | "json";
type CaseSetFormInputs = Partial<Pick<PanelFormRequest, "values" | "changedField">> & {
  editMode?: AutotestCaseEditMode;
};

const SAVE_AUTOTEST_CASE_SET = `${AUTOTEST_CASE_SET}.save`;

const emptyInputSchema = z.object({}).strict();
const emptyResultSchema = z.object({}).strict();

const caseSetTargetSchema = z.object({
  kind: z.literal("object"),
  objectType: z.literal(AUTOTEST_CASE_SET),
  primaryKey: z.string().min(1),
}).strict();

const createCaseSetInputSchema = z.object({
  name: z.string().trim().min(1),
}).strict();

const createCaseSetResultSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
}).strict();

const importCaseSetInputSchema = z.object({
  name: z.string().trim().min(1),
  content: z.string().min(1),
  format: z.enum(["auto", "json", "csv"]).optional(),
}).strict();

const importCaseSetResultSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  caseCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
}).strict();

const saveCaseSetInputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();

const saveCaseSetResultSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  caseCount: z.number().int().nonnegative(),
}).strict();

const editableCaseSchema = z.object({
  caseId: z.string().trim().min(1),
  question: z.string().trim().min(1),
  expectedAnswer: z.string().optional(),
  expectedLogic: z.string().optional(),
  judgment: z.string().optional(),
}).strict();

const caseSetFormValuesSchema = z.object({
  name: z.string().trim().min(1),
  cases: z.array(editableCaseSchema),
}).strict();

function defaultJudgmentText(locale?: string): string {
  try {
    return loadEvaluationProtocol().defaultJudgment;
  } catch {
    return tForLocale(locale, "panels.ops.caseSets.defaultJudgment");
  }
}

function toEditableCases(cases: readonly TestCase[], locale?: string): Record<string, RuntimeJsonValue>[] {
  const fallbackJudgment = defaultJudgmentText(locale);
  return cases.map((item) => ({
    caseId: item.caseId,
    question: item.question,
    expectedAnswer: item.expectedAnswer ?? "",
    expectedLogic: item.expectedLogic ?? "",
    judgment: item.judgment?.trim() || fallbackJudgment,
  }));
}

function toInitialFormValues(caseSet: CaseSet, locale?: string): PanelFormValues {
  return {
    name: caseSet.name,
    cases: toEditableCases(caseSet.cases, locale),
  };
}

function validateAndNormalizeCaseSetDraft(
  raw: Record<string, unknown>,
  locale: string | undefined,
  editMode: AutotestCaseEditMode,
): { name: string; cases: TestCase[]; errors: FormFieldError[] } {
  const errors: FormFieldError[] = [];
  const fallbackJudgment = defaultJudgmentText(locale);

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    errors.push({
      field: "/name",
      code: "required",
      message: tForLocale(locale, "panels.ops.caseSets.errors.nameRequired"),
    });
  }

  const normalizedCases: TestCase[] = [];
  if (!Array.isArray(raw.cases)) {
    errors.push({
      field: "/cases",
      code: "invalid_array",
      message: tForLocale(locale, "panels.ops.caseSets.errors.casesMustBeArray"),
    });
    return { name, cases: normalizedCases, errors };
  }

  const seenCaseIds = new Set<string>();
  const caseField = (index: number, key?: string) => {
    if (editMode === "json") return "/cases";
    return key ? `/cases/${index}/${key}` : `/cases/${index}`;
  };

  for (let i = 0; i < raw.cases.length; i++) {
    const entry = raw.cases[i];
    const index = i + 1;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push({
        field: caseField(i),
        code: "invalid_object",
        message: tForLocale(locale, "panels.ops.caseSets.errors.caseMustBeObject", { index }),
      });
      continue;
    }

    const obj = entry as Record<string, unknown>;
    const caseId = obj.caseId == null ? "" : String(obj.caseId).trim();
    const question = obj.question == null ? "" : String(obj.question).trim();
    const expectedAnswer = obj.expectedAnswer == null ? "" : String(obj.expectedAnswer);
    const expectedLogic = obj.expectedLogic == null ? "" : String(obj.expectedLogic);
    const rawJudgment = obj.judgment == null ? "" : String(obj.judgment).trim();

    if (!caseId) {
      errors.push({
        field: caseField(i, "caseId"),
        code: "required",
        message: tForLocale(locale, "panels.ops.caseSets.errors.caseIdRequired", { index }),
      });
    } else if (!isValidCaseId(caseId)) {
      errors.push({
        field: caseField(i, "caseId"),
        code: "invalid_format",
        message: tForLocale(locale, "panels.ops.caseSets.errors.caseIdInvalid", { index }),
      });
    } else if (seenCaseIds.has(caseId)) {
      errors.push({
        field: caseField(i, "caseId"),
        code: "already_exists",
        message: tForLocale(locale, "panels.ops.caseSets.errors.caseIdDuplicate", { caseId, index }),
      });
    } else {
      seenCaseIds.add(caseId);
    }

    if (!question) {
      errors.push({
        field: caseField(i, "question"),
        code: "required",
        message: tForLocale(locale, "panels.ops.caseSets.errors.questionRequired", { index }),
      });
    }

    normalizedCases.push({
      caseId,
      question,
      ...(expectedAnswer.trim() ? { expectedAnswer } : {}),
      ...(expectedLogic.trim() ? { expectedLogic } : {}),
      judgment: rawJudgment || fallbackJudgment,
    });
  }

  return { name, cases: normalizedCases, errors };
}

function buildCaseSetFormDescription(
  caseSet: CaseSet,
  inputs: CaseSetFormInputs,
  locale?: string,
): PanelFormDescription {
  const editMode: AutotestCaseEditMode = inputs.editMode === "json" ? "json" : "form";
  const fallbackJudgment = defaultJudgmentText(locale);
  const base = toInitialFormValues(caseSet, locale);
  const draft: PanelFormValues = inputs.values
    ? { ...base, ...inputs.values }
    : base;
  const evaluated = inputs.values
    ? validateAndNormalizeCaseSetDraft(draft, locale, editMode)
    : null;

  // Single canonical `/cases` field: switches control kind between `object-array` (form mode)
  // and `{ kind: "code", language: "json" }` (JSON mode) without duplicating fields.
  const casesField: PanelFormField = {
    path: "/cases",
    label: tForLocale(locale, "panels.ops.caseSets.fields.cases"),
    help: tForLocale(
      locale,
      editMode === "json"
        ? "panels.ops.caseSets.fields.casesJsonHelp"
        : "panels.ops.caseSets.fields.casesFormHelp",
    ),
    required: false,
    readOnly: false,
    valueSchema: cachedZodToRuntimeJsonSchema(z.array(editableCaseSchema)),
    control: editMode === "json"
      ? { kind: "code", language: "json" }
      : {
          kind: "object-array",
          itemKeyPath: "/caseId",
          defaultItem: {
            caseId: "",
            question: "",
            expectedAnswer: "",
            expectedLogic: "",
            judgment: fallbackJudgment,
          },
          itemFields: [
            {
              path: "/caseId",
              label: tForLocale(locale, "panels.ops.fields.caseId"),
              required: true,
              readOnly: false,
              valueSchema: cachedZodToRuntimeJsonSchema(z.string().trim().min(1)),
              control: { kind: "text", placeholder: "case-1" },
            },
            {
              path: "/question",
              label: tForLocale(locale, "panels.ops.fields.question"),
              required: true,
              readOnly: false,
              valueSchema: cachedZodToRuntimeJsonSchema(z.string().trim().min(1)),
              control: { kind: "text", multiline: true, rows: 3 },
            },
            {
              path: "/expectedAnswer",
              label: tForLocale(locale, "panels.ops.caseSets.fields.expectedAnswer"),
              required: false,
              readOnly: false,
              valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
              control: {
                kind: "text",
                multiline: true,
                rows: 2,
                placeholder: tForLocale(locale, "panels.ops.caseSets.fields.expectedAnswerPlaceholder"),
              },
            },
            {
              path: "/judgment",
              label: tForLocale(locale, "panels.ops.caseSets.fields.judgment"),
              help: tForLocale(locale, "panels.ops.caseSets.fields.judgmentHelp", { defaultJudgment: fallbackJudgment }),
              required: false,
              readOnly: false,
              valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
              control: {
                kind: "text",
                multiline: true,
                rows: 2,
                placeholder: fallbackJudgment,
              },
            },
            {
              path: "/expectedLogic",
              label: tForLocale(locale, "panels.ops.caseSets.fields.expectedLogic"),
              required: false,
              readOnly: false,
              valueSchema: cachedZodToRuntimeJsonSchema(z.string()),
              control: {
                kind: "text",
                multiline: true,
                rows: 4,
                placeholder: tForLocale(locale, "panels.ops.caseSets.fields.expectedLogicPlaceholder"),
              },
            },
          ],
        },
  };

  const fields: PanelFormField[] = [
    {
      path: "/name",
      label: tForLocale(locale, "panels.ops.caseSets.fields.name"),
      required: true,
      readOnly: false,
      valueSchema: cachedZodToRuntimeJsonSchema(z.string().trim().min(1)),
      control: {
        kind: "text",
        placeholder: tForLocale(locale, "panels.ops.caseSets.fields.namePlaceholder"),
      },
    },
    casesField,
  ];

  return {
    values: draft,
    fields,
    errors: evaluated ? evaluated.errors : [],
    save: {
      method: "PUT",
      path: `/api/observe/autotest/case-sets/${encodeURIComponent(caseSet.id)}`,
      bodySchema: cachedZodToRuntimeJsonSchema(caseSetFormValuesSchema),
    },
  };
}

async function requireOwnedCaseSet(
  owner: Pick<ProductOwner, "domainId">,
  viewer: Pick<AssistantCredentials, "token" | "apiKey" | "locale">,
  id: string,
): Promise<{ domainId: string; caseSet: CaseSet }> {
  const domainId = await requireObserveAccessDomain(owner, viewer);
  if (!isValidCaseId(id)) {
    throw new HttpError(400, "Invalid case set id");
  }
  const caseSet = getCaseSet(id, domainId);
  if (!caseSet) {
    throw new HttpError(404, tForLocale(viewer.locale, "panels.ops.caseSets.errors.notFound"), "NOT_FOUND");
  }
  return { domainId, caseSet };
}

function caseSetRecord(
  item: { id: string; name: string; caseCount: number; createdAt: string; updatedAt: string },
  locale?: string,
): PanelRecord {
  const caseCountText = tForLocale(locale, "panels.ops.caseSets.caseCount", { count: item.caseCount });
  return {
    className: AUTOTEST_CASE_SET,
    primaryKey: item.id,
    label: item.name,
    subtitle: caseCountText,
    fields: {
      id: item.id,
      name: item.name,
      caseCount: item.caseCount,
      caseCountText,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    },
    fieldLabels: {
      name: tForLocale(locale, "panels.ops.caseSets.fields.name"),
      caseCountText: tForLocale(locale, "panels.ops.caseSets.fields.caseCount"),
      createdAt: tForLocale(locale, "panels.ops.fields.createdAt"),
      updatedAt: tForLocale(locale, "panels.ops.fields.updatedAt"),
    },
    outputs: {
      caseCount: item.caseCount,
    },
  };
}

export function createAutotestCaseSetReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const locale = viewer.locale;

  return {
    async list(params: { search?: string } = {}): Promise<PanelRecord[]> {
      const domainId = await requireObserveAccessDomain(owner, viewer);
      const query = params.search?.trim().toLowerCase() ?? "";
      return listCaseSets(domainId)
        .filter((item) => !query || item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query))
        .map((item) => caseSetRecord(item, locale));
    },

    async record(id: string): Promise<PanelRecord> {
      const { caseSet } = await requireOwnedCaseSet(owner, viewer, id);
      return caseSetRecord(
        {
          id: caseSet.id,
          name: caseSet.name,
          caseCount: caseSet.cases.length,
          createdAt: caseSet.createdAt,
          updatedAt: caseSet.updatedAt,
        },
        locale,
      );
    },

    async form(id: string, inputs: CaseSetFormInputs = {}): Promise<PanelFormDescription> {
      const { caseSet } = await requireOwnedCaseSet(owner, viewer, id);
      return buildCaseSetFormDescription(caseSet, inputs, locale);
    },
  };
}

function refusalFromError(error: unknown, fallbackCode: string, fallbackMessage: string): SinglePanelOperationOutcome {
  if (error instanceof HttpError && error.status < 500) {
    return {
      kind: "refusal",
      code: error.code ?? fallbackCode,
      message: error.message || fallbackMessage,
    };
  }
  throw error;
}

async function caseSetLabel(host: PanelOperationHost, target: PanelRecordTarget): Promise<string> {
  try {
    if (!isValidCaseId(target.primaryKey)) return target.primaryKey;
    const cs = getCaseSet(target.primaryKey, host.initiator.owner.domainId);
    if (cs) return cs.name;
  } catch {
    // Fall back to primaryKey when the case set cannot be resolved.
  }
  return target.primaryKey;
}

const deleteCaseSetImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_AUTOTEST_CASE_SET}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    const { caseSet } = await requireOwnedCaseSet(
      host.initiator.owner,
      host.initiator.credentials,
      target.primaryKey,
    );
    return {
      summary: tForLocale(host.locale, "panels.ops.caseSets.confirmDelete", {
        name: caseSet.name,
        count: caseSet.cases.length,
      }),
      objects: [{ target: { objectType: AUTOTEST_CASE_SET, primaryKey: caseSet.id }, label: caseSet.name }],
      total: 1,
    };
  },
};

export const autotestCaseSetServerOperations = [
  {
    handlerRef: CREATE_AUTOTEST_CASE_SET,
    labelKey: "panels.ops.caseSets.actions.create",
    kind: "action",
    binding: { kind: "PlatformOperation", id: CREATE_AUTOTEST_CASE_SET },
    effect: "write",
    batch: false,
    targetType: AUTOTEST_CASE_SET,
    targetSchema: z.null(),
    inputSchema: createCaseSetInputSchema,
    resultSchema: createCaseSetResultSchema,
    describeInputSchema(_host, locale) {
      return {
        type: "object",
        properties: {
          name: {
            type: "string",
            minLength: 1,
            title: tForLocale(locale, "panels.ops.caseSets.fields.name"),
            description: tForLocale(locale, "panels.ops.caseSets.fields.nameHint"),
          },
        },
        required: ["name"],
        additionalProperties: false,
      };
    },
    async execute(host: PanelOperationHost, _target: null, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const parsed = createCaseSetInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          kind: "refusal",
          code: "INVALID_AUTOTEST_CASE_SET",
          message: tForLocale(host.locale, "panels.ops.caseSets.errors.nameRequired"),
        };
      }
      try {
        const domainId = await requireObserveAccessDomain(host.executor.owner, host.executor.credentials);
        const caseSet = createEmptyCaseSet(parsed.data.name, domainId);
        return {
          kind: "success",
          message: tForLocale(host.locale, "panels.ops.caseSets.done.created", { name: caseSet.name }),
          data: { id: caseSet.id, name: caseSet.name },
          created: { objectType: AUTOTEST_CASE_SET, primaryKey: caseSet.id },
          affected: {
            objectTypes: [AUTOTEST_CASE_SET],
            objects: [{ objectType: AUTOTEST_CASE_SET, primaryKey: caseSet.id }],
          },
        };
      } catch (error) {
        return refusalFromError(error, "CREATE_CASE_SET_REFUSED", tForLocale(host.locale, "panels.ops.caseSets.errors.saveFailed"));
      }
    },
  },
  {
    handlerRef: IMPORT_AUTOTEST_CASE_SET,
    labelKey: "panels.ops.caseSets.actions.import",
    kind: "action",
    binding: { kind: "PlatformOperation", id: IMPORT_AUTOTEST_CASE_SET },
    effect: "write",
    batch: false,
    targetType: AUTOTEST_CASE_SET,
    targetSchema: z.null(),
    inputSchema: importCaseSetInputSchema,
    resultSchema: importCaseSetResultSchema,
    describeInputSchema(_host, locale) {
      return {
        type: "object",
        properties: {
          name: {
            type: "string",
            minLength: 1,
            title: tForLocale(locale, "panels.ops.caseSets.fields.name"),
            description: tForLocale(locale, "panels.ops.caseSets.fields.nameHint"),
          },
          format: {
            type: "string",
            enum: ["auto", "json", "csv"],
            default: "auto",
            title: tForLocale(locale, "panels.ops.caseSets.fields.importFormat"),
            description: tForLocale(locale, "panels.ops.caseSets.fields.importFormatHint"),
          },
          content: {
            type: "string",
            minLength: 1,
            format: "textarea",
            title: tForLocale(locale, "panels.ops.caseSets.fields.importContent"),
            description: tForLocale(locale, "panels.ops.caseSets.fields.importContentHint"),
          },
        },
        required: ["name", "content"],
        additionalProperties: false,
      };
    },
    async execute(host: PanelOperationHost, _target: null, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const parsed = importCaseSetInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          kind: "refusal",
          code: "INVALID_CASE_SET_IMPORT",
          message: tForLocale(host.locale, "panels.ops.caseSets.errors.importFailed"),
        };
      }
      try {
        const domainId = await requireObserveAccessDomain(host.executor.owner, host.executor.credentials);
        const payload = parseCaseSetImportPayload(parsed.data.content, parsed.data.format ?? "auto");
        const { caseSet, warnings } = importCaseSet(parsed.data.name, payload, domainId);
        const message = warnings.length > 0
          ? tForLocale(host.locale, "panels.ops.caseSets.done.importedWithWarnings", {
              name: caseSet.name,
              count: caseSet.cases.length,
              warnings: warnings.length,
            })
          : tForLocale(host.locale, "panels.ops.caseSets.done.imported", {
              name: caseSet.name,
              count: caseSet.cases.length,
            });
        return {
          kind: "success",
          message,
          data: {
            id: caseSet.id,
            name: caseSet.name,
            caseCount: caseSet.cases.length,
            warnings,
          },
          created: { objectType: AUTOTEST_CASE_SET, primaryKey: caseSet.id },
          affected: {
            objectTypes: [AUTOTEST_CASE_SET],
            objects: [{ objectType: AUTOTEST_CASE_SET, primaryKey: caseSet.id }],
          },
        };
      } catch (error) {
        if (error instanceof HttpError) {
          return refusalFromError(error, "IMPORT_CASE_SET_REFUSED", tForLocale(host.locale, "panels.ops.caseSets.errors.importFailed"));
        }
        const message = error instanceof Error ? error.message : tForLocale(host.locale, "panels.ops.caseSets.errors.importFailed");
        return {
          kind: "refusal",
          code: "INVALID_CASE_SET_IMPORT",
          message,
        };
      }
    },
  },
  {
    handlerRef: SAVE_AUTOTEST_CASE_SET,
    labelKey: "panels.ops.caseSets.actions.save",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: AUTOTEST_CASE_SET },
    effect: "write",
    batch: false,
    targetType: AUTOTEST_CASE_SET,
    targetSchema: caseSetTargetSchema,
    inputSchema: saveCaseSetInputSchema,
    resultSchema: saveCaseSetResultSchema,
    draftInput: (input) => saveCaseSetInputSchema.parse(input).values,
    async execute(
      host: PanelOperationHost,
      target: PanelOperationTarget,
      input: Record<string, unknown>,
    ): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") {
        throw new Error("Saving a test case set requires a selected case set");
      }
      const { values, submittedFields } = saveCaseSetInputSchema.parse(input);
      try {
        const { domainId, caseSet } = await requireOwnedCaseSet(
          host.executor.owner,
          host.executor.credentials,
          target.primaryKey,
        );
        const currentValues = toInitialFormValues(caseSet, host.locale);
        const mergedValues = submittedFields !== undefined
          ? applySubmittedFields(currentValues, values, submittedFields)
          : { ...currentValues, ...values };

        const evaluated = validateAndNormalizeCaseSetDraft(mergedValues, host.locale, "form");
        if (evaluated.errors.length > 0) {
          return {
            kind: "refusal",
            code: "INVALID_AUTOTEST_CASE_SET",
            message: evaluated.errors[0]!.message,
            errors: evaluated.errors,
          };
        }

        const updated = updateCaseSet(caseSet.id, domainId, {
          name: evaluated.name,
          cases: evaluated.cases,
        });
        if (!updated) {
          return {
            kind: "refusal",
            code: "NOT_FOUND",
            message: tForLocale(host.locale, "panels.ops.caseSets.errors.notFound"),
          };
        }

        return {
          kind: "success",
          message: tForLocale(host.locale, "panels.ops.caseSets.done.saved", { name: updated.name }),
          data: {
            id: updated.id,
            name: updated.name,
            caseCount: updated.cases.length,
          },
          affected: {
            objectTypes: [AUTOTEST_CASE_SET],
            objects: [{ objectType: AUTOTEST_CASE_SET, primaryKey: updated.id }],
          },
        };
      } catch (error) {
        return refusalFromError(error, "SAVE_CASE_SET_REFUSED", tForLocale(host.locale, "panels.ops.caseSets.errors.saveFailed"));
      }
    },
  },
  {
    handlerRef: DELETE_AUTOTEST_CASE_SET,
    labelKey: "panels.ops.caseSets.actions.delete",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_AUTOTEST_CASE_SET },
    effect: "write",
    batch: false,
    targetType: AUTOTEST_CASE_SET,
    targetInput: "caseSet",
    targetSchema: caseSetTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetLabel: caseSetLabel,
    done: (host, name) => tForLocale(host.locale, "panels.ops.caseSets.done.deleted", { name }),
    inspectImpact: deleteCaseSetImpact,
    async execute(host: PanelOperationHost, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") {
        throw new Error("Delete acts on a selected test case set");
      }
      try {
        const { domainId, caseSet } = await requireOwnedCaseSet(
          host.executor.owner,
          host.executor.credentials,
          target.primaryKey,
        );
        const deleted = deleteCaseSet(caseSet.id, domainId);
        if (!deleted) {
          return {
            kind: "refusal",
            code: "NOT_FOUND",
            message: tForLocale(host.locale, "panels.ops.caseSets.errors.notFound"),
          };
        }
        return {
          kind: "success",
          data: {},
          affected: {
            objectTypes: [AUTOTEST_CASE_SET],
            objects: [{ objectType: AUTOTEST_CASE_SET, primaryKey: caseSet.id }],
            removed: [{ objectType: AUTOTEST_CASE_SET, primaryKey: caseSet.id }],
          },
        };
      } catch (error) {
        return refusalFromError(error, "DELETE_CASE_SET_REFUSED", tForLocale(host.locale, "panels.ops.errors.deleteFailed"));
      }
    },
  },
] as const satisfies readonly PanelServerOperation[];
