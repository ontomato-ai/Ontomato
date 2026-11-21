import { afterEach, expect, it, vi } from "vitest";
import { createApp, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { FUNCTION } from "@ontomato/contracts/platform-object-types";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { directRun, noOperations } from "./panel-frame";

/*
 * A field whose owner answers the form again as it changes (`refreshOnChange`: an entry's permission code, whose choices
 * elsewhere in the form follow it; A-Java, 2026-11-22). The reader types on while the owner is still answering: an answer
 * is for the values it was asked with, so it never puts back an older value over what the reader typed since, and the
 * owner is asked once more for the latest values rather than once per keystroke.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const projection: DirectProjection = {
  ...record, id: "entry-form", name: "Entry", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { entry: { kind: "object", objectType: FUNCTION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
  outputs: {}, config: {},
  data: { form: { source: { object: { input: "entry" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "entry" } } },
};
const manifest: DirectPanelManifest = {
  state: { entry: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false } },
  members: { form: { target: { projectionId: projection.id }, inputs: { entry: { state: "entry" } } } },
  commands: {},
};
const fields = [
  { path: "/code", label: "Code", required: false, readOnly: false, valueSchema: {}, control: { kind: "text" }, refreshOnChange: true },
  { path: "/hint", label: "Hint", required: false, readOnly: false, valueSchema: {}, control: { kind: "text" } },
];
const save = { kind: "form.save", handlerRef: `${FUNCTION}.save`, label: "Save", effect: "write", target: { source: "input", input: "entry" }, inputSchema: {}, resultSchema: {}, batch: false };

afterEach(() => {
  document.body.innerHTML = "";
});

it("keeps what the reader typed after asking the owner, and asks once more for the latest values", async () => {
  const asked: string[] = [];
  const answers: (() => void)[] = [];
  const mount = mountDirectPanel({
    manifest,
    run: directRun({ pageKey: "entries", url: () => "/entries", label: () => "Entries", initial: { entry: { className: FUNCTION, primaryKey: "e-1" } } }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection }) },
    use: { applicationId: "app", useId: "entries" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => {
      if (request.operations) return { status: "ready", value: { save } as never };
      const given = request.inputs.values as Record<string, string> | undefined;
      const values = given ?? { code: "", hint: "" };
      const answer = { status: "ready" as const, value: { fields, values: { ...values, hint: `for ${values.code}` }, errors: [], revision: 1,
        save: { method: "PUT", path: "/entries/:id", bodySchema: {}, draftOperation: "entry.update" } } as never };
      if (!given) return answer;
      asked.push(given.code!);
      // The owner answers each change only when the test lets it.
      return new Promise((resolve) => answers.push(() => resolve(answer)));
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => mount.member("form") });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  await vi.waitFor(() => expect(mount.instance.forms.handle("form")).toBeDefined());
  const handle = mount.instance.forms.handle("form")!;
  await vi.waitFor(() => expect(handle.fields.value).toHaveLength(2));

  handle.set("/code", "A");
  handle.set("/code", "AB");
  handle.set("/code", "ABC");
  // One question at a time: the first change is asked about, the rest wait for its answer.
  await vi.waitFor(() => expect(asked).toEqual(["A"]));
  answers.shift()!();
  // The answer for "A" does not put "A" back over "ABC", and the owner is asked once more, for "ABC".
  await vi.waitFor(() => expect(asked).toEqual(["A", "ABC"]));
  expect(handle.values.value.code).toBe("ABC");
  answers.shift()!();
  await vi.waitFor(() => expect(handle.values.value.hint).toBe("for ABC"));
  expect(handle.values.value.code).toBe("ABC");
  app.unmount();
  mount.dispose();
});
