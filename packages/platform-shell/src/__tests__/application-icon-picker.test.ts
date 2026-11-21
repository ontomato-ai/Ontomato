import { expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { applicationIconKeys, domainApplicationIconKeys } from "@ontomato/contracts/application-icons";
import ApplicationIconPicker from "../ApplicationIconPicker.vue";

/*
 * A domain application's icon is picked from the icons the contract leaves to domain applications (big main's ruling,
 * 2026-11-21): the built-in applications' own icons are not offered, so a domain application's rail row never looks like
 * one of theirs. One that already carries such an icon still shows it.
 */

it("offers only the domain applications' icons, and still shows a built-in one an application already carries", () => {
  const wrapper = mount(ApplicationIconPicker, { props: { modelValue: "ontology", heading: true } });
  const offered = wrapper.findAll(".icon-options button").map((button) => button.attributes("aria-label"));
  expect(offered).toEqual([...domainApplicationIconKeys]);
  const reserved = applicationIconKeys.filter((key) => !domainApplicationIconKeys.includes(key as never));
  expect(reserved).toContain("ontology");
  expect(offered.some((label) => reserved.includes(label as never))).toBe(false);
  // The application's current icon is drawn above the library, whichever it is.
  expect(wrapper.find(".icon-heading svg").exists()).toBe(true);
});
