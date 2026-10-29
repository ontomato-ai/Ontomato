/**
 * RFC 4122 version-4 UUID for browser code. crypto.randomUUID exists only in secure contexts
 * (HTTPS or localhost), and intranet deployments are served over plain HTTP; getRandomValues is
 * available in every context, including Node.
 */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
