import { z } from "zod";

export const reportCoverMaxBytes = 5 * 1024 * 1024;
export const reportCoverMaxPixels = 25_000_000;
export const reportCoverDirectory = "report-covers";
export const reportCoverPathSchema = z.string().regex(/^report-covers\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:png|jpg)$/);
export const reportCoverUploadSchema = z.object({
  image: z.string().min(4).max(Math.ceil(reportCoverMaxBytes / 3) * 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();

export function reportCoverImage(bytes: Uint8Array): { extension: "png" | "jpg"; width: number; height: number } | undefined {
  if (bytes.length > reportCoverMaxBytes) return;
  if (bytes.length >= 45 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    && [0, 0, 0, 13, 73, 72, 68, 82].every((value, index) => bytes[index + 8] === value)
    && [73, 69, 78, 68, 174, 66, 96, 130].every((value, index) => bytes[bytes.length - 8 + index] === value)) {
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = header.getUint32(16), height = header.getUint32(20);
    if (width > 0 && height > 0 && width * height <= reportCoverMaxPixels) return { extension: "png", width, height };
  }
  if (bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216
    || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset++] === 255) {
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 218 || offset + 2 > bytes.length) return;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return;
    if ([192, 193, 194].includes(marker) && length >= 8) {
      const height = view.getUint16(offset + 3), width = view.getUint16(offset + 5);
      if (width > 0 && height > 0 && width * height <= reportCoverMaxPixels) return { extension: "jpg", width, height };
      return;
    }
    offset += length;
  }
}
