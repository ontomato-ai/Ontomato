import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";
import FormFieldControl from "../../../../../packages/apps-sdk/src/base/FormFieldControl.vue";
import { formControlsKey, type FormControls } from "../../../../../packages/apps-sdk/src/base/form-controls";

/*
 * A code field whose editor cannot be loaded (2026-11-25): the field shows the owner's source as read-only text and says
 * it cannot be edited here, instead of drawing nothing. An empty drawing reads as "the owner has no value", which is how
 * the metric page's query package and column labels looked when their editor was not drawn.
 *
 * The mistakes these catch: a control loaded on demand that draws nothing before it loads or after it fails, so a reader
 * cannot tell a missing editor from a missing value.
 */

vi.mock("@ontomato/foundation-ui/code", () => {
  throw new Error("The code editor did not load");
});

const field: PanelFormField = {
  path: "/function/queryPackage",
  label: "Query package",
  valueSchema: { type: "object" },
  required: true,
  readOnly: false,
  control: { kind: "code", language: "json" },
};
const held = { manifest: { schema: "ontomato.query-package.v1", entry: { kind: "dsl", query: "org_total" } } };

function controls(): FormControls {
  const values = ref({ function: { queryPackage: held } });
  return {
    formSlot: "definition",
    values,
    prunedValues: values,
    errors: ref({}),
    changed: ref(new Set<string>()),
    busy: ref(false),
    layout: ref("stacked"),
    hasDefaults: ref(false),
    sharedReadOnlyReasons: ref(new Set<string>()),
    isTopLevel: () => true,
    hasInvalid: () => false,
    invalidText: () => undefined,
    set: () => {},
    remove: () => {},
    reorder: () => {},
    invalid: () => {},
    resolveFieldSlot: () => undefined,
  } as unknown as FormControls;
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("shows an owner's source instead of a blank field when its editor cannot be loaded", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  const form = controls();
  createApp({
    setup: () => () => h(FormFieldControl, { field, path: field.path, disabled: false }),
  })
    .provide(formControlsKey, form)
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } }))
    .use(ElementPlus)
    .mount(element);
  const drawn = await vi.waitFor(() => {
    const found = element.querySelector<HTMLElement>('[data-field="/function/queryPackage"]');
    if (!found) throw new Error("The field is not drawn");
    return found;
  });
  await vi.waitFor(() => expect(drawn.querySelector("[data-code-source]")?.textContent).toContain("ontomato.query-package.v1"));
  await vi.waitFor(() => expect(drawn.textContent).toContain(publicEn.platform.formControlUnavailable));
  expect(drawn.querySelector(".cm-editor")).toBeNull();
});
