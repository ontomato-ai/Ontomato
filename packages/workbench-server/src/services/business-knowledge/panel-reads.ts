import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import {
  APPROVE_KNOWLEDGE, BUSINESS_KNOWLEDGE, DELETE_KNOWLEDGE,
} from "@ontomato/contracts/panel-client-requests";
import { panelOwnerOperationDescriptorSchema } from "@ontomato/contracts/panel-operations";
import {
  panelFormDescriptionSchema, panelReadParameterSchemas, type PanelFormDescription, type PanelRecord,
  type PanelTextHighlightRange,
} from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { ownerEnvelopeSchema } from "../product-panels/data-query-operations";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { knowledgeEntrySchema, m7ServerOperations } from "./panel-operations";

/*
 * The business knowledge owner's named reads, called with the viewer's credentials: the queried list with the status
 * counts of its tabs, one entry, the form and the two write descriptions. The owner keeps entries whole by domain and
 * has no single read, so every entry read fetches the whole domain and selects here. The list keeps the page it
 * replaces: space-separated terms matched case-insensitively somewhere in title, content or tags, entries whose title
 * hits more terms first, then the status filter and cursor paging over the result. Field labels and the two status
 * names come from the owner's form description in the reader's language — the one source the owner gives them in, not
 * a second one written here.
 */

type KnowledgeEntry = z.infer<typeof knowledgeEntrySchema>;
type StatusFilter = z.infer<typeof panelReadParameterSchemas.knowledgeStatus>;

/** The list read's inputs, as the flattened list contract declares them. */
const queryInputSchema = z.object({
  search: z.string().optional(),
  status: panelReadParameterSchemas.knowledgeStatus.optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
  size: z.number().int().positive().optional(),
}).strict();
/** The counts read counts one dimension of the searched entries; this owner has only the status dimension. */
const countsInputSchema = z.object({
  by: z.literal("status"),
  search: z.string().optional(),
}).strict();
const recordInputSchema = z.object({
  search: z.string().optional(),
}).strict();

/** Space-separated search terms, lower-cased; an empty search matches every entry. */
const searchTerms = (search: string | undefined) => search?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];

/** Whether every search term appears case-insensitively in title, content or tags. */
function entryMatches(entry: KnowledgeEntry, terms: readonly string[]): boolean {
  if (!terms.length) return true;
  const text = [entry.knowledgeTitle, entry.knowledgeText, ...(entry.knowledgeTags ?? [])].join("\n").toLowerCase();
  return terms.every(term => text.includes(term));
}

/** The entries the search keeps, title hits first: the page's own ranking over the owner's order. */
function searchedEntries(entries: KnowledgeEntry[], terms: readonly string[]): KnowledgeEntry[] {
  if (!terms.length) return entries;
  const hits = entries.filter(entry => entryMatches(entry, terms));
  const titleHits = (entry: KnowledgeEntry) => terms.filter(term => entry.knowledgeTitle.toLowerCase().includes(term)).length;
  return hits.sort((a, b) => titleHits(b) - titleHits(a));
}

/** The status filter over the searched entries; the owner marks every entry not approved as pending. */
const statusFiltered = (entries: KnowledgeEntry[], filter: StatusFilter) =>
  filter === "all" ? entries : entries.filter(entry => (entry.status === 1) === (filter === "approved"));

/** Half-open UTF-16 ranges in displayed text where any search term occurs, merged when overlapping or adjacent. */
function textHighlights(text: string, terms: readonly string[]): PanelTextHighlightRange[] | undefined {
  if (!text || !terms.length) return undefined;
  const ranges: PanelTextHighlightRange[] = [];
  for (const term of terms) {
    const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    for (const match of text.matchAll(pattern)) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  if (!ranges.length) return undefined;
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: PanelTextHighlightRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push(range);
  }
  return merged;
}

function rowHighlights(label: string, fields: Record<string, string>, terms: readonly string[]): PanelRecord["highlights"] {
  if (!terms.length) return undefined;
  const matched = [
    ["label", textHighlights(label, terms)],
    ["knowledgeText", textHighlights(fields.knowledgeText, terms)],
    ["knowledgeTags", textHighlights(fields.knowledgeTags, terms)],
  ].filter((entry): entry is [string, PanelTextHighlightRange[]] => entry[1] !== undefined);
  return matched.length ? Object.fromEntries(matched) : undefined;
}

/** The labels the owner's form gives: the field names and the two status names, in the reader's language. */
interface EntryText {
  fieldLabels: Record<string, string>;
  pendingName: string;
  approvedName: string;
}
function entryTextOf(description: PanelFormDescription): EntryText {
  const fieldLabels = Object.fromEntries(description.fields.map(field => [field.path.slice(1), field.label]));
  const status = description.fields.find(field => field.path === "/status");
  if (!status || status.control.kind !== "select") throw new Error("The knowledge form's status field is not a selection");
  const options = status.control.options;
  const statusName = (value: number) => {
    const option = options.find(option => option.value === value);
    if (!option) throw new Error(`The knowledge form lists no status ${value}`);
    return option.label;
  };
  return { fieldLabels, pendingName: statusName(0), approvedName: statusName(1) };
}

/** One entry as the list and the detail read it, named and labelled in the reader's language. */
function entryRow(entry: KnowledgeEntry, text: EntryText, terms: readonly string[] = []): PanelRecord {
  const label = entry.knowledgeTitle;
  const fields = {
    knowledgeText: entry.knowledgeText,
    knowledgeTags: (entry.knowledgeTags ?? []).join(", "),
    status: entry.status === 1 ? text.approvedName : text.pendingName,
  };
  const highlights = terms.length && entryMatches(entry, terms) ? rowHighlights(label, fields, terms) : undefined;
  return {
    primaryKey: entry.knowledgeID,
    label,
    fieldLabels: {
      knowledgeText: text.fieldLabels.knowledgeText,
      knowledgeTags: text.fieldLabels.knowledgeTags,
      status: text.fieldLabels.status,
    },
    fields,
    ...(highlights ? { highlights } : {}),
  };
}

const knowledgeAction = (handlerRef: string) => {
  const operation = m7ServerOperations.find(item => item.handlerRef === handlerRef);
  if (operation?.kind !== "action") throw new Error(`The knowledge owner declares no action ${handlerRef}`);
  return operation;
};
const approveOperation = knowledgeAction(APPROVE_KNOWLEDGE);
const deleteOperation = knowledgeAction(DELETE_KNOWLEDGE);

/** The owner's description of one write, as the confirming reader and an agent both take it. */
const actionDescription = (operation: ReturnType<typeof knowledgeAction>) => ({
  handlerRef: operation.handlerRef,
  effect: operation.effect,
  target: { source: "input", input: operation.targetInput },
  inputSchema: zodToJsonSchema(operation.inputSchema, { effectStrategy: "input" }),
  resultSchema: zodToJsonSchema(operation.resultSchema, { effectStrategy: "input" }),
  batch: operation.batch,
  ...(operation.inspectImpact ? { inspectImpact: { handlerRef: operation.inspectImpact.handlerRef } } : {}),
});

export function createBusinessKnowledgeReadAdapter(viewer: AssistantCredentials, signal?: AbortSignal) {
  const options = {
    headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers),
    signal,
  };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");

  /** One owner request's envelope. */
  async function ownerPost(endpoint: string, path: string, body: unknown) {
    const response = await backendPost(endpoint, `${base}${path}`, body, options);
    return ownerEnvelopeSchema.parse(JSON.parse(response.text));
  }

  /** The whole domain's entries, in the owner's own order. */
  async function ownerEntries(): Promise<KnowledgeEntry[]> {
    const envelope = await ownerPost("knowledge-list", "/admin/getBussinessKnowledge", {});
    if (!envelope.success)
      throw new HttpError(422, envelope.message ?? "The owner refused the knowledge list", "KNOWLEDGE_READ_REFUSED");
    return Object.values(z.record(z.string(), knowledgeEntrySchema).parse(envelope.data));
  }

  /** The owner's form description for a target: a draft's blank form or one entry's, with submitted values and edits. */
  async function ownerForm(primaryKey: string | undefined, params: Record<string, unknown>): Promise<PanelFormDescription> {
    const values = panelReadParameterSchemas.panelFormValues.optional().parse(params.values);
    const changedField = panelReadParameterSchemas.changedField.optional().parse(params.changedField);
    const target = primaryKey === undefined
      ? { kind: "draft" }
      : { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey };
    const envelope = await ownerPost("knowledge-form", "/admin/bussinessKnowledge/form", {
      target, changedField: changedField ?? null, ...(values !== undefined ? { values } : {}),
    });
    if (!envelope.success)
      throw new HttpError(422, envelope.message ?? "The owner refused the form read", "KNOWLEDGE_READ_REFUSED");
    // The owner's form description carries no errors; the panel form contract always has the list, empty here.
    return panelFormDescriptionSchema.parse({ ...runtimeJsonObjectSchema.parse(envelope.data), errors: [] });
  }

  /** The labels for the rows, read from the blank form so list, detail and form agree in one language. */
  async function ownerEntryText(): Promise<EntryText> {
    return entryTextOf(await ownerForm(undefined, {}));
  }

  return {
    /** The searched and filtered entries, paged by cursor, with the total the filter keeps. */
    async query(params: Record<string, unknown>) {
      const { search, status, cursor, size } = queryInputSchema.parse(params);
      const [entries, text] = await Promise.all([ownerEntries(), ownerEntryText()]);
      const terms = searchTerms(search);
      const kept = statusFiltered(searchedEntries(entries, terms), status ?? "all");
      const offset = cursor === undefined ? 0 : Number(cursor);
      return {
        rows: kept.slice(offset, size === undefined ? undefined : offset + size).map(entry => entryRow(entry, text, terms)),
        ...(size !== undefined && offset + size < kept.length ? { nextCursor: String(offset + size) } : {}),
        total: kept.length,
      };
    },
    /** The status counts over the searched entries, in tab order. */
    async counts(params: Record<string, unknown>) {
      const { search } = countsInputSchema.parse(params);
      const [entries, text] = await Promise.all([ownerEntries(), ownerEntryText()]);
      const kept = searchedEntries(entries, searchTerms(search));
      const pending = kept.filter(entry => entry.status !== 1).length;
      return [
        { key: "all", label: tForLocale(viewer.locale, "panels.knowledge.statusAll"), count: kept.length },
        { key: "pending", label: text.pendingName, count: pending },
        { key: "approved", label: text.approvedName, count: kept.length - pending },
      ];
    },
    /** One entry, read from the whole-domain list the owner keeps, with highlights when search matches it. */
    async record(primaryKey: string, params: Record<string, unknown> = {}) {
      const { search } = recordInputSchema.parse(params);
      const found = (await ownerEntries()).find(entry => entry.knowledgeID === primaryKey);
      if (!found) throw new HttpError(404, `Business knowledge ${primaryKey} is not in this domain`, "KNOWLEDGE_UNAVAILABLE");
      return entryRow(found, await ownerEntryText(), searchTerms(search));
    },
    /** The form for a target: a draft's blank one, or one entry's with submitted values and a changed field. */
    async form(primaryKey: string | undefined, params: Record<string, unknown>) {
      return ownerForm(primaryKey, params);
    },
    /** The approve write's description, as a panel's button and an agent's call both take it. */
    ["knowledge.approve.describe"]() {
      return panelOwnerOperationDescriptorSchema.parse({
        ...actionDescription(approveOperation), label: tForLocale(viewer.locale, "panels.knowledge.approve"),
      });
    },
    /** The delete write's description, with the impact a confirmation reads. */
    ["knowledge.delete.describe"]() {
      return panelOwnerOperationDescriptorSchema.parse({
        ...actionDescription(deleteOperation), label: tForLocale(viewer.locale, "panels.knowledge.delete"),
      });
    },
  };
}
