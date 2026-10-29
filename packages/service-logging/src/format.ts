import { serviceLogFormat as format, type ServiceLogEvent } from "@ontomato/contracts/service-logging";

const wellFormed = (value: string) => value.replace(/[\uD800-\uDFFF]/gu, "\uFFFD");

export function exceptionStack(error: Error): string {
  const pending: Array<{ error: Error; label: string }> = [{ error, label: "" }];
  const seen = new Set<Error>(), parts: string[] = [];
  while (pending.length) {
    const item = pending.pop()!;
    if (seen.has(item.error)) continue;
    seen.add(item.error);
    parts.push(item.label + (item.error.stack || `${item.error.name}: ${item.error.message}`));
    if (item.error.cause instanceof Error) pending.push({ error: item.error.cause, label: "Caused by: " });
    if (item.error instanceof AggregateError) for (const child of [...item.error.errors].reverse()) {
      if (child instanceof Error) pending.push({ error: child, label: "Contained error: " });
    }
  }
  return parts.join("\n");
}

/** JSON escaping is the shared text protocol, not an arbitrary metadata serialization path. */
export function quote(value: string): string {
  return JSON.stringify(wellFormed(value)).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

export function boundText(value: string, limit: number): string {
  const text = wellFormed(value);
  if (Buffer.byteLength(quote(text)) <= limit) return text;
  const available = limit - 2 - format.limits.truncationMarkerReserveBytes;
  const headBudget = Math.floor(available / 2), tailBudget = available - headBudget;
  let head = "", tail = "", bytes = 0, headEnd = 0, tailStart = text.length;
  for (const scalar of text) {
    const size = Buffer.byteLength(quote(scalar)) - 2;
    if (bytes + size > headBudget) break;
    bytes += size; head += scalar; headEnd += scalar.length;
  }
  bytes = 0;
  while (tailStart > headEnd) {
    const end = text.charCodeAt(tailStart - 1);
    const width = end >= 0xdc00 && end <= 0xdfff ? 2 : 1;
    const scalar = text.slice(tailStart - width, tailStart);
    const size = Buffer.byteLength(quote(scalar)) - 2;
    if (bytes + size > tailBudget) break;
    bytes += size; tail = scalar + tail; tailStart -= width;
  }
  const omitted = Buffer.byteLength(text.slice(headEnd, tailStart));
  return head + format.limits.truncationMarker.replace("{bytes}", String(omitted)) + tail;
}

export function normalizeEvent(input: ServiceLogEvent): ServiceLogEvent {
  const fields = [...format.prefixFields, ...format.baseFields, ...format.httpFields, ...format.downstreamFields, ...format.errorFields];
  const source = input as unknown as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  for (const key of new Set(fields)) {
    const value = source[key];
    values[key] = typeof value === "string" || typeof value === "number" ? value : null;
    const choices = ({ service: format.services, kind: format.kinds, outcome: format.outcomes } as Record<string, string[]>)[key];
    if (choices && !choices.includes(String(value))) values[key] = null;
    if (format.integerFields.includes(key) && !(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) values[key] = null;
  }
  const event = values as unknown as ServiceLogEvent;
  const invalid: string[] = [];
  for (const key of new Set(fields)) {
    const value = values[key];
    if (typeof value !== "string" || format.tokenFields.includes(key) || format.prefixFields.includes(key)) continue;
    if (format.identityFields.includes(key)) {
      if (Buffer.byteLength(quote(value)) > format.limits.encodedIdentityBytes) {
        values[key] = null; invalid.push(key);
      } else values[key] = wellFormed(value);
    } else {
      const limits: Record<string, number> = format.limits.encodedFieldBytes;
      values[key] = boundText(value, limits[key] ?? format.limits.encodedTextBytes);
    }
  }
  if (invalid.length) event.message = boundText(`${event.message}; invalid log context: ${invalid.join(",")}`, format.limits.encodedFieldBytes.message);
  return event;
}

export function formatLine(event: ServiceLogEvent): string {
  const values = event as unknown as Record<string, unknown>;
  const fields = [...format.baseFields,
    ...(event.kind === "http" ? format.httpFields : event.kind === "downstream" ? format.downstreamFields : []),
    ...(event.errorName || event.errorCode || event.stack ? format.errorFields : [])];
  return format.prefixFields.map((key) => values[key]).join(format.separator) + format.separator
    + fields.map((key) => {
      const value = values[key];
      return `${key}=${value == null ? format.missingValue
        : format.tokenFields.includes(key) || format.integerFields.includes(key) ? value : quote(String(value))}`;
    }).join(format.separator);
}

/** Only the current common format is accepted; historical JSONL has no runtime fallback. */
export function parseLine(line: string): ServiceLogEvent | null {
  const prefix = /^(\S+) (\S+) /u.exec(line);
  if (!prefix || !format.levels.includes(prefix[2])) return null;
  const values: Record<string, unknown> = { time: prefix[1], level: prefix[2] };
  const tokens = /([A-Za-z]+)=("(?:\\.|[^"\\])*"|[^ ]+)(?: |$)/gy;
  tokens.lastIndex = prefix[0].length;
  let end = tokens.lastIndex;
  try {
    let match: RegExpExecArray | null;
    while ((match = tokens.exec(line))) {
      const [, key, value] = match;
      values[key] = value === format.missingValue ? null : value.startsWith('"') ? JSON.parse(value)
        : format.integerFields.includes(key) ? Number(value) : value;
      end = tokens.lastIndex;
    }
    if (end !== line.length || !format.services.includes(String(values.service))
      || !format.kinds.includes(String(values.kind)) || typeof values.message !== "string") return null;
    return values as unknown as ServiceLogEvent;
  } catch { return null; }
}
