import { afterEach, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { APP_BRIDGE_CHANNEL } from "@ontomato/contracts/app-bridge";
import { EXPORT_FEEDBACK, EXPORT_SKILL, IMPORT_SKILL, SKILL } from "@ontomato/contracts/panel-client-requests";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * U11 FileUploadControl and DownloadButton through the platform's real host and bridge:
 * - FileUploadControl opens the declared rules dialog first, validates `.zip` before upload, sends multipart FormData
 *   through the real bridge + panel-client-requests admission (`skills.import`), prompts for overwrite confirmation on
 *   `PlatformUploadConflict`, and retries with `overwrite: true` only after confirmation.
 * - DownloadButton never fetches export bytes or triggers `<a download>` inside the sandboxed frame; it sends a
 *   structured host download request (`slot`, `operationId`, `handlerRef`, `target`, `input`) over the bridge for both
 *   single-object export (`skills.export`) and filtered collection export (`feedback.export`).
 */

const current = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain" as const,
};

const operationProjection = (
  id: string,
  componentId: "FileUploadControl" | "DownloadButton",
  operationId: string,
  display: Record<string, unknown>,
  inputs: ProductProjection["inputs"] = {},
): ProductProjection => ({
  ...current, id, name: id, description: "", componentId,
  binding: { kind: "PlatformOperation", id: operationId }, inputs, display,
});

function hostWith(projections: Record<string, ProductProjection>, extra?: (request: Sent) => Response | undefined) {
  return (request: Sent) => {
    const match = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (match && projections[match[1]!]) return Response.json({ projection: projections[match[1]!] });
    return extra?.(request) ?? nothingAt(request);
  };
}

function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Happy DOM's `File`/`Blob` are JS classes rather than Node's native `Blob`, so Node's built-in `MessageChannel`
 * drops their prototype during structured clone. This test-only channel preserves `Blob`/`File` across ports so real
 * `bridge.ts` -> `app-bridge.ts` `FormData` reconstruction runs end-to-end.
 */
function installBlobPreservingMessageChannel() {
  class TestMessageChannel {
    port1: MessagePort;
    port2: MessagePort;
    constructor() {
      const makePort = (peer: () => TestPort) => {
        const queued: unknown[] = [];
        let started = false;
        const port: TestPort = {
          onmessage: null,
          deliver(data: unknown) {
            if (!started) queued.push(data);
            else queueMicrotask(() => port.onmessage?.({ data } as MessageEvent));
          },
          start() {
            started = true;
            for (const item of queued.splice(0)) queueMicrotask(() => port.onmessage?.({ data: item } as MessageEvent));
          },
          close() {},
          postMessage(data: unknown) {
            peer().deliver(data);
          },
        };
        return port;
      };
      type TestPort = {
        onmessage: ((event: MessageEvent) => void) | null;
        deliver(data: unknown): void;
        start(): void;
        close(): void;
        postMessage(data: unknown): void;
      };
      const p1: TestPort = makePort(() => p2);
      const p2: TestPort = makePort(() => p1);
      // Assigning onmessage implicitly starts a MessagePort per HTML spec (bridge.ts assigns onmessage without start()).
      const withImplicitStart = (p: TestPort) => {
        let handler: ((event: MessageEvent) => void) | null = null;
        return Object.defineProperty(p, "onmessage", {
          get: () => handler,
          set(next: ((event: MessageEvent) => void) | null) {
            handler = next;
            if (next) p.start();
          },
        });
      };
      this.port1 = withImplicitStart(p1) as unknown as MessagePort;
      this.port2 = withImplicitStart(p2) as unknown as MessagePort;
    }
  }
  vi.stubGlobal("MessageChannel", TestMessageChannel);
}

afterEach(() => {
  vi.unstubAllGlobals();
  leaveFrame();
  vi.resetModules();
});

it("shows format rules dialog, rejects non-zip files, uploads multipart FormData through the real bridge, and confirms overwrite on conflict", async () => {
  installBlobPreservingMessageChannel();
  const projections = {
    "skill-import": operationProjection("skill-import", "FileUploadControl", IMPORT_SKILL, {
      accept: ".zip",
      label: "import.button",
      intro: "import.intro",
      rules: ["import.rule1", "import.rule2"],
    }),
  };
  const manifest = definePanel({
    state: {},
    slots: {
      importSkill: { projectionId: "skill-import", inputs: {} },
    },
    operations: [],
  });
  const panel = panelRecord("panel-upload", "Upload test", manifest);
  panel.content.html = `<div id="app"><Projection slot="importSkill" @uploaded="uploaded = $event"></Projection></div>`;
  panel.content.messages = {
    en: {
      "import.button": "Import package",
      "import.intro": "Package format requirements:",
      "import.rule1": "Single root folder",
      "import.rule2": "Must include SKILL.md",
    },
  };
  const use = panelUse("use-upload", "upload-test", panel.id, "/applications/app-test/upload");

  const importRequests: { path: string; search: string; method: string; fileName: string | null }[] = [];
  installPlatform(hostWith(projections, (request) => {
    if (request.path === "/api/skills/import") {
      const form = request.body instanceof FormData ? request.body : null;
      const uploadedFile = form?.get("file");
      importRequests.push({
        path: request.path,
        search: request.search,
        method: request.method,
        fileName: uploadedFile instanceof File ? uploadedFile.name : null,
      });
      if (request.search !== "?overwrite=true") {
        return Response.json({ error: { code: "SKILL_EXISTS", message: "Package already exists" } }, { status: 409 });
      }
      return Response.json({ skill: { id: "demo-skill" } });
    }
    return undefined;
  }));

  const frame = panelFrame();
  platformPanelHost("app-test", use).frame(frame, registered("app-test", use, panel), true);
  writePanelDocument(panel, use, use.path, {});
  inside(frame);

  const { registerHandler } = await import("../../../../../packages/apps-sdk/src/panel/handlers");
  const { PlatformUploadConflict } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const { contextTransport } = await import("../../../../../packages/apps-sdk/src/context");

  const uploaded = ref<unknown>(null);
  let transport: ReturnType<typeof contextTransport>;
  registerHandler({
    handlerRef: IMPORT_SKILL,
    async invoke({ input }) {
      const file = input.file as File;
      const overwrite = Boolean(input.overwrite);
      const form = new FormData();
      form.append("file", file);
      const path = overwrite ? "/skills/import?overwrite=true" : "/skills/import";
      try {
        const response = await transport.request(path, { method: "POST", body: form }, "");
        return await response.json();
      } catch (error) {
        const payload = (error as { payload?: { error?: { code?: string; message?: string } } }).payload;
        if (payload?.error?.code === "SKILL_EXISTS") {
          throw new PlatformUploadConflict(payload.error.message ?? "Package already exists", { cause: error });
        }
        throw error;
      }
    },
  });

  const mounted = await mountPanel({ setup: () => ({ uploaded }) });
  transport = contextTransport(mounted.appContext);
  const refreshed = vi.fn();
  mounted.context.instance.onObjectChanged(refreshed);

  await vi.waitFor(() => expect(document.querySelector(".sdk-file-upload-trigger")?.textContent?.trim()).toBe("Import package"));

  // Click trigger -> opens rules dialog first with localized intro & rules.
  document.querySelector<HTMLButtonElement>(".sdk-file-upload-trigger")!.click();
  await nextTick();
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog!.textContent).toContain("Package format requirements:");
  expect(dialog!.textContent).toContain("Single root folder");
  expect(dialog!.textContent).toContain("Must include SKILL.md");

  // Picking a non-.zip file shows validation alert and sends NO HTTP request.
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  selectFile(fileInput, new File(["plain"], "notes.txt", { type: "text/plain" }));
  await nextTick();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(".zip");
  expect(importRequests).toHaveLength(0);

  // Picking a .zip file sends real multipart FormData -> 409 opens overwrite confirm dialog.
  const zipFile = new File(["PK\x03\x04"], "demo.zip", { type: "application/zip" });
  selectFile(fileInput, zipFile);
  await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Package already exists"));
  expect(importRequests).toEqual([{ path: "/api/skills/import", search: "", method: "POST", fileName: "demo.zip" }]);

  // Cancelling overwrite dialog sends no second request.
  document.querySelector<HTMLButtonElement>(".sdk-file-upload-cancel")!.click();
  await nextTick();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(importRequests).toHaveLength(1);

  // Uploading again and confirming overwrite sends ?overwrite=true, emits uploaded, and refreshes panel objects.
  selectFile(fileInput, zipFile);
  await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBeNull());
  document.querySelector<HTMLButtonElement>(".sdk-file-upload-overwrite")!.click();
  await vi.waitFor(() => expect(uploaded.value).toEqual({ skill: { id: "demo-skill" } }));
  expect(importRequests[2]).toEqual({ path: "/api/skills/import", search: "?overwrite=true", method: "POST", fileName: "demo.zip" });
  expect(refreshed).toHaveBeenCalledWith(null);
});

it("dispatches host download requests without fetching or creating download links inside the frame", async () => {
  const projections = {
    "skill-export": operationProjection("skill-export", "DownloadButton", EXPORT_SKILL, {
      label: "export.skill",
    }, { skill: { kind: "object", objectType: SKILL } }),
    "feedback-export": operationProjection("feedback-export", "DownloadButton", EXPORT_FEEDBACK, {
      label: "export.feedback",
    }),
  };
  const manifest = definePanel({
    state: {
      selectedSkill: { kind: "object", objectType: SKILL, deepLink: false },
    },
    slots: {
      exportSkill: { projectionId: "skill-export", inputs: { skill: { state: "selectedSkill" } } },
      exportFeedback: { projectionId: "feedback-export", inputs: {} },
    },
    operations: [],
  });
  const panel = panelRecord("panel-download", "Download test", manifest);
  panel.content.html = `
    <div id="app">
      <div class="skill-export"><Projection slot="exportSkill"></Projection></div>
      <div class="feedback-export"><Projection slot="exportFeedback" :params="feedbackParams"></Projection></div>
    </div>`;
  panel.content.messages = {
    en: {
      "export.skill": "Export package",
      "export.feedback": "Export CSV",
    },
  };
  const use = panelUse("use-download", "download-test", panel.id, "/applications/app-test/download");

  const exportHttpCalls: string[] = [];
  installPlatform(hostWith(projections, (request) => {
    if (request.path.includes("/export")) {
      exportHttpCalls.push(request.path);
      return new Response("unexpected", { status: 200 });
    }
    return undefined;
  }));

  // Intercept the transferred APP_BRIDGE_CHANNEL port to observe host download requests directly.
  const downloadPayloads: unknown[] = [];
  let failNextDownload = false;
  const interceptConnect = (event: MessageEvent) => {
    if (event.data?.channel !== APP_BRIDGE_CHANNEL || event.data?.operation !== "connect" || !event.ports[0]) return;
    const port = event.ports[0];
    const originalHandler = port.onmessage;
    port.onmessage = (portEvent) => {
      if (portEvent.data?.channel === APP_BRIDGE_CHANNEL && portEvent.data?.operation === "download") {
        downloadPayloads.push(portEvent.data.payload);
        port.postMessage(
          failNextDownload
            ? { channel: APP_BRIDGE_CHANNEL, id: portEvent.data.id, error: "Download denied" }
            : { channel: APP_BRIDGE_CHANNEL, id: portEvent.data.id, result: null },
        );
        return;
      }
      originalHandler?.call(port, portEvent);
    };
  };
  window.addEventListener("message", interceptConnect);

  try {
    const frame = panelFrame();
    platformPanelHost("app-test", use).frame(frame, registered("app-test", use, panel), true);
    writePanelDocument(panel, use, use.path, {});
    inside(frame);

    const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
    const feedbackParams = ref({ search: "slow", filters: { rating: "dislike" } });
    const mounted = await mountPanel({ setup: () => ({ feedbackParams }) });

    await vi.waitFor(() => expect(document.querySelector(".skill-export button")?.textContent?.trim()).toBe("Export package"));
    const skillBtn = document.querySelector<HTMLButtonElement>(".skill-export button")!;
    const feedbackBtn = document.querySelector<HTMLButtonElement>(".feedback-export button")!;

    // Single-object export is disabled while no skill is selected; collection export is enabled immediately.
    expect(skillBtn.disabled).toBe(true);
    expect(feedbackBtn.disabled).toBe(false);

    // Click feedback export -> sends host download request with current filter params; no frame fetch or <a download>.
    feedbackBtn.click();
    await vi.waitFor(() => expect(downloadPayloads).toHaveLength(1));
    expect(downloadPayloads[0]).toEqual({
      slot: "exportFeedback",
      operationId: "exportFeedback.export",
      handlerRef: EXPORT_FEEDBACK,
      target: null,
      input: { search: "slow", filters: { rating: "dislike" } },
    });

    // Select a skill -> skill export enables and sends target identity over the bridge.
    mounted.context.instance.state.set("selectedSkill", { className: SKILL, primaryKey: "skill-1" });
    await nextTick();
    expect(skillBtn.disabled).toBe(false);
    skillBtn.click();
    await vi.waitFor(() => expect(downloadPayloads).toHaveLength(2));
    expect(downloadPayloads[1]).toEqual({
      slot: "exportSkill",
      operationId: "exportSkill.export",
      handlerRef: EXPORT_SKILL,
      target: { kind: "object", objectType: SKILL, primaryKey: "skill-1" },
      input: {},
    });

    // Frame never fetched export endpoints directly and never created a download anchor.
    expect(exportHttpCalls).toEqual([]);
    expect(document.querySelector("a[download]")).toBeNull();

    // Host download rejection surfaces cleanly in role="alert".
    failNextDownload = true;
    feedbackBtn.click();
    await vi.waitFor(() => expect(document.querySelector('.feedback-export [role="alert"]')?.textContent).toContain("Download denied"));
  } finally {
    window.removeEventListener("message", interceptConnect);
  }
});
