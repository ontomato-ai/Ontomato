/**
 * Zero-dependency syntax tokenizer for `AnnotatedCode`.
 *
 * Splits source lines into plain `{ text, kind? }` token arrays while tracking multiline state
 * (such as Python triple-quoted strings, C-style/SQL/CSS block comments, JS/TS template strings,
 * and HTML comments). Callers render each token as a Vue text node — never `v-html`.
 */

export type CodeTokenKind =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "function"
  | "operator"
  | "type"
  | "builtin"
  | "property"
  | "punctuation";

export interface CodeToken {
  readonly text: string;
  readonly kind?: CodeTokenKind;
}

export type SupportedCodeLanguage =
  | "python"
  | "javascript"
  | "typescript"
  | "json"
  | "sql"
  | "yaml"
  | "bash"
  | "html"
  | "css";

const LANGUAGE_ALIASES: Readonly<Record<string, SupportedCodeLanguage>> = {
  python: "python",
  py: "python",
  python3: "python",
  py3: "python",
  javascript: "javascript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  typescript: "typescript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  json: "json",
  jsonc: "json",
  sql: "sql",
  mysql: "sql",
  postgresql: "sql",
  postgres: "sql",
  sqlite: "sql",
  plsql: "sql",
  tsql: "sql",
  yaml: "yaml",
  yml: "yaml",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  html: "html",
  htm: "html",
  xml: "html",
  svg: "html",
  xhtml: "html",
  css: "css",
  scss: "css",
  less: "css",
};

const PLAIN_LANGUAGE_NAMES = new Set(["", "plain", "text", "plaintext", "txt", "none"]);

/** Normalizes a raw language identifier or alias; returns `null` when highlighting should be skipped. */
export function normalizeCodeLanguage(raw?: string | null): SupportedCodeLanguage | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  if (PLAIN_LANGUAGE_NAMES.has(key)) return null;
  return LANGUAGE_ALIASES[key] ?? null;
}

function pushToken(out: CodeToken[], text: string, kind?: CodeTokenKind): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === kind) {
    out[out.length - 1] = kind ? { text: last.text + text, kind } : { text: last.text + text };
  } else {
    out.push(kind ? { text, kind } : { text });
  }
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isPascalCase(word: string): boolean {
  return word.length >= 2 && word[0]! >= "A" && word[0]! <= "Z" && /[a-z]/.test(word);
}

function peekNextNonSpace(line: string, from: number): string {
  let i = from;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i += 1;
  return line[i] ?? "";
}

function readNumberLiteral(line: string, start: number): number {
  const rest = line.slice(start);
  const match = rest.match(
    /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?[nNjJ]?)/,
  );
  return match ? start + match[0].length : start;
}

/* -------------------------------------------------------------------------- */
/* Python                                                                     */
/* -------------------------------------------------------------------------- */

const PYTHON_KEYWORDS = new Set([
  "and", "as", "assert", "async", "await", "break", "case", "class", "continue",
  "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "match", "nonlocal", "not", "or",
  "pass", "raise", "return", "try", "while", "with", "yield",
]);

const PYTHON_BUILTINS = new Set([
  "True", "False", "None", "self", "cls", "print", "len", "range", "dict",
  "list", "set", "tuple", "str", "int", "float", "bool", "bytes", "object",
  "type", "super", "isinstance", "issubclass", "enumerate", "zip", "map",
  "filter", "sum", "min", "max", "sorted", "reversed", "any", "all", "abs",
  "round", "open", "id", "hash", "repr", "getattr", "setattr", "hasattr",
  "Exception", "ValueError", "TypeError", "KeyError", "IndexError", "RuntimeError",
  "AttributeError", "NotImplementedError", "StopIteration",
]);

interface PythonState {
  tripleQuote: '"""' | "'''" | null;
  tripleRaw: boolean;
}

function tokenizePythonLine(line: string, state: PythonState): CodeToken[] {
  const out: CodeToken[] = [];
  let i = 0;
  let prevKeyword = "";
  let prevWasDot = false;

  while (i < line.length) {
    if (state.tripleQuote) {
      const quote = state.tripleQuote;
      const start = i;
      let closed = false;
      while (i < line.length) {
        if (!state.tripleRaw && line[i] === "\\") {
          i += Math.min(2, line.length - i);
          continue;
        }
        if (line.startsWith(quote, i)) {
          i += 3;
          state.tripleQuote = null;
          state.tripleRaw = false;
          closed = true;
          break;
        }
        i += 1;
      }
      pushToken(out, line.slice(start, i), "string");
      if (!closed) break;
      prevKeyword = "";
      prevWasDot = false;
      continue;
    }

    const ch = line[i]!;

    if (ch === " " || ch === "\t") {
      const start = i;
      while (i < line.length && (line[i] === " " || line[i] === "\t")) i += 1;
      pushToken(out, line.slice(start, i));
      continue;
    }

    if (ch === "#") {
      pushToken(out, line.slice(i), "comment");
      break;
    }

    // String prefix + quote (`r"..."`, `f"""..."""`, `rb'...'`, etc.)
    const prefixMatch = line.slice(i).match(/^([rRbBuUfF]{0,2})("""|'''|"|')/);
    if (prefixMatch) {
      const prefix = prefixMatch[1]!;
      const quote = prefixMatch[2]!;
      const isRaw = /[rR]/.test(prefix);
      const start = i;
      i += prefix.length + quote.length;
      if (quote === '"""' || quote === "'''") {
        let closed = false;
        while (i < line.length) {
          if (!isRaw && line[i] === "\\") {
            i += Math.min(2, line.length - i);
            continue;
          }
          if (line.startsWith(quote, i)) {
            i += 3;
            closed = true;
            break;
          }
          i += 1;
        }
        if (!closed) {
          state.tripleQuote = quote;
          state.tripleRaw = isRaw;
        }
      } else {
        while (i < line.length) {
          if (!isRaw && line[i] === "\\") {
            i += Math.min(2, line.length - i);
            continue;
          }
          if (line[i] === quote) {
            i += 1;
            break;
          }
          i += 1;
        }
      }
      pushToken(out, line.slice(start, i), "string");
      prevKeyword = "";
      prevWasDot = false;
      continue;
    }

    // Decorators
    if (ch === "@" && i < line.length - 1 && isIdentStart(line[i + 1]!)) {
      const start = i;
      i += 1;
      while (i < line.length && (isIdentPart(line[i]!) || line[i] === ".")) i += 1;
      pushToken(out, line.slice(start, i), "function");
      prevKeyword = "";
      prevWasDot = false;
      continue;
    }

    // Numbers
    if (isDigit(ch) || (ch === "." && i + 1 < line.length && isDigit(line[i + 1]!))) {
      const end = ch === "."
        ? i + (line.slice(i).match(/^\.\d[\d_]*(?:[eE][+-]?\d[\d_]*)?[jJ]?/)?.[0].length ?? 1)
        : readNumberLiteral(line, i);
      pushToken(out, line.slice(i, end), "number");
      i = end;
      prevKeyword = "";
      prevWasDot = false;
      continue;
    }

    // Identifiers
    if (isIdentStart(ch) && ch !== "$") {
      const start = i;
      i += 1;
      while (i < line.length && isIdentPart(line[i]!) && line[i] !== "$") i += 1;
      const word = line.slice(start, i);
      const nextCh = peekNextNonSpace(line, i);
      let kind: CodeTokenKind | undefined;
      if (prevKeyword === "def") {
        kind = "function";
      } else if (prevKeyword === "class") {
        kind = "type";
      } else if (PYTHON_KEYWORDS.has(word)) {
        kind = "keyword";
      } else if (PYTHON_BUILTINS.has(word)) {
        kind = "builtin";
      } else if (nextCh === "(") {
        kind = "function";
      } else if (prevWasDot) {
        kind = "property";
      } else if (isPascalCase(word)) {
        kind = "type";
      }
      pushToken(out, word, kind);
      prevKeyword = kind === "keyword" ? word : "";
      prevWasDot = false;
      continue;
    }

    // Multi-char operators
    const two = line.slice(i, i + 2);
    const three = line.slice(i, i + 3);
    if (three === "**=" || three === "//=" || three === "<<=" || three === ">>=") {
      pushToken(out, three, "operator");
      i += 3;
      prevKeyword = "";
      prevWasDot = false;
      continue;
    }
    if (
      two === "==" || two === "!=" || two === "<=" || two === ">=" || two === ":="
      || two === "->" || two === "**" || two === "//" || two === "+=" || two === "-="
      || two === "*=" || two === "/=" || two === "%=" || two === "<<" || two === ">>"
    ) {
      pushToken(out, two, "operator");
      i += 2;
      prevKeyword = "";
      prevWasDot = false;
      continue;
    }
    if ("+-*/%=<>!&|^~@".includes(ch)) {
      pushToken(out, ch, "operator");
      i += 1;
      prevKeyword = "";
      prevWasDot = false;
      continue;
    }
    if ("()[]{},:;.".includes(ch)) {
      pushToken(out, ch, "punctuation");
      i += 1;
      prevKeyword = "";
      prevWasDot = ch === ".";
      continue;
    }

    pushToken(out, ch);
    i += 1;
    prevKeyword = "";
    prevWasDot = false;
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* JavaScript / TypeScript                                                    */
/* -------------------------------------------------------------------------- */

const JS_KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "export", "extends", "finally",
  "for", "from", "function", "if", "import", "in", "instanceof", "let", "new",
  "of", "return", "static", "super", "switch", "this", "throw", "try", "typeof",
  "var", "void", "while", "with", "yield",
]);

const TS_EXTRA_KEYWORDS = new Set([
  "abstract", "as", "asserts", "declare", "enum", "implements", "infer",
  "interface", "is", "keyof", "module", "namespace", "override", "private",
  "protected", "public", "readonly", "satisfies", "type",
]);

const TS_PRIMITIVE_TYPES = new Set([
  "string", "number", "boolean", "any", "unknown", "never", "object", "bigint", "symbol",
]);

const JS_BUILTINS = new Set([
  "true", "false", "null", "undefined", "NaN", "Infinity", "console", "Math",
  "JSON", "Object", "Array", "Map", "Set", "WeakMap", "WeakSet", "Promise",
  "Date", "RegExp", "Error", "TypeError", "RangeError", "Symbol", "BigInt",
  "Number", "String", "Boolean", "Record", "Partial", "Required", "Readonly",
  "Pick", "Omit", "Exclude", "Extract", "ReturnType", "Awaited",
]);

interface JsState {
  inBlockComment: boolean;
  inTemplateString: boolean;
}

function tokenizeJsLine(line: string, state: JsState, isTs: boolean): CodeToken[] {
  const out: CodeToken[] = [];
  let i = 0;
  let prevKeyword = "";
  let prevWasDot = false;

  while (i < line.length) {
    if (state.inBlockComment) {
      const endIdx = line.indexOf("*/", i);
      if (endIdx === -1) {
        pushToken(out, line.slice(i), "comment");
        break;
      }
      pushToken(out, line.slice(i, endIdx + 2), "comment");
      i = endIdx + 2;
      state.inBlockComment = false;
      continue;
    }

    if (state.inTemplateString) {
      const start = i;
      let closed = false;
      while (i < line.length) {
        if (line[i] === "\\") {
          i += Math.min(2, line.length - i);
          continue;
        }
        if (line[i] === "`") {
          i += 1;
          state.inTemplateString = false;
          closed = true;
          break;
        }
        i += 1;
      }
      pushToken(out, line.slice(start, i), "string");
      if (!closed) break;
      prevKeyword = "";
      prevWasDot = false;
      continue;
    }

    const ch = line[i]!;

    if (ch === " " || ch === "\t") {
      const start = i;
      while (i < line.length && (line[i] === " " || line[i] === "\t")) i += 1;
      pushToken(out, line.slice(start, i));
      continue;
    }

    if (ch === "/" && line[i + 1] === "/") {
      pushToken(out, line.slice(i), "comment");
      break;
    }

    if (ch === "/" && line[i + 1] === "*") {
      const endIdx = line.indexOf("*/", i + 2);
      if (endIdx === -1) {
        pushToken(out, line.slice(i), "comment");
        state.inBlockComment = true;
        break;
      }
      pushToken(out, line.slice(i, endIdx + 2), "comment");
      i = endIdx + 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const start = i;
      i += 1;
      while (i < line.length) {
        if (line[i] === "\\") {
          i += Math.min(2, line.length - i);
          continue;
        }
        if (line[i] === ch) {
          i += 1;
          break;
        }
        i += 1;
      }
      pushToken(out, line.slice(start, i), "string");
      prevKeyword = "";
      prevWasDot = false;
      continue;
    }

    if (ch === "`") {
      const start = i;
      i += 1;
      let closed = false;
      while (i < line.length) {
        if (line[i] === "\\") {
          i += Math.min(2, line.length - i);
          continue;
        }
        if (line[i] === "`") {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) state.inTemplateString = true;
      pushToken(out, line.slice(start, i), "string");
      prevKeyword = "";
      prevWasDot = false;
      continue;
    }

    if (isDigit(ch)) {
      const end = readNumberLiteral(line, i);
      pushToken(out, line.slice(i, end), "number");
      i = end;
      prevKeyword = "";
      prevWasDot = false;
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (i < line.length && isIdentPart(line[i]!)) i += 1;
      const word = line.slice(start, i);
      const nextCh = peekNextNonSpace(line, i);
      let kind: CodeTokenKind | undefined;
      if (prevKeyword === "function") {
        kind = "function";
      } else if (prevKeyword === "class" || prevKeyword === "interface" || prevKeyword === "type" || prevKeyword === "enum") {
        kind = "type";
      } else if (JS_KEYWORDS.has(word) || (isTs && TS_EXTRA_KEYWORDS.has(word))) {
        kind = "keyword";
      } else if (isTs && TS_PRIMITIVE_TYPES.has(word) && !prevWasDot && nextCh !== ":") {
        kind = "type";
      } else if (JS_BUILTINS.has(word) && !prevWasDot) {
        kind = "builtin";
      } else if (nextCh === "(") {
        kind = "function";
      } else if (prevWasDot || (nextCh === ":" && line[i + 1] !== ":")) {
        kind = "property";
      } else if (isPascalCase(word)) {
        kind = "type";
      }
      pushToken(out, word, kind);
      prevKeyword = kind === "keyword" ? word : "";
      prevWasDot = false;
      continue;
    }

    const three = line.slice(i, i + 3);
    const two = line.slice(i, i + 2);
    if (three === "===" || three === "!==" || three === "..." || three === "??=" || three === "&&=" || three === "||=") {
      pushToken(out, three, three === "..." ? "punctuation" : "operator");
      i += 3;
      prevKeyword = "";
      prevWasDot = false;
      continue;
    }
    if (
      two === "=>" || two === "==" || two === "!=" || two === "<=" || two === ">="
      || two === "&&" || two === "||" || two === "??" || two === "?." || two === "+="
      || two === "-=" || two === "*=" || two === "/=" || two === "++" || two === "--"
      || two === "**"
    ) {
      pushToken(out, two, two === "?." ? "punctuation" : "operator");
      i += 2;
      prevKeyword = "";
      prevWasDot = two === "?.";
      continue;
    }
    if ("+-*/%=<>!&|^~?:".includes(ch)) {
      pushToken(out, ch, ch === ":" ? "punctuation" : "operator");
      i += 1;
      prevKeyword = "";
      prevWasDot = false;
      continue;
    }
    if ("()[]{},;.".includes(ch)) {
      pushToken(out, ch, "punctuation");
      i += 1;
      prevKeyword = "";
      prevWasDot = ch === ".";
      continue;
    }

    pushToken(out, ch);
    i += 1;
    prevKeyword = "";
    prevWasDot = false;
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* JSON                                                                       */
/* -------------------------------------------------------------------------- */

interface BlockCommentState {
  inBlockComment: boolean;
}

function tokenizeJsonLine(line: string, state: BlockCommentState): CodeToken[] {
  const out: CodeToken[] = [];
  let i = 0;

  while (i < line.length) {
    if (state.inBlockComment) {
      const endIdx = line.indexOf("*/", i);
      if (endIdx === -1) {
        pushToken(out, line.slice(i), "comment");
        break;
      }
      pushToken(out, line.slice(i, endIdx + 2), "comment");
      i = endIdx + 2;
      state.inBlockComment = false;
      continue;
    }

    const ch = line[i]!;

    if (ch === " " || ch === "\t") {
      const start = i;
      while (i < line.length && (line[i] === " " || line[i] === "\t")) i += 1;
      pushToken(out, line.slice(start, i));
      continue;
    }

    if (ch === "/" && line[i + 1] === "/") {
      pushToken(out, line.slice(i), "comment");
      break;
    }

    if (ch === "/" && line[i + 1] === "*") {
      const endIdx = line.indexOf("*/", i + 2);
      if (endIdx === -1) {
        pushToken(out, line.slice(i), "comment");
        state.inBlockComment = true;
        break;
      }
      pushToken(out, line.slice(i, endIdx + 2), "comment");
      i = endIdx + 2;
      continue;
    }

    if (ch === '"') {
      const start = i;
      i += 1;
      while (i < line.length) {
        if (line[i] === "\\") {
          i += Math.min(2, line.length - i);
          continue;
        }
        if (line[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      const isKey = peekNextNonSpace(line, i) === ":";
      pushToken(out, line.slice(start, i), isKey ? "property" : "string");
      continue;
    }

    if (ch === "-" || isDigit(ch)) {
      const numMatch = line.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (numMatch) {
        pushToken(out, numMatch[0], "number");
        i += numMatch[0].length;
        continue;
      }
    }

    const literalMatch = line.slice(i).match(/^(?:true|false|null)\b/);
    if (literalMatch) {
      pushToken(out, literalMatch[0], "builtin");
      i += literalMatch[0].length;
      continue;
    }

    if ("{}[]:,".includes(ch)) {
      pushToken(out, ch, "punctuation");
      i += 1;
      continue;
    }

    pushToken(out, ch);
    i += 1;
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* SQL                                                                        */
/* -------------------------------------------------------------------------- */

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER",
  "CROSS", "ON", "USING", "AS", "AND", "OR", "NOT", "IN", "IS", "NULL", "EXISTS",
  "BETWEEN", "LIKE", "ILIKE", "GROUP", "BY", "HAVING", "ORDER", "ASC", "DESC",
  "NULLS", "FIRST", "LAST", "LIMIT", "OFFSET", "FETCH", "NEXT", "ROWS", "ONLY",
  "DISTINCT", "UNION", "INTERSECT", "EXCEPT", "ALL", "INSERT", "INTO", "VALUES",
  "UPDATE", "SET", "DELETE", "CREATE", "REPLACE", "ALTER", "DROP", "TABLE",
  "VIEW", "INDEX", "WITH", "RECURSIVE", "CASE", "WHEN", "THEN", "ELSE", "END",
  "CAST", "OVER", "PARTITION", "WINDOW", "PRIMARY", "KEY", "FOREIGN", "REFERENCES",
  "UNIQUE", "CHECK", "DEFAULT", "CONSTRAINT", "IF", "RETURNING", "BEGIN", "COMMIT",
  "ROLLBACK", "TRANSACTION", "EXPLAIN", "ANALYZE",
]);

const SQL_TYPES = new Set([
  "INT", "INTEGER", "BIGINT", "SMALLINT", "TINYINT", "DECIMAL", "NUMERIC",
  "FLOAT", "DOUBLE", "REAL", "VARCHAR", "CHAR", "CHARACTER", "TEXT", "BOOLEAN",
  "BOOL", "DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ", "INTERVAL", "JSON", "JSONB",
  "UUID", "BLOB", "BYTEA",
]);

const SQL_BUILTINS = new Set([
  "TRUE", "FALSE", "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP",
]);

const SQL_FUNCTIONS = new Set([
  "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF", "CONCAT",
  "SUBSTRING", "SUBSTR", "TRIM", "LTRIM", "RTRIM", "LOWER", "UPPER", "LENGTH",
  "NOW", "DATE_TRUNC", "EXTRACT", "ROW_NUMBER", "RANK", "DENSE_RANK", "LAG", "LEAD",
  "ROUND", "FLOOR", "CEIL", "ABS", "JSON_EXTRACT", "ARRAY_AGG", "STRING_AGG",
]);

interface SqlState {
  inBlockComment: boolean;
  inSingleQuote: boolean;
}

function tokenizeSqlLine(line: string, state: SqlState): CodeToken[] {
  const out: CodeToken[] = [];
  let i = 0;

  while (i < line.length) {
    if (state.inBlockComment) {
      const endIdx = line.indexOf("*/", i);
      if (endIdx === -1) {
        pushToken(out, line.slice(i), "comment");
        break;
      }
      pushToken(out, line.slice(i, endIdx + 2), "comment");
      i = endIdx + 2;
      state.inBlockComment = false;
      continue;
    }

    if (state.inSingleQuote) {
      const start = i;
      let closed = false;
      while (i < line.length) {
        if (line[i] === "'" && line[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (line[i] === "'") {
          i += 1;
          state.inSingleQuote = false;
          closed = true;
          break;
        }
        i += 1;
      }
      pushToken(out, line.slice(start, i), "string");
      if (!closed) break;
      continue;
    }

    const ch = line[i]!;

    if (ch === " " || ch === "\t") {
      const start = i;
      while (i < line.length && (line[i] === " " || line[i] === "\t")) i += 1;
      pushToken(out, line.slice(start, i));
      continue;
    }

    if (ch === "-" && line[i + 1] === "-") {
      pushToken(out, line.slice(i), "comment");
      break;
    }

    if (ch === "/" && line[i + 1] === "*") {
      const endIdx = line.indexOf("*/", i + 2);
      if (endIdx === -1) {
        pushToken(out, line.slice(i), "comment");
        state.inBlockComment = true;
        break;
      }
      pushToken(out, line.slice(i, endIdx + 2), "comment");
      i = endIdx + 2;
      continue;
    }

    if (ch === "'") {
      const start = i;
      i += 1;
      let closed = false;
      while (i < line.length) {
        if (line[i] === "'" && line[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (line[i] === "'") {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) state.inSingleQuote = true;
      pushToken(out, line.slice(start, i), "string");
      continue;
    }

    if (ch === '"' || ch === "`") {
      const start = i;
      i += 1;
      while (i < line.length && line[i] !== ch) i += 1;
      if (i < line.length) i += 1;
      pushToken(out, line.slice(start, i), "property");
      continue;
    }

    if (isDigit(ch)) {
      const end = readNumberLiteral(line, i);
      pushToken(out, line.slice(i, end), "number");
      i = end;
      continue;
    }

    if (isIdentStart(ch) && ch !== "$") {
      const start = i;
      i += 1;
      while (i < line.length && isIdentPart(line[i]!) && line[i] !== "$") i += 1;
      const word = line.slice(start, i);
      const upper = word.toUpperCase();
      const nextCh = peekNextNonSpace(line, i);
      let kind: CodeTokenKind | undefined;
      if (SQL_KEYWORDS.has(upper)) {
        kind = "keyword";
      } else if (SQL_TYPES.has(upper)) {
        kind = "type";
      } else if (SQL_BUILTINS.has(upper)) {
        kind = "builtin";
      } else if (SQL_FUNCTIONS.has(upper) || nextCh === "(") {
        kind = "function";
      }
      pushToken(out, word, kind);
      continue;
    }

    const two = line.slice(i, i + 2);
    if (two === "<>" || two === "!=" || two === "<=" || two === ">=" || two === "||" || two === "::") {
      pushToken(out, two, "operator");
      i += 2;
      continue;
    }
    if ("=<>+-*/%".includes(ch)) {
      pushToken(out, ch, "operator");
      i += 1;
      continue;
    }
    if ("(),;.".includes(ch)) {
      pushToken(out, ch, "punctuation");
      i += 1;
      continue;
    }

    pushToken(out, ch);
    i += 1;
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* YAML                                                                       */
/* -------------------------------------------------------------------------- */

function tokenizeYamlValue(segment: string, out: CodeToken[]): void {
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i]!;
    if (ch === " " || ch === "\t") {
      const start = i;
      while (i < segment.length && (segment[i] === " " || segment[i] === "\t")) i += 1;
      pushToken(out, segment.slice(start, i));
      continue;
    }
    if (ch === "#" && (i === 0 || segment[i - 1] === " " || segment[i - 1] === "\t")) {
      pushToken(out, segment.slice(i), "comment");
      break;
    }
    if (ch === '"' || ch === "'") {
      const start = i;
      i += 1;
      while (i < segment.length) {
        if (ch === '"' && segment[i] === "\\") {
          i += Math.min(2, segment.length - i);
          continue;
        }
        if (segment[i] === ch) {
          i += 1;
          break;
        }
        i += 1;
      }
      pushToken(out, segment.slice(start, i), "string");
      continue;
    }
    if ((ch === "&" || ch === "*") && i + 1 < segment.length && !/\s/.test(segment[i + 1]!)) {
      const start = i;
      i += 1;
      while (i < segment.length && !/[\s,[\]{}]/.test(segment[i]!)) i += 1;
      pushToken(out, segment.slice(start, i), "type");
      continue;
    }
    if (ch === "!" && segment[i + 1] === "!") {
      const start = i;
      while (i < segment.length && !/\s/.test(segment[i]!)) i += 1;
      pushToken(out, segment.slice(start, i), "type");
      continue;
    }
    if ("{}[],".includes(ch)) {
      pushToken(out, ch, "punctuation");
      i += 1;
      continue;
    }
    if ((ch === "|" || ch === ">") && /^([|>][+-]?\d?)(?:\s|$)/.test(segment.slice(i))) {
      const m = segment.slice(i).match(/^[|>][+-]?\d?/)!;
      pushToken(out, m[0], "operator");
      i += m[0].length;
      continue;
    }
    // Scalar token until comment, bracket, or comma
    const start = i;
    while (i < segment.length) {
      if (segment[i] === "#" && i > start && (segment[i - 1] === " " || segment[i - 1] === "\t")) break;
      if ("{}[],".includes(segment[i]!)) break;
      i += 1;
    }
    const raw = segment.slice(start, i);
    const trimmed = raw.trim();
    const trailingSpaces = raw.length - raw.trimEnd().length;
    const body = trailingSpaces > 0 ? raw.slice(0, raw.length - trailingSpaces) : raw;
    if (/^(?:true|false|yes|no|null|~)$/i.test(trimmed)) {
      pushToken(out, body, "builtin");
    } else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      pushToken(out, body, "number");
    } else if (body) {
      pushToken(out, body, "string");
    }
    if (trailingSpaces > 0) {
      pushToken(out, raw.slice(raw.length - trailingSpaces));
    }
  }
}

function tokenizeYamlLine(line: string): CodeToken[] {
  const out: CodeToken[] = [];
  if (!line) return out;

  const trimmed = line.trimStart();
  const indent = line.length - trimmed.length;
  if (indent > 0) pushToken(out, line.slice(0, indent));

  if (trimmed.startsWith("#")) {
    pushToken(out, trimmed, "comment");
    return out;
  }

  if (trimmed === "---" || trimmed === "...") {
    pushToken(out, trimmed, "keyword");
    return out;
  }

  let rest = trimmed;
  if (rest.startsWith("- ") || rest === "-") {
    pushToken(out, "-", "punctuation");
    rest = rest.slice(1);
    const ws = rest.match(/^\s+/)?.[0] ?? "";
    if (ws) {
      pushToken(out, ws);
      rest = rest.slice(ws.length);
    }
  }

  const keyMatch = rest.match(/^([^:#"'[\]{}]+?)(:)(\s.*|$)/);
  if (keyMatch) {
    pushToken(out, keyMatch[1]!, "property");
    pushToken(out, keyMatch[2]!, "punctuation");
    if (keyMatch[3]) tokenizeYamlValue(keyMatch[3], out);
    return out;
  }

  tokenizeYamlValue(rest, out);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Bash / Shell                                                               */
/* -------------------------------------------------------------------------- */

const BASH_KEYWORDS = new Set([
  "if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while",
  "until", "case", "esac", "function", "return", "exit", "local", "export",
  "readonly", "declare", "typeset", "unset", "shift", "source", "break",
  "continue", "select", "time",
]);

const BASH_BUILTINS = new Set([
  "echo", "printf", "cd", "pwd", "test", "true", "false", "read", "eval",
  "exec", "set", "trap", "mkdir", "rm", "cp", "mv", "cat", "grep", "rg",
  "sed", "awk", "curl", "git", "pnpm", "npm", "node", "python", "python3",
]);

interface BashState {
  inQuote: '"' | "'" | null;
}

function tokenizeBashLine(line: string, state: BashState): CodeToken[] {
  const out: CodeToken[] = [];
  let i = 0;

  while (i < line.length) {
    if (state.inQuote) {
      const q = state.inQuote;
      const start = i;
      let closed = false;
      while (i < line.length) {
        if (q === '"' && line[i] === "\\") {
          i += Math.min(2, line.length - i);
          continue;
        }
        if (line[i] === q) {
          i += 1;
          state.inQuote = null;
          closed = true;
          break;
        }
        i += 1;
      }
      pushToken(out, line.slice(start, i), "string");
      if (!closed) break;
      continue;
    }

    const ch = line[i]!;

    if (ch === " " || ch === "\t") {
      const start = i;
      while (i < line.length && (line[i] === " " || line[i] === "\t")) i += 1;
      pushToken(out, line.slice(start, i));
      continue;
    }

    if (ch === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t" || line[i - 1] === ";")) {
      pushToken(out, line.slice(i), "comment");
      break;
    }

    if (ch === '"' || ch === "'") {
      const start = i;
      i += 1;
      let closed = false;
      while (i < line.length) {
        if (ch === '"' && line[i] === "\\") {
          i += Math.min(2, line.length - i);
          continue;
        }
        if (line[i] === ch) {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) state.inQuote = ch;
      pushToken(out, line.slice(start, i), "string");
      continue;
    }

    if (ch === "$") {
      const varMatch = line.slice(i).match(/^\$(?:\{[^}]+\}|[a-zA-Z_][a-zA-Z0-9_]*|[0-9?*@#$-])/);
      if (varMatch) {
        pushToken(out, varMatch[0], "property");
        i += varMatch[0].length;
        continue;
      }
    }

    const two = line.slice(i, i + 2);
    if (two === "&&" || two === "||" || two === ">>" || two === "<<" || two === "2>") {
      pushToken(out, two, "operator");
      i += 2;
      continue;
    }
    if ("|><=".includes(ch)) {
      pushToken(out, ch, "operator");
      i += 1;
      continue;
    }
    if ("();[]{}".includes(ch)) {
      pushToken(out, ch, "punctuation");
      i += 1;
      continue;
    }

    if (isDigit(ch) && (i === 0 || /[\s=([,;]/.test(line[i - 1]!))) {
      const end = readNumberLiteral(line, i);
      if (end > i && (end === line.length || /[\s)\]};|&<>]/.test(line[end]!))) {
        pushToken(out, line.slice(i, end), "number");
        i = end;
        continue;
      }
    }

    if (isIdentStart(ch) && ch !== "$") {
      const start = i;
      while (i < line.length && (isIdentPart(line[i]!) || line[i] === "-")) i += 1;
      const word = line.slice(start, i);
      if (line[i] === "=") {
        pushToken(out, word, "property");
      } else if (BASH_KEYWORDS.has(word)) {
        pushToken(out, word, "keyword");
      } else if (BASH_BUILTINS.has(word)) {
        pushToken(out, word, "builtin");
      } else {
        pushToken(out, word);
      }
      continue;
    }

    pushToken(out, ch);
    i += 1;
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* HTML / XML                                                                 */
/* -------------------------------------------------------------------------- */

interface HtmlState {
  inComment: boolean;
  inTag: boolean;
}

function tokenizeHtmlLine(line: string, state: HtmlState): CodeToken[] {
  const out: CodeToken[] = [];
  let i = 0;

  while (i < line.length) {
    if (state.inComment) {
      const endIdx = line.indexOf("-->", i);
      if (endIdx === -1) {
        pushToken(out, line.slice(i), "comment");
        break;
      }
      pushToken(out, line.slice(i, endIdx + 3), "comment");
      i = endIdx + 3;
      state.inComment = false;
      continue;
    }

    if (state.inTag) {
      const ch = line[i]!;
      if (ch === " " || ch === "\t") {
        const start = i;
        while (i < line.length && (line[i] === " " || line[i] === "\t")) i += 1;
        pushToken(out, line.slice(start, i));
        continue;
      }
      if (ch === "/" && line[i + 1] === ">") {
        pushToken(out, "/>", "punctuation");
        i += 2;
        state.inTag = false;
        continue;
      }
      if (ch === ">") {
        pushToken(out, ">", "punctuation");
        i += 1;
        state.inTag = false;
        continue;
      }
      if (ch === "=") {
        pushToken(out, "=", "operator");
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const start = i;
        i += 1;
        while (i < line.length && line[i] !== ch) i += 1;
        if (i < line.length) i += 1;
        pushToken(out, line.slice(start, i), "string");
        continue;
      }
      const attrMatch = line.slice(i).match(/^[^\s=/>"']+/);
      if (attrMatch) {
        pushToken(out, attrMatch[0], "property");
        i += attrMatch[0].length;
        continue;
      }
      pushToken(out, ch);
      i += 1;
      continue;
    }

    if (line.startsWith("<!--", i)) {
      const endIdx = line.indexOf("-->", i + 4);
      if (endIdx === -1) {
        pushToken(out, line.slice(i), "comment");
        state.inComment = true;
        break;
      }
      pushToken(out, line.slice(i, endIdx + 3), "comment");
      i = endIdx + 3;
      continue;
    }

    if (line[i] === "<") {
      const doctype = line.slice(i).match(/^<![A-Za-z][^>]*>/);
      if (doctype) {
        pushToken(out, doctype[0], "keyword");
        i += doctype[0].length;
        continue;
      }
      const tagOpen = line.slice(i).match(/^(<\/?)([A-Za-z][A-Za-z0-9:._-]*)/);
      if (tagOpen) {
        pushToken(out, tagOpen[1]!, "punctuation");
        pushToken(out, tagOpen[2]!, "keyword");
        i += tagOpen[0].length;
        state.inTag = true;
        continue;
      }
    }

    if (line[i] === "&") {
      const entity = line.slice(i).match(/^&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z]+);/);
      if (entity) {
        pushToken(out, entity[0], "builtin");
        i += entity[0].length;
        continue;
      }
    }

    // Plain text up to next `<` or `&`
    const start = i;
    i += 1;
    while (i < line.length && line[i] !== "<" && line[i] !== "&") i += 1;
    pushToken(out, line.slice(start, i));
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* CSS                                                                        */
/* -------------------------------------------------------------------------- */

function tokenizeCssLine(line: string, state: BlockCommentState): CodeToken[] {
  const out: CodeToken[] = [];
  let i = 0;

  while (i < line.length) {
    if (state.inBlockComment) {
      const endIdx = line.indexOf("*/", i);
      if (endIdx === -1) {
        pushToken(out, line.slice(i), "comment");
        break;
      }
      pushToken(out, line.slice(i, endIdx + 2), "comment");
      i = endIdx + 2;
      state.inBlockComment = false;
      continue;
    }

    const ch = line[i]!;

    if (ch === " " || ch === "\t") {
      const start = i;
      while (i < line.length && (line[i] === " " || line[i] === "\t")) i += 1;
      pushToken(out, line.slice(start, i));
      continue;
    }

    if (ch === "/" && line[i + 1] === "*") {
      const endIdx = line.indexOf("*/", i + 2);
      if (endIdx === -1) {
        pushToken(out, line.slice(i), "comment");
        state.inBlockComment = true;
        break;
      }
      pushToken(out, line.slice(i, endIdx + 2), "comment");
      i = endIdx + 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const start = i;
      i += 1;
      while (i < line.length) {
        if (line[i] === "\\") {
          i += Math.min(2, line.length - i);
          continue;
        }
        if (line[i] === ch) {
          i += 1;
          break;
        }
        i += 1;
      }
      pushToken(out, line.slice(start, i), "string");
      continue;
    }

    if (ch === "@") {
      const atRule = line.slice(i).match(/^@[a-zA-Z-]+/);
      if (atRule) {
        pushToken(out, atRule[0], "keyword");
        i += atRule[0].length;
        continue;
      }
    }

    // Hex color
    if (ch === "#") {
      const hex = line.slice(i).match(/^#[0-9a-fA-F]{3,8}\b/);
      if (hex) {
        pushToken(out, hex[0], "number");
        i += hex[0].length;
        continue;
      }
      const idSel = line.slice(i).match(/^#[a-zA-Z_-][a-zA-Z0-9_-]*/);
      if (idSel) {
        pushToken(out, idSel[0], "type");
        i += idSel[0].length;
        continue;
      }
    }

    // Numbers with optional unit
    const numMatch = line.slice(i).match(/^(?:-?\d+(?:\.\d+)?|-?\.\d+)(?:%|px|rem|em|vh|vw|dvh|dvw|ch|fr|s|ms|deg)?\b/);
    if (numMatch && (ch !== "-" || isDigit(line[i + 1] ?? "") || line[i + 1] === ".")) {
      pushToken(out, numMatch[0], "number");
      i += numMatch[0].length;
      continue;
    }

    // Custom properties (`--token-name`)
    if (ch === "-" && line[i + 1] === "-") {
      const customProp = line.slice(i).match(/^--[a-zA-Z0-9_-]+/);
      if (customProp) {
        pushToken(out, customProp[0], "property");
        i += customProp[0].length;
        continue;
      }
    }

    // Class selector
    if (ch === "." && i + 1 < line.length && /[a-zA-Z_-]/.test(line[i + 1]!)) {
      const cls = line.slice(i).match(/^\.[a-zA-Z_-][a-zA-Z0-9_-]*/)!;
      pushToken(out, cls[0], "type");
      i += cls[0].length;
      continue;
    }

    // Identifiers (property names, functions, keywords)
    if (/[a-zA-Z_-]/.test(ch)) {
      const ident = line.slice(i).match(/^[a-zA-Z_-][a-zA-Z0-9_-]*/)!;
      const word = ident[0];
      const nextPos = i + word.length;
      const nextCh = peekNextNonSpace(line, nextPos);
      if (nextCh === "(") {
        pushToken(out, word, "function");
      } else if (nextCh === ":" && !(line[nextPos] === ":" && line[nextPos + 1] === ":")) {
        pushToken(out, word, "property");
      } else if (word === "!important") {
        pushToken(out, word, "keyword");
      } else {
        pushToken(out, word);
      }
      i = nextPos;
      continue;
    }

    if ("{}:;,()".includes(ch)) {
      pushToken(out, ch, "punctuation");
      i += 1;
      continue;
    }

    pushToken(out, ch);
    i += 1;
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Tokenizes source code lines for the given language.
 * Returns `null` when no supported language is declared (or language is `plain` / `text`),
 * allowing callers to render lines as plain text without extra token nodes.
 */
export function highlightCodeLines(
  lines: readonly string[],
  language?: string | null,
): readonly (readonly CodeToken[])[] | null {
  const normalized = normalizeCodeLanguage(language);
  if (!normalized) return null;

  switch (normalized) {
    case "python": {
      const state: PythonState = { tripleQuote: null, tripleRaw: false };
      return lines.map((line) => tokenizePythonLine(line, state));
    }
    case "javascript":
    case "typescript": {
      const state: JsState = { inBlockComment: false, inTemplateString: false };
      const isTs = normalized === "typescript";
      return lines.map((line) => tokenizeJsLine(line, state, isTs));
    }
    case "json": {
      const state: BlockCommentState = { inBlockComment: false };
      return lines.map((line) => tokenizeJsonLine(line, state));
    }
    case "sql": {
      const state: SqlState = { inBlockComment: false, inSingleQuote: false };
      return lines.map((line) => tokenizeSqlLine(line, state));
    }
    case "yaml":
      return lines.map((line) => tokenizeYamlLine(line));
    case "bash": {
      const state: BashState = { inQuote: null };
      return lines.map((line) => tokenizeBashLine(line, state));
    }
    case "html": {
      const state: HtmlState = { inComment: false, inTag: false };
      return lines.map((line) => tokenizeHtmlLine(line, state));
    }
    case "css": {
      const state: BlockCommentState = { inBlockComment: false };
      return lines.map((line) => tokenizeCssLine(line, state));
    }
  }
}
