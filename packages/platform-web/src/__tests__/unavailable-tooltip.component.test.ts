import { mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import UnavailableTooltip from "../../../apps-sdk/src/base/UnavailableTooltip.vue";

it("sizes the teleported unavailable hint from its text", async () => {
  const reason = "This organization has child organizations and cannot be deleted.";
  const wrapper = mount(UnavailableTooltip, {
    attachTo: document.body,
    props: { reason },
    slots: { default: '<button disabled>Delete</button>' },
  });
  try {
    await wrapper.get("[tabindex='0']").trigger("focus");
    await vi.waitFor(() => {
      const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
      expect(tooltip?.textContent).toContain(reason);
      expect(tooltip?.style.width).toBe("max-content");
    });
  } finally {
    wrapper.unmount();
  }
});
