import { afterEach, describe, expect, it, vi } from "vitest";
import { createPanelBackController } from "../panel-back";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("createPanelBackController Escape scope", () => {
  it("ignores Escape focused outside the host and still handles Escape inside the host or on document.body", () => {
    const scope = document.createElement("section");
    const inside = document.createElement("input");
    scope.append(inside);
    const outside = document.createElement("textarea");
    document.body.append(scope, outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    const onBack = vi.fn();
    const controller = createPanelBackController({
      active: () => true,
      allowHistory: () => false,
      isDirty: () => false,
      confirmLeaveUnsaved: async () => true,
      scopeElement: () => scope,
    });
    try {
      controller.register({ onBack });
      outside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(onBack).not.toHaveBeenCalled();

      inside.focus();
      inside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(onBack).toHaveBeenCalledTimes(1);

      controller.register({ onBack });
      inside.blur();
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(onBack).toHaveBeenCalledTimes(2);
    } finally {
      controller.dispose();
    }
  });
});
