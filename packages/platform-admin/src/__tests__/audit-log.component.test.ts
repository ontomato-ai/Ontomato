import { flushPromises, mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import AuditLogPage from "../pages/AuditLogPage.vue";
import { pageGlobal, testHost } from "./host";

it("keeps the previous audit page when a request fails and retries the same page", async () => {
  const queryAuditLogs = vi.fn()
    .mockResolvedValueOnce({ totalRows: 25, data: [{ id: "1", userName: "Earlier record" }] })
    .mockResolvedValueOnce({ totalRows: 0, data: null })
    .mockResolvedValueOnce({ totalRows: 25, data: [{ id: "2", userName: "Later record" }] });
  const wrapper = mount(AuditLogPage, { global: pageGlobal(testHost({ queryAuditLogs })) });
  try {
    await flushPromises();
    await wrapper.get(".btn-next").trigger("click");
    await flushPromises();
    expect(wrapper.get(".audit-result-scope").text()).toContain("Page 1");
    expect(wrapper.get(".audit-load-error").text()).toContain("Page 2");
    expect(wrapper.get(".el-table__body-wrapper").text()).toContain("Earlier record");
    await wrapper.get(".audit-load-error button").trigger("click");
    await flushPromises();
    expect(queryAuditLogs.mock.calls.map(([query]) => query.pageNum)).toEqual([1, 2, 2]);
    expect(wrapper.get(".audit-result-scope").text()).toContain("Page 2");
    expect(wrapper.get(".el-table__body-wrapper").text()).toContain("Later record");
    expect(wrapper.find(".audit-load-error").exists()).toBe(false);
  } finally {
    wrapper.unmount();
  }
});
