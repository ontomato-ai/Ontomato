import { createApp, h, nextTick, ref } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import AttachmentCell from "../renderers/AttachmentCell.vue";
import { cellAttachments } from "../renderers/cell-attachments";
import { shellContextKey, type ShellContext } from "../context";

const labels = ref({ artifactMissing: "File unavailable", loading: "Loading" } as ShellContext["labels"]["value"]);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function thumbnailObservation() {
  const observed = new Set<Element>();
  let notify: IntersectionObserverCallback;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe(element: Element) { observed.add(element); }
    unobserve(element: Element) { observed.delete(element); }
    disconnect() { observed.clear(); }
  });
  return {
    visible(target: Element) {
      expect(observed.has(target)).toBe(true);
      notify([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    },
  };
}

function pdfPreview() {
  const close = vi.fn();
  const replace = vi.fn();
  const preview = { opener: window, closed: false, close, location: { replace } };
  const open = vi.spyOn(window, "open").mockReturnValue(preview as unknown as Window);
  return { preview, open, close, replace };
}

it("recognizes legacy attachment arrays and preserves signed URLs and captions", () => {
  const values = [
    { path: "https://files.test/photo.jpg?signature=abc#view", text: "Photo" },
    { path: "/files/report.PDF?download=1", text: "Report" },
    { path: "https://files.test/archive.zip", text: "Archive" },
  ];
  expect(cellAttachments(JSON.stringify(values))).toEqual([
    { url: values[0].path, caption: "Photo", kind: "image" },
    { url: values[1].path, caption: "Report", kind: "pdf" },
    { url: values[2].path, caption: "Archive", kind: "file" },
  ]);
  expect(cellAttachments("https://files.test/a.png")[0]?.kind).toBe("image");
  expect(cellAttachments('{"path":"/files/report.pdf","text":"Report"}')[0]?.kind).toBe("pdf");
});

it.each([
  "Ordinary text", "https://example.test/", '[{"name":"Business record"}]',
  '{"path":"javascript:alert(1)"}', '{"path":"data:text/html,hello"}',
  '{"path":"//unknown.test/a.png"}', '{"path":"/\\unknown.test/a.png"}',
  '<img src="/files/a.png" onerror="alert(1)">',
])("keeps unsupported or unsafe cell content as literal text: %s", value => {
  expect(cellAttachments(value)).toEqual([]);
});

it("opens an image viewer and gives PDFs a separate-window link", async () => {
  const root = document.createElement("div"); document.body.append(root);
  const app = createApp({ render: () => h(AttachmentCell, { text: JSON.stringify([
    { path: "/files/a.jpg", text: "First photo" },
    { path: "/files/b.png", text: "Second photo" },
    { path: "/files/report.pdf", text: "Report" },
  ]) }) });
  const readVectorResource = vi.fn();
  app.provide(shellContextKey, { readVectorResource } as Partial<ShellContext> as ShellContext);
  app.mount(root);
  try {
    expect(root.querySelectorAll(".cell-image")).toHaveLength(2);
    const pdf = root.querySelector<HTMLAnchorElement>("a.cell-file")!;
    expect(pdf.getAttribute("href")).toBe("/files/report.pdf");
    expect(pdf.target).toBe("_blank");
    expect(pdf.rel).toContain("noopener");
    root.querySelector<HTMLElement>(".image-open")!.click();
    await nextTick();
    expect(document.body.querySelector(".el-image-viewer__wrapper")).not.toBeNull();
    expect(document.body.querySelector(".el-image-viewer__img")?.getAttribute("src")).toBe("/files/a.jpg");
    document.body.querySelector<HTMLElement>(".el-image-viewer__next")!.click();
    await nextTick();
    expect(document.body.querySelector(".el-image-viewer__img")?.getAttribute("src")).toBe("/files/b.png");
    expect(readVectorResource).not.toHaveBeenCalled();
  } finally { app.unmount(); root.remove(); }
});

it("recognizes named download attachments and URLs with spaces without rewriting signed URLs", () => {
  expect(cellAttachments(JSON.stringify([
    { url: "https://files.test/download?id=1&signature=abc", name: "论文.pdf" },
    { path: "/files/研究 图片.png", text: "Figure" },
    { url: "/files/opaque", mimeType: "image/jpeg", name: "Experiment" },
  ]))).toEqual([
    { url: "https://files.test/download?id=1&signature=abc", caption: "论文.pdf", kind: "pdf" },
    { url: "/files/研究 图片.png", caption: "Figure", kind: "image" },
    { url: "/files/opaque", caption: "Experiment", kind: "image" },
  ]);
});

it("opens the clicked image in the row gallery, updates its caption and closes the lightbox", async () => {
  const root = document.createElement("div"); document.body.append(root);
  const gallery = [
    { url: "/files/a.jpg", caption: "First figure", kind: "image" as const },
    { url: "/files/b.png", caption: "Second figure", kind: "image" as const },
  ];
  const app = createApp({ render: () => h(AttachmentCell, {
    text: JSON.stringify({ path: gallery[1].url, text: gallery[1].caption }), gallery,
  }) });
  app.mount(root);
  try {
    root.querySelector<HTMLElement>(".image-open")!.click();
    await nextTick();
    expect(document.body.querySelector(".el-image-viewer__img")?.getAttribute("src")).toBe("/files/b.png");
    expect(document.body.querySelector(".viewer-caption")?.textContent).toBe("Second figure");
    document.body.querySelector<HTMLElement>(".el-image-viewer__prev")!.click();
    await nextTick();
    expect(document.body.querySelector(".viewer-caption")?.textContent).toBe("First figure");
    document.body.querySelector<HTMLElement>(".el-image-viewer__close")!.click();
    await nextTick();
    expect(document.body.querySelector(".el-image-viewer__wrapper")).toBeNull();
  } finally { app.unmount(); root.remove(); }
});


it("reads visible thumbnails, reuses the Blob in the gallery, and opens a vector PDF only on click", async () => {
  const root = document.createElement("div"); document.body.append(root);
  const observation = thumbnailObservation();
  const { preview, open, replace } = pdfPreview();
  const image = new Blob(["image bytes"], { type: "image/png" });
  const otherImage = new Blob(["other image bytes"], { type: "image/png" });
  const pdf = new Blob(["pdf bytes"], { type: "application/pdf" });
  const indexName = "vector-Order-proof-domain";
  const readVectorResource = vi.fn()
    .mockResolvedValueOnce(image).mockResolvedValueOnce(otherImage).mockResolvedValueOnce(pdf);
  const create = vi.spyOn(URL, "createObjectURL")
    .mockReturnValueOnce("blob:photo").mockReturnValueOnce("blob:other").mockReturnValueOnce("blob:report");
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const resource = `https://cards.test/prefix/api/data-query/vectorResource/resource/${indexName}`;
  const app = createApp(AttachmentCell, { text: JSON.stringify([
    { path: `${resource}/a.png`, text: "Photo" },
    { path: `${resource}/b.png`, text: "Second photo" },
    { path: `${resource}/r.pdf`, text: "Report" },
    { path: `${resource}/archive.zip`, text: "Archive" },
  ]) });
  app.provide(shellContextKey, { labels, readVectorResource } as Partial<ShellContext> as ShellContext);
  app.mount(root);
  try {
    await nextTick();
    expect(readVectorResource).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    observation.visible(root.querySelector(".cell-image")!);
    await vi.waitFor(() => expect(root.querySelector(".image-open")?.hasAttribute("disabled")).toBe(false));
    expect(readVectorResource.mock.calls.map(([target]) => target)).toEqual([{ indexName, fileName: "a.png" }]);

    root.querySelector<HTMLElement>(".image-open")!.click();
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(document.body.querySelector(".el-image-viewer__img")?.getAttribute("src")).toBe("blob:photo");
    expect(readVectorResource.mock.calls.map(([target]) => target)).toEqual([
      { indexName, fileName: "a.png" },
      { indexName, fileName: "b.png" },
    ]);
    document.body.querySelector<HTMLElement>(".el-image-viewer__close")!.click();
    await nextTick();
    expect(revoke.mock.calls).toEqual([["blob:other"]]);

    root.querySelector<HTMLButtonElement>("button.cell-file")!.click();
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(preview.opener).toBeNull();
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith("blob:report"));
    expect(readVectorResource.mock.calls.map(([target]) => target)).toEqual([
      { indexName, fileName: "a.png" },
      { indexName, fileName: "b.png" },
      { indexName, fileName: "r.pdf" },
    ]);
    expect(create.mock.calls).toEqual([[image], [otherImage], [pdf]]);
  } finally {
    app.unmount();
    root.remove();
  }
  expect(revoke.mock.calls).toEqual([["blob:other"], ["blob:photo"], ["blob:report"]]);
});

it.each([401, 403])("reports unreadable vector resources and never opens their raw links on HTTP %s", async status => {
  const root = document.createElement("div"); document.body.append(root);
  const observation = thumbnailObservation();
  const { open, close, replace } = pdfPreview();
  const indexName = "vector-Order-proof-domain";
  const readVectorResource = vi.fn().mockRejectedValue(new Response(null, { status }));
  const path = `/api/data-query/vectorResource/resource/${indexName}`;
  const app = createApp(AttachmentCell, { text: JSON.stringify([
    { path: `${path}/a.png`, text: "Photo" },
    { path: `${path}/r.pdf`, text: "Report" },
  ]) });
  app.provide(shellContextKey, { labels, readVectorResource } as Partial<ShellContext> as ShellContext);
  app.mount(root);
  try {
    expect(readVectorResource).not.toHaveBeenCalled();
    observation.visible(root.querySelector(".cell-image")!);
    await vi.waitFor(() => expect(root.querySelector(".image-error")?.textContent).toBe("File unavailable"));
    expect(root.querySelector<HTMLButtonElement>(".image-open")!.disabled).toBe(true);
    expect(root.querySelector(".cell-image img")?.getAttribute("src") ?? null).toBeNull();

    const file = root.querySelector<HTMLButtonElement>("button.cell-file")!;
    expect(file.getAttribute("href")).toBeNull();
    file.click();
    await vi.waitFor(() => expect(file.querySelector('[role="status"]')?.textContent).toBe("File unavailable"));
    expect(readVectorResource).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(close).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(file.getAttribute("href")).toBeNull();
    expect(document.body.querySelector(".el-image-viewer__wrapper")).toBeNull();
  } finally { app.unmount(); root.remove(); }
});
