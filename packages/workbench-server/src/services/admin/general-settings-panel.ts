import { z } from "zod";
import { generalConfigSaveEndpoints, type GeneralConfigKey } from "@ontomato/contracts/general-settings";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import { GENERAL_SETTINGS } from "@ontomato/contracts/platform-object-types";
import { panelFormSaveInputSchema, type PanelFormDescription, type PanelFormField, type PanelFormRequest, type PanelRecord } from "@ontomato/contracts/panel-projection";
import { assertPermission } from "../../identity/installed";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
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

async function readSettings(host: DataQueryOperationHost, credentials: AssistantCredentials) {
  await assertPermission(credentials, ["system-config"]);
  const response = await host.request(`${DATA_QUERY_GATEWAY}/businessConfig/generalForm`, { method: "GET" });
  if (!response.ok) throw new HttpError(response.status, "Unable to read general settings", "GENERAL_SETTINGS_UNAVAILABLE");
  const data = settingsSchema.parse(await response.json());
  const options = Object.keys(languageNames).filter(lang => data.languages.includes(lang));
  const values = {
    knowledgeMaxResult: Math.max(1, data.knowledgeMaxResult),
    dslCookerTimeoutSeconds: Math.max(1, Math.round((data.dslCookerTimeout ?? 300000) / 1000)),
    lang: data.lang && options.includes(data.lang) ? data.lang : options[0]!,
  };
  return { values, options, captions: data.fields };
}

function requireGeneralKey(primaryKey: string) {
  if (primaryKey !== key) throw new HttpError(404, "General settings not found", "NOT_FOUND");
}

export function createGeneralSettingsReads(actor: PanelOperationActor) {
  const host = operationHost(actor);
  const locale = actor.credentials.locale;
  const read = () => readSettings(host, actor.credentials);
  async function record(primaryKey: string): Promise<PanelRecord> {
    requireGeneralKey(primaryKey);
    const { values, captions } = await read();
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
    list: async () => [await record(key)],
    record,
    async form(primaryKey: string, inputs: Pick<PanelFormRequest, "values">): Promise<PanelFormDescription> {
      requireGeneralKey(primaryKey);
      const { values: stored, options, captions } = await read();
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
          } : { kind: "number" },
        })),
        save: { method: "POST", path: "/api" + generalSettingsSavePath, bodySchema: cachedZodToRuntimeJsonSchema(generalSettingsPatch), draftOperation: operation },
      };
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
  const { values: current, options, captions } = await readSettings(host, actor.credentials);
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
  draftOperation: () => operation, draftInput: submittedValues,
  formInstructions: "Submit the changed general settings. Enter the DSL timeout in whole seconds and choose a language from this edition's form.",
  execute: (host, _target, input) => saveGeneralSettings(host, host.executor, submittedValues(input)),
}] satisfies readonly PanelServerOperation[];
