import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { ElMessageBox } from "element-plus/es/components/message-box/index";
import SecretDeliveryDialog from "../../../apps-sdk/src/base/SecretDeliveryDialog.vue";
import { workbenchI18n } from "../i18n";

enableAutoUnmount(afterEach);

describe("SecretDeliveryDialog", () => {
  let clickCount = 0;
  let createUrlCount = 0;
  let revokedUrls: string[] = [];

  beforeEach(() => {
    clickCount = 0;
    createUrlCount = 0;
    revokedUrls = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      clickCount += 1;
    });
    Object.defineProperty(URL, "createObjectURL", {
      value: () => {
        createUrlCount += 1;
        return "blob:secret-file";
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: (url: string) => {
        revokedUrls.push(url);
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-downloads once when download.autoDownload is true and closes without confirmation", async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, "confirm");
    const wrapper = mount(SecretDeliveryDialog, {
      props: {
        deliveries: [{
          title: "Batch API keys",
          summary: "Generated 2 keys",
          download: {
            filename: "api-keys.csv",
            contentType: "text/csv",
            content: "loginCode,apiKey\nalice,sk-1",
            autoDownload: true,
          },
        }],
      },
      attachTo: document.body,
      global: { plugins: [workbenchI18n()] },
    });
    await flushPromises();

    expect(clickCount).toBe(1);
    expect(createUrlCount).toBe(1);
    expect(revokedUrls).toEqual(["blob:secret-file"]);

    const closeBtn = Array.from(document.body.querySelectorAll("button"))
      .find(btn => btn.textContent?.trim() === "Close");
    expect(closeBtn).toBeDefined();
    closeBtn!.click();
    await flushPromises();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("asks for confirmation before closing when a secret file has not been downloaded yet", async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, "confirm")
      .mockRejectedValueOnce("cancel")
      .mockResolvedValueOnce("confirm" as never);
    const wrapper = mount(SecretDeliveryDialog, {
      props: {
        deliveries: [{
          title: "API keys",
          download: {
            filename: "keys.csv",
            contentType: "text/csv",
            content: "a,b",
          },
        }],
      },
      attachTo: document.body,
      global: { plugins: [workbenchI18n()] },
    });
    await flushPromises();

    expect(clickCount).toBe(0);

    const closeBtn = () => Array.from(document.body.querySelectorAll("button"))
      .find(btn => btn.textContent?.trim() === "Close")!;

    // First attempt: user cancels confirmation -> stays open.
    closeBtn().click();
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("close")).toBeUndefined();

    // Second attempt: user confirms closing anyway -> emits close.
    closeBtn().click();
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("allows closing immediately after manual download without prompting", async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, "confirm");
    const wrapper = mount(SecretDeliveryDialog, {
      props: {
        deliveries: [{
          title: "API keys",
          download: {
            filename: "manual.csv",
            contentType: "text/csv",
            content: "a,b",
          },
        }],
      },
      attachTo: document.body,
      global: { plugins: [workbenchI18n()] },
    });
    await flushPromises();

    const downloadBtn = Array.from(document.body.querySelectorAll("button"))
      .find(btn => btn.textContent?.includes("Download manual.csv"))!;
    downloadBtn.click();
    await flushPromises();
    expect(clickCount).toBe(1);

    const closeBtn = Array.from(document.body.querySelectorAll("button"))
      .find(btn => btn.textContent?.trim() === "Close")!;
    closeBtn.click();
    await flushPromises();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
