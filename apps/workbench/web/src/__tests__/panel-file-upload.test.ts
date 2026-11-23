import { afterEach, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { IMPORT_SKILL, SKILL } from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelHumanOperationPreparation, PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import type { PanelUploadReceipt } from "@ontomato/contracts/panel-upload";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * A file an operation takes (U11), from the panel's upload control: the control checks the picked file against the
 * owner's declared kinds and size, stages it once, and writes with the staged file as the declared input. When the owner
 * says the skill exists, the control sends that same staged file again with `overwrite`, whose preparation is the one
 * the host confirms, naming the file.
 *
 * The mistakes these catch: a file staged twice or posted to the owner's own route; an overwrite asked about twice, or
 * not asked about; a wrong file sent before the reader is told.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const importer: ProductProjection = {
  ...record, id: "skill-import", name: "Import", componentId: "@ontomato/sdk:FileUploadControl", inputs: {}, outputs: {},
  config: { operation: "import", overwriteOn: "SKILL_EXISTS" },
  data: {},
  operations: { import: { operation: { kind: "PlatformOperation", id: IMPORT_SKILL } } },
};
const manifest = definePanel({ state: {}, members: { importer: { target: { projectionId: importer.id }, inputs: {} } } });
const importSkill = {
  kind: "action", handlerRef: IMPORT_SKILL, label: "Import", effect: "write", target: { source: "none" }, inputSchema: {}, resultSchema: {},
  batch: false, inspectImpact: { handlerRef: `${IMPORT_SKILL}.inspect-impact` },
  upload: { input: "file", accept: [{ mime: "application/zip", extension: ".zip" }], maxBytes: 20 * 1024 * 1024 },
};
const uploadId = "6d1b8a0e-3c2f-4a51-9e07-2b8c4d1f0a93";
const staged = (file: File): PanelUploadReceipt => ({ uploadId, name: file.name, size: file.size, mime: "application/zip" });
const imported: PanelOperationOutcome = {
  kind: "success", message: "Imported skill alpha.", data: { id: "alpha", title: "alpha" },
  affected: { objects: [{ objectType: SKILL, primaryKey: "alpha" }], objectTypes: [SKILL] },
};

/** Mounts the control; with `exists`, the owner refuses the first import of the name. */
function open(exists: boolean) {
  const uploads: File[] = [];
  const prepared: unknown[] = [];
  const preparations: PanelHumanOperationPreparation[] = [];
  const instance = createDirectPanelInstance(manifest, {
    readComponentPackage: noOperations.readComponentPackage,
    pageKey: "skills", url: () => "/skills", label: () => "Skills",
    initial: {},
    text: createPanelText({}, { value: "en" } as never, "en"),
    operations: {
      ...noOperations.operations,
      upload: async (_operationId, file) => {
        uploads.push(file);
        return staged(file);
      },
      prepare: async (operationId, invocation) => {
        prepared.push([operationId, invocation]);
        const overwrite = "call" in invocation && invocation.call.input.overwrite === true;
        // The owner inspects only an overwrite: the platform then names the staged file beside what it replaces.
        const preparation: PanelHumanOperationPreparation = {
          intentId: `5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${preparations.length}`, operationId, label: "Import",
          confirmation: overwrite
            ? { kind: "impact", upload: { name: "alpha.zip", size: 2048, mime: "application/zip" }, impact: {
              summary: "This replaces the existing skill alpha with the uploaded package.", total: 1,
              objects: [{ target: { objectType: SKILL, primaryKey: "alpha" }, label: "alpha" }],
            } }
            : { kind: "none" },
        };
        preparations.push(preparation);
        return preparation;
      },
    },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: async ({ intentId, confirmation }) => ({ decision: "confirm", response: { kind: "dispatched", intentId,
      outcome: exists && confirmation.kind === "none"
        ? { kind: "refusal", code: "SKILL_EXISTS", message: "A skill named alpha already exists.", details: { skillId: "alpha" } }
        : imported } }),
    recordDraftCreated: async () => {},
    readProjection: async () => importer,
    read: async (request) => ({ status: "ready", value: (request.operations ? { import: importSkill } : null) as never }),
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => h(PanelMember, { instance, member: "importer" }) });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { element, uploads, prepared, preparations, unmount: () => app.unmount() };
}

/** Picks a file, as the reader does in the browser's picker. */
async function pick(element: HTMLElement, file: File) {
  await vi.waitFor(() => {
    if (element.querySelector<HTMLButtonElement>(".sdk-file-upload-trigger")?.disabled !== false) throw new Error("Not ready");
  });
  const input = element.querySelector<HTMLInputElement>("input[type=file]")!;
  expect(input.accept).toBe(".zip");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
}
const zip = () => new File([new Uint8Array(2048)], "alpha.zip", { type: "application/zip" });
const call = (input: Record<string, unknown>) => ["importer.import", { call: { target: null, input } }];

afterEach(() => {
  document.body.innerHTML = "";
});

it("stages the picked file once and writes with it as the declared input, with nothing to confirm for a new skill", async () => {
  const { element, uploads, prepared, preparations, unmount } = open(false);
  await pick(element, zip());
  await vi.waitFor(() => expect(element.querySelector(".sdk-file-upload-done")?.textContent).toContain("Imported skill alpha."));
  expect(element.querySelector(".sdk-file-upload-done")!.textContent).toContain("alpha.zip (2 kB)");
  expect(uploads.map((file) => file.name)).toEqual(["alpha.zip"]);
  expect(prepared).toEqual([call({ file: { kind: "upload", uploadId } })]);
  expect(preparations.map(({ confirmation }) => confirmation.kind)).toEqual(["none"]);
  unmount();
});

it("sends the same staged file again with overwrite when the skill exists, and only that write is confirmed", async () => {
  const { element, uploads, prepared, preparations, unmount } = open(true);
  await pick(element, zip());
  await vi.waitFor(() => expect(element.querySelector(".sdk-file-upload-done")?.textContent).toContain("Imported skill alpha."));
  expect(uploads).toHaveLength(1);
  expect(prepared).toEqual([call({ file: { kind: "upload", uploadId } }), call({ file: { kind: "upload", uploadId }, overwrite: true })]);
  // The host asks only where a preparation is to be confirmed: once, naming the file and the skill it replaces.
  expect(preparations.map(({ confirmation }) => confirmation.kind)).toEqual(["none", "impact"]);
  unmount();
});

it("names a file of the wrong kind or size at once and sends nothing", async () => {
  const { element, uploads, prepared, unmount } = open(false);
  await pick(element, new File(["notes"], "notes.txt", { type: "text/plain" }));
  await vi.waitFor(() => expect(element.querySelector(".sdk-file-upload-error")?.textContent).toBe("Only .zip files are supported"));
  const large = new File(["x"], "large.zip");
  Object.defineProperty(large, "size", { value: 20 * 1024 * 1024 + 1 });
  await pick(element, large);
  await vi.waitFor(() => expect(element.querySelector(".sdk-file-upload-error")?.textContent).toBe("The file must be at most 20 MB"));
  expect(uploads).toEqual([]);
  expect(prepared).toEqual([]);
  unmount();
});
