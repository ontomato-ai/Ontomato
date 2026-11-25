import { expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { applicationIconKeys, domainApplicationIconKeys } from "@ontomato/contracts/application-icons";
import ApplicationIconPicker from "../ApplicationIconPicker.vue";
import { hasAppIcon } from "../icons";

/*
 * All icons in the application icon catalogue are available to domain applications without reserving platform icons.
 */

it("offers all catalogue icons and displays the current icon in the heading", () => {
  const wrapper = mount(ApplicationIconPicker, { props: { modelValue: "ontology", heading: true } });
  const offered = wrapper.findAll(".icon-options button").map((button) => button.attributes("aria-label"));
  expect(offered).toEqual([...applicationIconKeys]);
  expect(offered).toEqual([...domainApplicationIconKeys]);
  expect(offered).toContain("ontology");
  expect(applicationIconKeys.every((key) => hasAppIcon(key))).toBe(true);
  // The application's current icon is drawn above the library, whichever it is.
  expect(wrapper.find(".icon-heading svg").exists()).toBe(true);
});
