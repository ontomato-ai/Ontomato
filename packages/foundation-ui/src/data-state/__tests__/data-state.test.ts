import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { DataState, type DataStateResult } from "../index";

const labels = {
  empty: "Nothing here",
  noMatch: "Nothing matches",
  clearFilters: "Clear filters",
  forbidden: "No permission",
  awaiting: "Choose one first",
  retry: "Read again",
};
const show = (result: DataStateResult<{ name: string }>, extraProps?: { emptyHint?: string }) =>
  mount(DataState, { props: { result, labels, ...extraProps }, slots: { default: "<b>{{ params.value.name }}</b>" } });

describe("DataState", () => {
  it("draws the value only once it is ready, and each other state in its own words", () => {
    expect(show({ status: "ready", value: { name: "Nightly" } }).find("b").text()).toBe("Nightly");
    expect(show({ status: "loading" }).attributes("aria-busy")).toBe("true");
    expect(show({ status: "empty" }).text()).toBe("Nothing here");
    expect(show({ status: "forbidden" }).text()).toBe("No permission");
    const error = show({ status: "error", message: "The task service did not answer" });
    expect(error.find('[role="alert"]').text()).toBe("The task service did not answer");
    expect(error.find("button").exists()).toBe(false);
    for (const result of [{ status: "loading" }, { status: "empty" }, { status: "forbidden" }] as const)
      expect(show(result).find("b").exists()).toBe(false);
  });

  it("offers to read a failed datum again when its state can", async () => {
    const retry = vi.fn();
    const error = show({ status: "error", message: "The data could not be read", retry });
    await error.find("button").trigger("click");
    expect(error.find("button").text()).toBe("Read again");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  // An empty answer is a quiet picture and one line, not a large illustration; a read the reader narrowed (a search, a
  // filter) says nothing matches, so the reader knows to widen it rather than that there is nothing at all.
  it("says an empty answer with a small quiet icon, and tells a narrowed read that found nothing from an empty one", () => {
    const empty = show({ status: "empty" });
    expect(empty.find('[data-state="empty"]').attributes("data-empty")).toBe("none");
    expect(empty.find("svg").attributes()).toMatchObject({ width: "40", height: "40", "aria-hidden": "true" });
    expect(empty.text()).toBe("Nothing here");
    const narrowed = show({ status: "empty", narrowed: true });
    expect(narrowed.find('[data-state="empty"]').attributes("data-empty")).toBe("no-match");
    expect(narrowed.find("svg").exists()).toBe(true);
    expect(narrowed.text()).toBe("Nothing matches");
  });

  it("asks for the missing selection instead of saying nothing was found", () => {
    const awaiting = show({ status: "awaiting" });
    expect(awaiting.text()).toBe("Choose one first");
    expect(awaiting.text()).not.toBe("Nothing here");
  });

  it("renders an optional emptyHint on un-narrowed empty states and omits it on narrowed no-match", () => {
    const fromResult = show({ status: "empty", emptyHint: "Use New in the header to create one" });
    expect(fromResult.find(".fui-data-state-message").text()).toBe("Nothing here");
    expect(fromResult.find(".fui-data-state-hint").text()).toBe("Use New in the header to create one");

    const fromProp = show({ status: "empty" }, { emptyHint: "Create a record from the header" });
    expect(fromProp.find(".fui-data-state-hint").text()).toBe("Create a record from the header");

    const narrowed = show({ status: "empty", narrowed: true }, { emptyHint: "Should not appear" });
    expect(narrowed.find(".fui-data-state-hint").exists()).toBe(false);
  });

  it("renders a Clear filters button on narrowed empty states when clearFilters is provided", async () => {
    const clearFilters = vi.fn();
    const narrowed = show({ status: "empty", narrowed: true, clearFilters });
    const button = narrowed.find(".fui-data-state-clear");
    expect(button.exists()).toBe(true);
    expect(button.text()).toBe("Clear filters");
    await button.trigger("click");
    expect(clearFilters).toHaveBeenCalledTimes(1);
  });

  it("shows the owner's forbidden reason when supplied and falls back to labels.forbidden otherwise", () => {
    const withReason = show({ status: "forbidden", reason: "Requires ontology maintainer role" });
    expect(withReason.find('[data-state="forbidden"]').exists()).toBe(true);
    expect(withReason.find("svg").exists()).toBe(true);
    expect(withReason.find(".fui-data-state-message").text()).toBe("Requires ontology maintainer role");

    const fallback = show({ status: "forbidden", reason: "   " });
    expect(fallback.find(".fui-data-state-message").text()).toBe("No permission");
  });
});
