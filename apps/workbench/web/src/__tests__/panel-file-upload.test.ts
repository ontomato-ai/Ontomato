import { afterEach, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { IMPORT_SKILL } from "@ontomato/contracts/panel-client-requests";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * U11 FileUploadControl through the platform's real host and bridge:
 * - Opens the declared rules dialog first, validates `.zip` before upload, sends multipart FormData through the real
 *   bridge + panel-client-requests admission (`skills.import`), prompts for overwrite confirmation on
 *   `PlatformUploadConflict`, and retries with `overwrite: true` only after confirmation.
 */

const current = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain" as const,
};

const operationProjection = (
  id: string,
  operationId: string,
  display: Record<string, unknown>,
  inputs: ProductProjection["inputs"] = {},
): ProductProjection => ({
  ...current, id, name: id, description: "", componentId: "FileUploadControl",
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
    "skill-import": operationProjection("skill-import", IMPORT_SKILL, {
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
  writePanelDocument(registered("app-test", use, panel), use.path, {});
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
