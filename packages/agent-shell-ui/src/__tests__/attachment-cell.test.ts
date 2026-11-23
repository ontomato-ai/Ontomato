import { createApp, h, nextTick } from "vue";
import { expect, it } from "vitest";
import AttachmentCell from "../renderers/AttachmentCell.vue";
import { cellAttachments } from "../renderers/cell-attachments";

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
  } finally { app.unmount(); root.remove(); }
});
