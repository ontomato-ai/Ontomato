import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import ChartZoomModal from "../ChartZoomModal.vue";
import { workbenchI18n } from "../../../../i18n";

afterEach(() => {
  document.body.innerHTML = "";
});

// The card owns whether its zoom is open. The dialog closes by its own means (close button, mask, Escape) and tells the
// card, so the card's state follows and the next zoom opens the dialog again.
it("closes by the dialog's own means, tells the card, and opens again for the next zoom", async () => {
  const wrapper = mount(ChartZoomModal, {
    props: { title: "Revenue by region", mode: "table", tabular: { headers: ["region"], rows: [["East"]] } },
    // Element Plus reports a close as its closing transition starts, so the real transition runs.
    global: { plugins: [workbenchI18n(), ElementPlus], stubs: { transition: false } },
  });
  const dialog = () => document.querySelector<HTMLElement>(".chart-zoom-dialog");
  // The component is a JS <script setup>, so test-utils cannot infer its props type.
  await wrapper.setProps({ open: true } as never);
  await flushPromises();
  expect(dialog()?.querySelector(".el-dialog__title")?.textContent).toBe("Revenue by region");
  expect(dialog()?.textContent).toContain("East");

  dialog()!.querySelector<HTMLButtonElement>(".el-dialog__headerbtn")!.click();
  await flushPromises();
  expect(wrapper.emitted("close")).toHaveLength(1);

  await wrapper.setProps({ open: false } as never);
  await vi.waitFor(() => expect(dialog()).toBeNull());
  await wrapper.setProps({ open: true } as never);
  await flushPromises();
  expect(dialog()?.textContent).toContain("East");
  wrapper.unmount();
});
