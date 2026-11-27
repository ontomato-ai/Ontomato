import { expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { reportCoverImage, reportCoverMaxBytes, reportCoverPathSchema } from "@ontomato/contracts/report-cover";
import { stageReportCover } from "../report-cover";

const png = () => {
  const bytes = Buffer.alloc(45);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).copy(bytes);
  bytes.writeUInt32BE(10, 16);
  bytes.writeUInt32BE(20, 20);
  Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]).copy(bytes, 33);
  return bytes;
};
const jpeg = () => Buffer.from([255, 216, 255, 192, 0, 17, 8, 0, 20, 0, 10, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 218, 0, 2, 0, 255, 217]);

it("accepts bounded PNG/JPEG headers and rejects mislabeled, oversized or malformed images", () => {
  expect(reportCoverImage(png())).toEqual({ extension: "png", width: 10, height: 20 });
  expect(reportCoverImage(jpeg())).toEqual({ extension: "jpg", width: 10, height: 20 });
  expect(reportCoverImage(Buffer.concat([png(), Buffer.from([0])]))).toBeUndefined();
  const huge = jpeg();
  huge.writeUInt16BE(0xffff, 7);
  huge.writeUInt16BE(0xffff, 9);
  expect(reportCoverImage(huge)).toBeUndefined();
  expect(reportCoverImage(Buffer.alloc(reportCoverMaxBytes + 1))).toBeUndefined();
});

it("stages content-validated cover images under generated, session-scoped paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "report-cover-"));
  try {
    const workspace = path.join(root, "workspace");
    await import("node:fs/promises").then(fs => fs.mkdir(workspace));
    const first = await stageReportCover(workspace, png().toString("base64"));
    const second = await stageReportCover(workspace, jpeg().toString("base64"));
    expect(reportCoverPathSchema.parse(first.path)).toBe(first.path);
    expect(reportCoverPathSchema.parse(second.path)).toBe(second.path);
    expect(await readdir(path.join(workspace, "report-covers"))).toHaveLength(2);
    expect(await readFile(path.join(workspace, first.path))).toEqual(png());
    await expect(stageReportCover(workspace, Buffer.from("text").toString("base64"))).rejects.toMatchObject({ code: "INVALID_REPORT_COVER" });
    const nonDirectory = path.join(root, "not-a-workspace");
    await writeFile(nonDirectory, "file");
    await expect(stageReportCover(nonDirectory, png().toString("base64"))).rejects.toMatchObject({ code: "REPORT_COVER_UNAVAILABLE" });
    await writeFile(path.join(workspace, "report-covers", "x"), "not an upload path");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
