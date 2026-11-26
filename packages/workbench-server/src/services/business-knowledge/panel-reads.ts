import { z } from "zod";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { BUSINESS_KNOWLEDGE } from "@ontomato/contracts/panel-client-requests";
import {
  panelFormDescriptionSchema, panelReadParameterSchemas, type PanelFormDescription, type PanelRecord,
  type PanelTextHighlightRange,
} from "@ontomato/contracts/panel-projection";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { ownerEnvelopeSchema } from "../product-panels/data-query-operations";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { tForLocale } from "../../i18n";
import { knowledgeEntrySchema } from "./panel-operations";

/*
 * The business knowledge owner's named reads, called with the viewer's credentials: the queried list with the status
 * counts of its tabs, one entry, and the form. The owner keeps entries whole by domain; both routes select from the
 * same owner map. The list keeps the page it replaces: space-separated terms
 * matched case-insensitively somewhere in title, content or tags, entries whose title hits more terms first, then the
 * status filter returning one continuous matching list without cursor paging. Field labels and the two status names
 * come from the owner's form description in the reader's language — the one source the owner gives them in, not a
 * second one written here.
 */

type KnowledgeEntry = z.infer<typeof knowledgeEntrySchema>;
const searchableEntrySchema = knowledgeEntrySchema.pick({
  knowledgeTitle: true, knowledgeText: true, knowledgeTags: true, status: true,
});
type SearchableEntry = z.infer<typeof searchableEntrySchema>;
const entriesSchema = z.record(z.string(), knowledgeEntrySchema);
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
function entryMatches(entry: SearchableEntry, terms: readonly string[]): boolean {
  if (!terms.length) return true;
  const text = [entry.knowledgeTitle, entry.knowledgeText, ...(entry.knowledgeTags ?? [])].join("\n").toLowerCase();
  return terms.every(term => text.includes(term));
}

/** The entries the search keeps, title hits first: the page's own ranking over the owner's order. */
function searchedEntries<Entry extends SearchableEntry>(entries: Entry[], terms: readonly string[]): Entry[] {
  if (!terms.length) return entries;
  const hits = entries.filter(entry => entryMatches(entry, terms));
  const titleHits = (entry: SearchableEntry) => terms.filter(term => entry.knowledgeTitle.toLowerCase().includes(term)).length;
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

/**
 * The content as a list row shows it under the title, as the page it replaces did: raw text preserving newlines and
 * original characters, starting shortly before the first hit so the match stays inside the two lines a row shows.
 */
function contentSummary(text: string, terms: readonly string[]): string {
  const lower = text.toLowerCase();
  const first = Math.min(...terms.map(term => lower.indexOf(term)).filter(index => index >= 0));
  return Number.isFinite(first) && first > 24 ? `…${text.slice(first - 12)}` : text;
}

function rowHighlights(
  label: string, subtitle: string, fields: Record<string, string>, terms: readonly string[],
): PanelRecord["highlights"] {
  if (!terms.length) return undefined;
  const matched = [
    ["label", textHighlights(label, terms)],
    ["subtitle", textHighlights(subtitle, terms)],
    ["knowledgeText", textHighlights(fields.knowledgeText, terms)],
    ["knowledgeTags", textHighlights(fields.knowledgeTags, terms)],
  ].filter((entry): entry is [string, PanelTextHighlightRange[]] => entry[1] !== undefined);
  return matched.length ? Object.fromEntries(matched) : undefined;
}

/** The labels the owner's form gives: the field names and the two status names, in the reader's language. */
const statusLabelsSchema = z.object({ pendingName: z.string(), approvedName: z.string() });
const entryTextSchema = statusLabelsSchema.extend({
  fieldLabels: z.object({ knowledgeText: z.string(), knowledgeTags: z.string(), status: z.string() }),
});
type StatusLabels = z.infer<typeof statusLabelsSchema>;
type EntryText = StatusLabels & { fieldLabels: Record<string, string> };
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
  const subtitle = contentSummary(entry.knowledgeText, terms);
  const tags = entry.knowledgeTags ?? [];
  const fields = {
    knowledgeText: entry.knowledgeText,
    knowledgeTags: tags.join(", "),
    status: entry.status === 1 ? text.approvedName : text.pendingName,
  };
  const highlights = terms.length && entryMatches(entry, terms) ? rowHighlights(label, subtitle, fields, terms) : undefined;
  return {
    primaryKey: entry.knowledgeID,
    label,
    subtitle,
    fieldLabels: {
      knowledgeText: text.fieldLabels.knowledgeText,
      knowledgeTags: text.fieldLabels.knowledgeTags,
      status: text.fieldLabels.status,
    },
    fields,
    tones: { status: entry.status === 1 ? "success" : "warning" },
    tags: { knowledgeTags: tags },
    ...(highlights ? { highlights } : {}),
  };
}

const queryFactsSchema = z.object({ entries: entriesSchema, text: entryTextSchema });
const countsFactsSchema = z.object({ entries: z.array(searchableEntrySchema), labels: statusLabelsSchema });
const recordFactsSchema = z.object({ entry: knowledgeEntrySchema, text: entryTextSchema });

/** The owner returns the complete filtered list even when the declaration supplies cursor or size. */
function knowledgeQuery(entries: KnowledgeEntry[], text: EntryText, { search, status }: z.infer<typeof queryInputSchema>) {
  const terms = searchTerms(search);
  const kept = statusFiltered(searchedEntries(entries, terms), status ?? "all");
  return { rows: kept.map(entry => entryRow(entry, text, terms)), total: kept.length };
}

function knowledgeCounts(entries: SearchableEntry[], text: StatusLabels, search: string | undefined, locale?: string) {
  const kept = searchedEntries(entries, searchTerms(search));
  const pending = kept.filter(entry => entry.status !== 1).length;
  return [
    { key: "all", label: tForLocale(locale, "panels.knowledge.statusAll"), count: kept.length },
    { key: "pending", label: text.pendingName, count: pending },
    { key: "approved", label: text.approvedName, count: kept.length - pending },
  ];
}

function presentKnowledgeForm(payload: unknown): PanelFormDescription {
  // The owner's form description carries no errors; the panel form contract always has the list, empty here.
  return panelFormDescriptionSchema.parse({ ...runtimeJsonObjectSchema.parse(payload), errors: [] });
}

export function createBusinessKnowledgePanelReadPresenter(locale?: string) {
  return {
    query(payload: unknown, { primaryKey: _key, ...params }: Record<string, unknown>) {
      const { entries, text } = queryFactsSchema.parse(payload);
      return knowledgeQuery(Object.values(entries), text, queryInputSchema.parse(params));
    },
    counts(payload: unknown, { primaryKey: _key, ...params }: Record<string, unknown>) {
      const { entries, labels } = countsFactsSchema.parse(payload);
      return knowledgeCounts(entries, labels, countsInputSchema.parse(params).search, locale);
    },
    record(payload: unknown, { primaryKey: _key, ...params }: Record<string, unknown>) {
      const { entry, text } = recordFactsSchema.parse(payload);
      return entryRow(entry, text, searchTerms(recordInputSchema.parse(params).search));
    },
    form: presentKnowledgeForm,
    createForm: presentKnowledgeForm,
  };
}

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
    return Object.values(entriesSchema.parse(envelope.data));
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
    return presentKnowledgeForm(envelope.data);
  }

  /** The labels for the rows, read from the blank form so list, detail and form agree in one language. */
  async function ownerEntryText(): Promise<EntryText> {
    return entryTextOf(await ownerForm(undefined, {}));
  }

  return {
    async count() {
      const envelope = await ownerPost("knowledge-count", "/admin/getBussinessKnowledge", { countOnly: true });
      if (!envelope.success)
        throw new HttpError(422, envelope.message ?? "The owner refused the knowledge count", "KNOWLEDGE_READ_REFUSED");
      const { total } = z.object({ total: z.number().int().nonnegative() }).parse(envelope.data);
      return { rows: [], total };
    },
    /**
     * The searched and filtered entries as one complete matching list without cursor paging, with the matching total
     * (and when called without search or status, the domain's unfiltered total).
     */
    async query(params: Record<string, unknown>) {
      const query = queryInputSchema.parse(params);
      const [entries, text] = await Promise.all([ownerEntries(), ownerEntryText()]);
      return knowledgeQuery(entries, text, query);
    },
    /** The status counts over the searched entries, in tab order. */
    async counts(params: Record<string, unknown>) {
      const { search } = countsInputSchema.parse(params);
      const [entries, text] = await Promise.all([ownerEntries(), ownerEntryText()]);
      return knowledgeCounts(entries, text, search, viewer.locale);
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
  };
}
