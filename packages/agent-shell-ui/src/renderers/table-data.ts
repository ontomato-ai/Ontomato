/** Tabular projection of a dataset file: header row plus string cells, nothing guessed. */
export interface TableData {
  columns: string[];
  rows: string[][];
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF; a BOM is ignored. */
export function parseCsv(text: string): TableData {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  const [columns = [], ...rows] = records;
  return { columns, rows };
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** JSON arrays of records become tables; anything else is shown as formatted JSON. */
export function jsonTable(value: unknown): TableData | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
    const columns: string[] = [];
    for (const row of value as Record<string, unknown>[])
      for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
    return {
      columns,
      rows: (value as Record<string, unknown>[]).map((row) => columns.map((key) => cell(row[key]))),
    };
  }
  return null;
}
