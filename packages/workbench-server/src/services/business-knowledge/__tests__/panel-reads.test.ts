import { afterEach, expect, it, vi } from "vitest";
import { BUSINESS_KNOWLEDGE } from "@ontomato/contracts/panel-client-requests";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { createBusinessKnowledgeReadAdapter } from "../panel-reads";

/*
 * The business knowledge named reads: the queried list in the page's own search, filter and page semantics, the status
 * counts of its tabs, one entry from the whole-domain list, the owner's form forwarded as the panel form, the two write
 * descriptions, and the owner's refusals kept as errors. The rows carry the field labels and status names of the owner's
 * form description, so one language names everything.
 */

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));

const viewer = { token: "test-viewer", locale: "en" };

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { messages: en, ...enLocaleMeta } },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** One entry as the owner keeps it. */
type OwnerEntry = { knowledgeID: string; knowledgeTitle: string; knowledgeText: string; knowledgeTags: string[]; status: number };
/** The owner's whole-domain list, in the owner's own order. */
const entries: Record<string, OwnerEntry> = {
  "k-1": { knowledgeID: "k-1", knowledgeTitle: "Order rule", knowledgeText: "Orders need a customer", knowledgeTags: ["Business"], status: 1 },
  "k-2": { knowledgeID: "k-2", knowledgeTitle: "Return rule", knowledgeText: "Returns need the receipt", knowledgeTags: [], status: 0 },
  "k-3": { knowledgeID: "k-3", knowledgeTitle: "Ship notice", knowledgeText: "Shipments leave in the evening", knowledgeTags: ["Business", "Tech"], status: 0 },
  "k-4": { knowledgeID: "k-4", knowledgeTitle: "Rule of orders", knowledgeText: "Both rules apply", knowledgeTags: ["Tech"], status: 1 },
};
const tagOptions = ["General", "Business", "Tech"].map(value => ({
  value, label: value, description: null, disabled: false, disabledReason: null,
}));
/** The owner's form description, as BussinessKnowledgeForm describes it; the field labels come per request language. */
const ownerForm = (values: Record<string, unknown>, path: string, draftOperation: string) => ({
  values,
  fields: [
    { path: "/knowledgeTitle", label: "Knowledge title", control: { kind: "text", multiline: false, placeholder: null },
      valueSchema: { type: "string" }, required: true, readOnly: false, defaultValue: "" },
    { path: "/knowledgeText", label: "Knowledge content", control: { kind: "text", multiline: true, placeholder: null },
      valueSchema: { type: "string" }, required: true, readOnly: false, defaultValue: "" },
    { path: "/knowledgeTags", label: "Tags", control: { kind: "select", multiple: true, allowCreate: true, options: tagOptions },
      valueSchema: { type: "array", items: { type: "string" } }, required: false, readOnly: false, defaultValue: [] },
    { path: "/status", label: "Status", control: { kind: "select", options: [
      { value: 0, label: "Pending review", description: null, disabled: false, disabledReason: null },
      { value: 1, label: "Approved", description: null, disabled: false, disabledReason: null },
    ] }, valueSchema: { type: "integer", enum: [0, 1] }, required: true, readOnly: false, defaultValue: 1 },
    { path: "/knowledgeID", label: "Knowledge ID", control: { kind: "hidden" },
      valueSchema: { type: "string" }, required: false, readOnly: false, defaultValue: "" },
  ],
  save: {
    method: "POST", path, draftOperation,
    bodySchema: { type: "object", required: ["knowledgeTitle", "knowledgeText", "knowledgeTags", "status"], additionalProperties: false },
  },
});
const draftForm = ownerForm(
  { knowledgeID: "", knowledgeTitle: "", knowledgeText: "", knowledgeTags: [], status: 1 },
  "/admin/addBussinessKnowledge", "knowledge.create",
);
const entryForm = (entry: OwnerEntry) => ownerForm(
  { knowledgeID: entry.knowledgeID, knowledgeTitle: entry.knowledgeTitle, knowledgeText: entry.knowledgeText, knowledgeTags: entry.knowledgeTags, status: entry.status },
  "/admin/editBussinessKnowledge", "knowledge.update",
);

const row = (entry: OwnerEntry, status: string) => ({
  primaryKey: entry.knowledgeID,
  label: entry.knowledgeTitle,
  fieldLabels: { knowledgeText: "Knowledge content", knowledgeTags: "Tags", status: "Status" },
  fields: { knowledgeText: entry.knowledgeText, knowledgeTags: entry.knowledgeTags.join(", "), status },
});

/** The owner answering with the whole domain's list and its forms; every sent request is kept for the assertions. */
function ownerFetch() {
  const sent: { path: string; init: NonNullable<Parameters<typeof fetch>[1]> }[] = [];
  const fetchOwner = vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    expect(new Headers(init.headers).get("tk")).toBe(viewer.token);
    expect(new Headers(init.headers).get("Accept-Language")).toBe("en");
    const path = new URL(url).pathname;
    sent.push({ path, init });
    if (path.endsWith("/admin/getBussinessKnowledge")) return Response.json({ success: true, data: entries });
    const request = JSON.parse(String(init.body)) as { target: { kind: string; primaryKey?: string } };
    return Response.json({
      success: true, data: request.target.kind === "draft" ? draftForm : entryForm(entries[request.target.primaryKey!]),
    });
  });
  return { fetchOwner, sent };
}

it("queries the whole domain with the owner's labels and status names", async () => {
  const { fetchOwner, sent } = ownerFetch();
  vi.stubGlobal("fetch", fetchOwner);
  const reads = createBusinessKnowledgeReadAdapter(viewer);

  const page = await reads.query({});
  expect(page).toEqual({
    rows: [
      row(entries["k-1"], "Approved"),
      row(entries["k-2"], "Pending review"),
      row(entries["k-3"], "Pending review"),
      row(entries["k-4"], "Approved"),
    ],
    total: 4,
  });
  expect(panelReadResultSchemas.panelRecordList.parse(page.rows)).toEqual(page.rows);
  // The labels and status names come from the owner's blank form, not from a second source here.
  expect(sent.map(item => item.path)).toEqual(["/admin/getBussinessKnowledge", "/admin/bussinessKnowledge/form"]);
  expect(JSON.parse(String(sent[1]?.init.body))).toEqual({ target: { kind: "draft" }, changedField: null });
});

it("searches as the page did, ranks by title hits, filters and pages by cursor", async () => {
  vi.stubGlobal("fetch", ownerFetch().fetchOwner);
  const reads = createBusinessKnowledgeReadAdapter(viewer);

  // Every term must occur somewhere in title, content or tags, whatever its case; title hits rank first.
  expect(await reads.query({ search: "ORDERS rule" })).toMatchObject({
    rows: [row(entries["k-4"], "Approved"), row(entries["k-1"], "Approved")], total: 2,
  });
  expect(await reads.query({ search: "rule receipt" })).toMatchObject({ rows: [row(entries["k-2"], "Pending review")], total: 1 });
  expect(await reads.query({ search: "Business" })).toMatchObject({ total: 2 });

  // The status filter keeps the searched entries; the cursor pages them with the filtered total.
  expect(await reads.query({ search: "rule", filter: "approved" })).toMatchObject({
    rows: [row(entries["k-1"], "Approved"), row(entries["k-4"], "Approved")], total: 2,
  });
  expect(await reads.query({ search: "rule", filter: "pending" })).toMatchObject({ rows: [row(entries["k-2"], "Pending review")], total: 1 });
  expect(await reads.query({ filter: "approved", size: 1 })).toEqual({
    rows: [row(entries["k-1"], "Approved")], nextCursor: "1", total: 2,
  });
  expect(await reads.query({ filter: "approved", cursor: "1", size: 1 })).toEqual({
    rows: [row(entries["k-4"], "Approved")], total: 2,
  });
  expect(await reads.query({ search: "nothing matches this" })).toEqual({ rows: [], total: 0 });
});

it("counts the tabs on the searched entries", async () => {
  vi.stubGlobal("fetch", ownerFetch().fetchOwner);
  const reads = createBusinessKnowledgeReadAdapter(viewer);

  expect(await reads.counts({ by: "status" })).toEqual({ all: 4, pending: 2, approved: 2 });
  expect(await reads.counts({ by: "status", search: "rule" })).toEqual({ all: 3, pending: 1, approved: 2 });
});

it("reads one entry from the whole-domain list the owner keeps", async () => {
  vi.stubGlobal("fetch", ownerFetch().fetchOwner);
  const reads = createBusinessKnowledgeReadAdapter(viewer);

  expect(panelReadResultSchemas.panelRecord.parse(await reads.record("k-3"))).toEqual(row(entries["k-3"], "Pending review"));
  await expect(reads.record("k-none")).rejects.toMatchObject({
    status: 404, message: "Business knowledge k-none is not in this domain", code: "KNOWLEDGE_UNAVAILABLE",
  });
});

it("forwards the owner's form for a draft and for one entry's target", async () => {
  const { fetchOwner, sent } = ownerFetch();
  vi.stubGlobal("fetch", fetchOwner);
  const reads = createBusinessKnowledgeReadAdapter(viewer);

  const draft = panelReadResultSchemas.panelFormDescription.parse(await reads.form(undefined, {}));
  expect(draft.values).toEqual(draftForm.values);
  expect(draft.errors).toEqual([]);
  expect(draft.fields.map(field => field.path)).toEqual(["/knowledgeTitle", "/knowledgeText", "/knowledgeTags", "/status", "/knowledgeID"]);
  expect(draft.save).toEqual(draftForm.save);

  // The read route's values are a string record, as the read parameter contract takes them; the owner echoes them.
  const edited = await reads.form("k-2", { values: { knowledgeTitle: "Return policy", status: "1" }, changedField: "/status" });
  expect(panelReadResultSchemas.panelFormDescription.parse(edited)).toEqual(edited);
  expect(JSON.parse(String(sent[1]?.init.body))).toEqual({
    target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, changedField: "/status",
    values: { knowledgeTitle: "Return policy", status: "1" },
  });
});

it("describes the two writes without an owner request", async () => {
  const fetchOwner = vi.fn(async (url: string) => {
    throw new Error(`No owner request expected, got ${url}`);
  });
  vi.stubGlobal("fetch", fetchOwner);
  const reads = createBusinessKnowledgeReadAdapter(viewer);

  expect(panelReadResultSchemas.panelOperationDescriptor.parse(reads["knowledge.approve.describe"]())).toMatchObject({
    handlerRef: "knowledge.approve", label: "Approve", effect: "write",
    target: { source: "input", input: "knowledge" }, batch: true,
  });
  expect(panelReadResultSchemas.panelOperationDescriptor.parse(reads["knowledge.delete.describe"]())).toMatchObject({
    handlerRef: "knowledge.delete", label: "Delete", effect: "write",
    target: { source: "input", input: "knowledge" }, batch: true,
    inspectImpact: { handlerRef: "knowledge.delete.inspect-impact" },
  });
  expect(fetchOwner).not.toHaveBeenCalled();
});

it("keeps the owner's refusals as errors, whichever endpoint answers them", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).endsWith("/admin/bussinessKnowledge/form"))
      return Response.json({ success: false, message: "Business knowledge not found in the current domain" });
    return Response.json({ success: false, message: "This domain has no knowledge" });
  }));
  const reads = createBusinessKnowledgeReadAdapter(viewer);

  await expect(reads.query({})).rejects.toMatchObject({
    status: 422, message: "This domain has no knowledge", code: "KNOWLEDGE_READ_REFUSED",
  });
  await expect(reads.counts({ by: "status" })).rejects.toMatchObject({
    status: 422, message: "This domain has no knowledge", code: "KNOWLEDGE_READ_REFUSED",
  });
  await expect(reads.form("k-1", {})).rejects.toMatchObject({
    status: 422, message: "Business knowledge not found in the current domain", code: "KNOWLEDGE_READ_REFUSED",
  });

  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "Owner unavailable" }, { status: 503 })));
  await expect(reads.record("k-1")).rejects.toMatchObject({ status: 503, message: "Owner unavailable" });
});
