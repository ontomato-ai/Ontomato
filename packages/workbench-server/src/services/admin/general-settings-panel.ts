import { presentedRegisteredDataRead, type RegisteredDataReadContext, type RegisteredDataReadRegistration } from "../product-panels/registered-data-read";
import { z } from "zod";
import { generalConfigSaveEndpoints, type GeneralConfigKey } from "@ontomato/contracts/general-settings";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import { GENERAL_SETTINGS } from "@ontomato/contracts/platform-object-types";
import { panelFormSaveInputSchema, type PanelFormDescription, type PanelFormField, type PanelFormRequest, type PanelRecord } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { requireFormFieldNames } from "../../utils/form-field-names";
import { cachedZodToRuntimeJsonSchema } from "../../utils/zod-json-schema";
import { affected, ownerEnvelopeSchema, ownerPost, ownerWriteFailure, type DataQueryOperationHost } from "../product-panels/data-query-operations";
import { operationHost } from "../product-panels/operation-host";
import type { PanelOperationActor, PanelServerOperation, SinglePanelOperationOutcome } from "../product-panels/server-operations";

const key = "general";
const operation = `${GENERAL_SETTINGS}.save`;
export const generalSettingsSavePath = "/system-config/general";
const valuesSchema = z.object({
  knowledgeMaxResult: z.number().int().min(1).max(2147483647),
  dslCookerTimeoutSeconds: z.number().int().min(1).max(Math.floor(Number.MAX_SAFE_INTEGER / 1000)),
  lang: z.string().min(1),
}).strict();
export const generalSettingsPatch = valuesSchema.partial();
const inputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict().extend({ values: generalSettingsPatch });
const fields = valuesSchema.keyof().options;
const caption = z.object({ label: z.string().min(1), help: z.string().min(1) });
const settingsSchema = z.object({
  knowledgeMaxResult: z.number(),
  dslCookerTimeout: z.number().nullish(),
  lang: z.string().nullish(),
  languages: z.array(z.string()).nonempty(),
  fields: z.object({ knowledgeMaxResult: caption, dslCookerTimeoutSeconds: caption, lang: caption }),
});
const languageNames: Record<string, string> = {
  "zh-CN": "简体中文", "zh-TW": "繁體中文", en: "English", ja: "日本語", fr: "Français", it: "Italiano", de: "Deutsch", ar: "العربية",
};

function generalSettingsFacts(payload: unknown) {
  const data = settingsSchema.parse(payload);
  const options = Object.keys(languageNames).filter(lang => data.languages.includes(lang));
  const values = {
    knowledgeMaxResult: Math.max(1, data.knowledgeMaxResult),
    dslCookerTimeoutSeconds: Math.max(1, Math.round((data.dslCookerTimeout ?? 300000) / 1000)),
    lang: data.lang && options.includes(data.lang) ? data.lang : options[0]!,
  };
  return { values, options, captions: data.fields };
}

async function readSettings(host: DataQueryOperationHost) {
  const response = await host.request(`${DATA_QUERY_GATEWAY}/businessConfig/generalForm`, { method: "GET" });
  if (!response.ok) throw new HttpError(response.status, "Unable to read general settings", "GENERAL_SETTINGS_UNAVAILABLE");
  return generalSettingsFacts(await response.json());
}

function requireGeneralKey(primaryKey: string) {
  if (primaryKey !== key) throw new HttpError(404, "General settings not found", "NOT_FOUND");
}

type GeneralSettingsFacts = ReturnType<typeof generalSettingsFacts>;
type GeneralSettingsFormInputs = Pick<PanelFormRequest, "values">;

function generalSettingsPresentation(locale?: string) {
  function record(primaryKey: string, { values, captions }: GeneralSettingsFacts): PanelRecord {
    return {
      primaryKey, label: tForLocale(locale, "panels.simplePages.general"),
      fields: {
        knowledgeMaxResult: String(values.knowledgeMaxResult),
        dslCookerTimeoutSeconds: String(values.dslCookerTimeoutSeconds),
        lang: languageNames[values.lang]!,
      },
      fieldLabels: Object.fromEntries(fields.map(field => [field, captions[field].label])),
    };
  }
  return {
    record,
    form({ values: stored, options, captions }: GeneralSettingsFacts, inputs: GeneralSettingsFormInputs): PanelFormDescription {
      const values = { ...stored, ...inputs.values };
      const schema = valuesSchema.extend({ lang: z.enum([options[0]!, ...options.slice(1)]) });
      const parsed = schema.safeParse(values);
      return {
        values,
        errors: parsed.success ? [] : parsed.error.issues.map(issue => ({
          field: `/${issue.path[0] ?? "lang"}`, code: issue.path[0] === "lang" ? "invalid_option" : "invalid_number",
          message: tForLocale(locale, "panels.simplePages.invalidGeneral"),
        })),
        fields: fields.map((name): PanelFormField => ({
          path: `/${name}`, ...captions[name], valueSchema: cachedZodToRuntimeJsonSchema(schema.shape[name]),
          required: true, readOnly: false,
          control: name === "lang" ? {
            kind: "select",
            options: options.map(value => ({ value, label: languageNames[value]!, description: null, disabled: false, disabledReason: null })),
          } : {
            kind: "number",
            min: 1,
            step: name === "dslCookerTimeoutSeconds" ? 10 : 1,
            presentation: "stepper",
          },
        })),
        save: { method: "POST", path: "/api" + generalSettingsSavePath, bodySchema: cachedZodToRuntimeJsonSchema(generalSettingsPatch) },
      };
    },
  };
}

export function createGeneralSettingsPanelReadPresenter(locale?: string) {
  const presentation = generalSettingsPresentation(locale);
  return {
    list: (payload: unknown) => [presentation.record(key, generalSettingsFacts(payload))],
    record: (payload: unknown, { primaryKey }: { primaryKey: string }) =>
      presentation.record(primaryKey, generalSettingsFacts(payload)),
    form: (payload: unknown, inputs: GeneralSettingsFormInputs) =>
      presentation.form(generalSettingsFacts(payload), inputs),
  };
}

export function createGeneralSettingsReads(actor: PanelOperationActor) {
  const host = operationHost(actor);
  const presentation = generalSettingsPresentation(actor.credentials.locale);
  async function record(primaryKey: string): Promise<PanelRecord> {
    requireGeneralKey(primaryKey);
    return presentation.record(primaryKey, await readSettings(host));
  }
  return {
    list: async () => [await record(key)],
    record,
    async form(primaryKey: string, inputs: GeneralSettingsFormInputs): Promise<PanelFormDescription> {
      requireGeneralKey(primaryKey);
      return presentation.form(await readSettings(host), inputs);
    },
  };
}

function submittedValues(input: unknown) {
  const { values, submittedFields } = inputSchema.parse(input);
  if (submittedFields === undefined) return values;
  return generalSettingsPatch.parse(Object.fromEntries(
    fields.filter(field => submittedFields.includes(`/${field}`)).map(field => [field, values[field]]),
  ));
}

export async function saveGeneralSettings(
  host: DataQueryOperationHost, actor: PanelOperationActor, changes: z.infer<typeof generalSettingsPatch>,
): Promise<SinglePanelOperationOutcome> {
  const { values: current, options, captions } = await readSettings(host);
  if (changes.lang !== undefined && !options.includes(changes.lang)) {
    const message = tForLocale(actor.credentials.locale, "panels.simplePages.invalidGeneral");
    return { kind: "refusal", code: "INVALID_GENERAL_SETTING", message, errors: [{ field: "/lang", code: "invalid_option", message }] };
  }
  const savedFields: Record<string, string | number> = {};
  const settingsAffected = affected(GENERAL_SETTINGS, key, [GENERAL_SETTINGS]);
  type Rejected = Extract<SinglePanelOperationOutcome, { kind: "refusal" | "failure" }>;
  function failed(field: typeof fields[number], outcome: Rejected): Rejected {
    const message = `${captions[field].label} — ${outcome.message}`;
    return {
      ...outcome, message,
      errors: [{ field: `/${field}`, code: "target_unavailable", message }],
      ...(Object.keys(savedFields).length > 0 && { savedFields, affected: settingsAffected }),
    };
  }
  for (const field of fields) {
    const value = changes[field];
    if (value === undefined || value === current[field]) continue;
    const javaField: GeneralConfigKey = field === "dslCookerTimeoutSeconds" ? "dslCookerTimeout" : field;
    const body = { [javaField]: field === "dslCookerTimeoutSeconds" ? changes.dslCookerTimeoutSeconds! * 1000 : value };
    try {
      const result = await ownerPost(host, generalConfigSaveEndpoints[javaField], body, ownerEnvelopeSchema);
      if (!result.success) return failed(field, ownerWriteFailure(result, "GENERAL_SETTINGS_SAVE_FAILED", "Unable to save general settings"));
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403))
        return failed(field, { kind: "refusal", code: "FORBIDDEN", message: error.message });
      if (Object.keys(savedFields).length === 0) throw error;
      return failed(field, { kind: "failure", code: "GENERAL_SETTINGS_SAVE_UNCERTAIN", message: error instanceof Error ? error.message : String(error) });
    }
    savedFields[`/${field}`] = value;
  }
  return { kind: "success", data: { ...current, ...changes }, affected: settingsAffected };
}

export const generalSettingsOperations = [{
  handlerRef: operation, labelKey: "panels.simplePages.saveGeneral",
  kind: "form.save", effect: "write", batch: false,
  binding: { kind: "PlatformObjectType", id: GENERAL_SETTINGS }, targetType: GENERAL_SETTINGS,
  targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(GENERAL_SETTINGS), primaryKey: z.literal(key) }).strict(),
  inputSchema, resultSchema: valuesSchema,
  draftInput: submittedValues,

  execute: (host, _target, input) => saveGeneralSettings(host, host.executor, submittedValues(input)),
}] satisfies readonly PanelServerOperation[];

const validateGeneralSettingsForm = ({ params }: RegisteredDataReadContext) => {
  requireFormFieldNames(params.values, "values");
};

export const generalSettingsDataReadRegistrations: RegisteredDataReadRegistration[] = [
  presentedRegisteredDataRead(GENERAL_SETTINGS, "list", createGeneralSettingsPanelReadPresenter),
  presentedRegisteredDataRead(GENERAL_SETTINGS, "record", createGeneralSettingsPanelReadPresenter),
  presentedRegisteredDataRead(GENERAL_SETTINGS, "form", createGeneralSettingsPanelReadPresenter, validateGeneralSettingsForm),
];
